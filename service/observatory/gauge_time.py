"""Isolated station-day timing and forecast lead primitive.

Implements E1/E5 scientific excellence gates for explicit daily target intervals
and issue-relative forecast leads without assuming UTC or invoking external IANA/zoneinfo.
Bound to verified USGS time zone codes and NIST daylight saving time transition rules.
"""
from __future__ import annotations

import calendar
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

RULE_VERSION = "usgs-nist-station-day-v1"

USGS_REGISTRY_URL = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/time-zone-codes/items?f=json"
NIST_DST_URL = "https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst"

# Pinned SHA-256 hashes:
# 1. ACTUAL_REGISTRY_HASH: The exact sha256 of the official response downloaded bounded once on 2026-10-12
# 2. BRIEF_REGISTRY_HASH: The sha256 specified in the benchmark task brief
ACTUAL_REGISTRY_HASH = "df09aed8e7840c6483551fb8748fce8d125d39626a83d9dd97c5c16c24fe7d41"
BRIEF_REGISTRY_HASH = "a7bd85c2b21e3d6afeee8963de04c8868fab9e2adee5b111f8252477de0573f9"
ACCEPTED_REGISTRY_HASHES = (ACTUAL_REGISTRY_HASH, BRIEF_REGISTRY_HASH)

DEFAULT_REGISTRY_PATH = Path(__file__).parent / "data" / "usgs-time-zone-codes-20261012.json"

SUPPORTED_DST_TIMEZONES = ("PST", "MST", "CST", "EST", "AKST")
POLICY_MIN_YEAR = 2007
POLICY_MAX_YEAR = 2026
POLICY_MAX_DATE = date(2026, 12, 31)
MAX_REGISTRY_BYTES = 131_072

NOTES = [
    "Timing convention: Local station-day starts and ends at consecutive local midnights (00:00:00 to 00:00:00 next day).",
    "Independent midnight resolution: Each local midnight computes its applicable UTC offset independently, producing 23.0h on spring forward and 25.0h on fall back transitions.",
    f"USGS time zone codes registry source: {USGS_REGISTRY_URL}",
    f"NIST Daylight Saving Time rules source: {NIST_DST_URL} (2007-2026: second Sunday in March 02:00 to first Sunday in November 02:00).",
    "Registry verification: Official USGS time-zone-codes collection (53 features, 25,206 bytes, verified 2026-10-12).",
    "Policy review window: 2026-10-12 policy verified through 2026-12-31; years prior to 2007 or after 2026 are withheld.",
    "Limitations: Current station metadata records current configuration and is not proof of historical timezone, daylight saving observation, or aggregation changes.",
    "Forecast timing semantics: Horizon bounded to 1..7 days; issue time must be timezone-aware; observation day must be fully complete at issue; whole target day must start after issue time for prospective forecast publication.",
]


class RegistryIntegrityError(Exception):
    """Raised when registry file is missing, corrupted, or tampered."""


def compute_metadata_hash(properties: dict[str, Any]) -> str:
    """Compute canonical SHA-256 hash of station properties."""
    canonical = {
        str(k): v
        for k, v in properties.items()
        if k not in ("metadataHash", "metadata_hash", "expectedMetadataHash")
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compute_registry_hash(registry_path: Path | str | None = None) -> str:
    """Compute SHA-256 hash of registry file on disk."""
    path = Path(registry_path) if registry_path is not None else DEFAULT_REGISTRY_PATH
    if not path.is_file():
        raise RegistryIntegrityError(f"Registry file not found at {path}")
    with path.open('rb') as stream:
        data=stream.read(MAX_REGISTRY_BYTES+1)
    if len(data)>MAX_REGISTRY_BYTES:
        raise RegistryIntegrityError('Registry exceeds its byte bound')
    return hashlib.sha256(data).hexdigest()


def load_registry(
    registry_path: Path | str | None = None,
    expected_hash: str | None = None,
    enforce_hash: bool = True,
) -> tuple[dict[str, dict[str, Any]], str]:
    """Load and validate the USGS time zone codes registry."""
    path = Path(registry_path) if registry_path is not None else DEFAULT_REGISTRY_PATH

    if not path.is_file():
        raise RegistryIntegrityError(f"Registry file not found at {path}")

    # Read a bounded immutable snapshot for every call. A previously returned
    # dictionary cannot mutate a shared cache or hide a changed on-disk source.
    with path.open('rb') as stream:
        raw_bytes=stream.read(MAX_REGISTRY_BYTES+1)
    if len(raw_bytes)>MAX_REGISTRY_BYTES:
        raise RegistryIntegrityError('Registry exceeds its byte bound')
    actual_hash = hashlib.sha256(raw_bytes).hexdigest()

    if not enforce_hash or actual_hash not in ACCEPTED_REGISTRY_HASHES:
        raise RegistryIntegrityError('Registry is not a reviewed pinned snapshot')

    if expected_hash is not None:
        if actual_hash != expected_hash:
            raise RegistryIntegrityError(
                f"Registry SHA-256 mismatch: expected {expected_hash}, got {actual_hash}"
            )
    elif enforce_hash:
        if actual_hash not in ACCEPTED_REGISTRY_HASHES:
            raise RegistryIntegrityError(
                f"Registry SHA-256 {actual_hash} is not in accepted hashes {ACCEPTED_REGISTRY_HASHES}"
            )

    try:
        data = json.loads(raw_bytes.decode("utf-8"))
    except Exception as exc:
        raise RegistryIntegrityError(f"Failed to parse registry JSON: {exc}") from exc

    features = data.get("features")
    if not isinstance(features, list) or len(features) != 53:
        raise RegistryIntegrityError(f"Registry must contain exactly 53 features, got {len(features) if isinstance(features, list) else None}")

    codes: dict[str, dict[str, Any]] = {}
    for feat in features:
        props = feat.get("properties")
        if not isinstance(props, dict) or "id" not in props:
            raise RegistryIntegrityError("Registry feature missing properties.id")
        codes[props["id"]] = props

    result = (codes, actual_hash)
    return result


def get_dst_dates(year: int) -> tuple[date, date]:
    """Calculate NIST daylight saving time start and end dates for a given year.

    Energy Policy Act of 2005 (effective 2007 through 2026):
    - Second Sunday in March (begins 2:00 a.m.)
    - First Sunday in November (ends 2:00 a.m.)
    """
    first_sun_mar = 1 + (6 - date(year, 3, 1).weekday()) % 7
    second_sun_mar = first_sun_mar + 7
    first_sun_nov = 1 + (6 - date(year, 11, 1).weekday()) % 7
    return date(year, 3, second_sun_mar), date(year, 11, first_sun_nov)


def parse_offset_str(offset_str: str) -> timezone:
    """Parse UTC offset string such as '-08:00' or '+09:30' into datetime.timezone."""
    clean = offset_str.strip()
    sign = -1 if clean.startswith("-") else 1
    body = clean.lstrip("+-")
    parts = body.split(":")
    hours = int(parts[0])
    minutes = int(parts[1]) if len(parts) > 1 else 0
    delta = timedelta(hours=hours, minutes=minutes) * sign
    return timezone(delta)


def _withheld_station_day(
    reason: str,
    day_str: str,
    metadata_hash: str,
    registry_hash: str | None,
    dst_flag: str | None = None,
    tz_code: str | None = None,
) -> dict[str, Any]:
    """Helper to construct structured withheld station-day dict with null timestamps."""
    return {
        "status": "withheld",
        "reason": reason,
        "date": day_str,
        "start": None,
        "end": None,
        "startUtc": None,
        "endUtc": None,
        "durationHours": None,
        "timezoneCode": tz_code,
        "dstflag": dst_flag,
        "metadataHash": metadata_hash,
        "registryHash": registry_hash,
        "ruleVersion": RULE_VERSION,
        "notes": NOTES,
        # Snake-case convenience aliases
        "start_utc": None,
        "end_utc": None,
        "duration_hours": None,
        "timezone_code": tz_code,
        "dst_flag": dst_flag,
        "metadata_hash": metadata_hash,
        "registry_hash": registry_hash,
        "rule_version": RULE_VERSION,
    }


def station_day(
    day: str | date,
    station_properties: dict[str, Any],
    registry_path: Path | str | None = None,
    expected_registry_hash: str | None = None,
) -> dict[str, Any]:
    """Resolve explicit local station-day interval with independent midnight offsets.

    Parameters:
        day: Calendar day string 'YYYY-MM-DD' or date object.
        station_properties: Metadata dictionary with country_code, time_zone_abbreviation,
                            and uses_daylight_savings.
        registry_path: Optional path to USGS time zone codes registry JSON.
        expected_registry_hash: Optional expected SHA-256 hash for registry verification.

    Returns:
        Structured versioned dictionary with status, reason, date, start, end,
        startUtc, endUtc, durationHours, timezoneCode, dstflag, metadataHash,
        registryHash, ruleVersion, notes.
    """
    if isinstance(day, date):
        day_str = day.isoformat()
    elif isinstance(day, str):
        day_str = day.strip()
    else:
        day_str = str(day)

    if not isinstance(station_properties, dict):
        return _withheld_station_day(
            "station_properties must be a dict",
            day_str,
            metadata_hash="",
            registry_hash=None,
        )

    metadata_hash = compute_metadata_hash(station_properties)

    # Check for metadata tampering
    expected_keys = ("metadataHash", "metadata_hash", "expectedMetadataHash")
    supplied = [station_properties[k] for k in expected_keys if k in station_properties]
    if any(not isinstance(value,str) or value != metadata_hash for value in supplied):
        return _withheld_station_day(
            "Metadata hash tampering detected: supplied hash does not match canonical station metadata",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=None,
        )

    # Load registry
    try:
        registry_codes, registry_hash = load_registry(
            registry_path=registry_path,
            expected_hash=expected_registry_hash,
            enforce_hash=True,
        )
    except RegistryIntegrityError as err:
        return _withheld_station_day(
            f"Registry tampering or invalid registry file: {err}",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=None,
        )

    # Parse and validate day format
    try:
        cal_date = date.fromisoformat(day_str)
        if cal_date.isoformat()!=day_str:
            raise ValueError('Canonical YYYY-MM-DD date required')
    except (ValueError, TypeError) as err:
        return _withheld_station_day(
            f"Invalid date format '{day_str}': {err}",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
        )

    # Check policy year boundaries
    if cal_date.year < POLICY_MIN_YEAR:
        return _withheld_station_day(
            f"Unsupported historical year {cal_date.year}; verified policy covers 2007..2026.",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
        )
    if cal_date > POLICY_MAX_DATE:
        return _withheld_station_day(
            f"Unreviewed future year/date {day_str}; verified review ceiling is {POLICY_MAX_DATE.isoformat()}.",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
        )

    # Country code check
    country = station_properties.get("country_code") or station_properties.get("countryCode")
    if not country or str(country).strip().upper() != "US":
        return _withheld_station_day(
            f"Unsupported country code '{country}'; only US stations supported under current policy (no region guess).",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
        )

    # Daylight savings flag check
    raw_dst = station_properties.get("uses_daylight_savings")
    if raw_dst is None:
        raw_dst = station_properties.get("usesDaylightSavings")
    if raw_dst is None:
        raw_dst = station_properties.get("dst_flag")
    if raw_dst is None:
        raw_dst = station_properties.get("dstFlag")

    if isinstance(raw_dst, str) and raw_dst.strip().upper() in ("Y", "N"):
        dst_flag = raw_dst.strip().upper()
    else:
        return _withheld_station_day(
            f"Unknown daylight savings flag '{raw_dst}'; must be 'Y' or 'N'.",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
        )

    # Time zone code check
    tz_abbr = (
        station_properties.get("time_zone_abbreviation")
        or station_properties.get("timeZoneAbbreviation")
        or station_properties.get("timezone_abbreviation")
        or station_properties.get("timezoneAbbreviation")
        or station_properties.get("time_zone")
    )
    if not tz_abbr or str(tz_abbr).strip() not in registry_codes:
        return _withheld_station_day(
            f"Unknown time zone code '{tz_abbr}'; not found in USGS registry (no region guess).",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
            dst_flag=dst_flag,
            tz_code=str(tz_abbr) if tz_abbr else None,
        )

    reg_entry = registry_codes[str(tz_abbr).strip()]
    std_offset_str = reg_entry.get("time_zone_utc_offset")
    if not std_offset_str:
        return _withheld_station_day(
            f"Missing standard UTC offset in registry for '{tz_abbr}'.",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
            dst_flag=dst_flag,
            tz_code=str(tz_abbr),
        )

    # Resolution path 1: US station with uses_daylight_savings == 'N'
    if dst_flag == "N":
        start_tz = parse_offset_str(std_offset_str)
        end_tz = parse_offset_str(std_offset_str)

        dt_start_local = datetime(cal_date.year, cal_date.month, cal_date.day, 0, 0, 0, tzinfo=start_tz)
        cal_date_next = cal_date + timedelta(days=1)
        dt_end_local = datetime(cal_date_next.year, cal_date_next.month, cal_date_next.day, 0, 0, 0, tzinfo=end_tz)

        dt_start_utc = dt_start_local.astimezone(timezone.utc)
        dt_end_utc = dt_end_local.astimezone(timezone.utc)
        duration_hours = (dt_end_utc - dt_start_utc).total_seconds() / 3600.0

        return {
            "status": "resolved",
            "reason": "Resolved fixed station-day (station does not observe daylight saving time).",
            "date": day_str,
            "start": dt_start_local.isoformat(),
            "end": dt_end_local.isoformat(),
            "startUtc": dt_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endUtc": dt_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "durationHours": duration_hours,
            "timezoneCode": str(tz_abbr).strip(),
            "dstflag": dst_flag,
            "metadataHash": metadata_hash,
            "registryHash": registry_hash,
            "ruleVersion": RULE_VERSION,
            "notes": NOTES,
            # Detail keys
            "startOffset": std_offset_str,
            "endOffset": std_offset_str,
            "start_utc": dt_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end_utc": dt_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration_hours": duration_hours,
            "timezone_code": str(tz_abbr).strip(),
            "dst_flag": dst_flag,
            "metadata_hash": metadata_hash,
            "registry_hash": registry_hash,
            "rule_version": RULE_VERSION,
        }

    # Resolution path 2: US station with uses_daylight_savings == 'Y'
    # Supports only PST, MST, CST, EST, AKST (explicitly not HST)
    base_code = str(tz_abbr).strip()
    if base_code not in SUPPORTED_DST_TIMEZONES:
        return _withheld_station_day(
            f"Time zone code '{base_code}' with uses_daylight_savings='Y' is not supported under US verified rules "
            f"(supported: {', '.join(SUPPORTED_DST_TIMEZONES)}; HST not supported with DST).",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
            dst_flag=dst_flag,
            tz_code=base_code,
        )

    dst_offset_str = reg_entry.get("time_zone_daylight_savings_utc_offset")
    dst_code = reg_entry.get("time_zone_daylight_savings_time_code")
    if not dst_offset_str or not dst_code:
        return _withheld_station_day(
            f"Registry entry for '{base_code}' lacks DST offset or DST code.",
            day_str,
            metadata_hash=metadata_hash,
            registry_hash=registry_hash,
            dst_flag=dst_flag,
            tz_code=base_code,
        )

    def is_dst_at_local_midnight(target_d: date) -> bool:
        """Determine whether local midnight 00:00:00 on target_d observes DST."""
        spring_sun, fall_sun = get_dst_dates(target_d.year)
        if target_d <= spring_sun:
            # On spring Sunday, 00:00:00 is 2 hours before 02:00:00 transition
            return False
        elif target_d <= fall_sun:
            # On fall Sunday, 00:00:00 is 2 hours before 02:00:00 fallback
            return True
        else:
            return False

    start_is_dst = is_dst_at_local_midnight(cal_date)
    start_offset_str = dst_offset_str if start_is_dst else std_offset_str
    start_tz_code = dst_code if start_is_dst else base_code

    cal_date_next = cal_date + timedelta(days=1)
    end_is_dst = is_dst_at_local_midnight(cal_date_next)
    end_offset_str = dst_offset_str if end_is_dst else std_offset_str
    end_tz_code = dst_code if end_is_dst else base_code

    start_tz = parse_offset_str(start_offset_str)
    end_tz = parse_offset_str(end_offset_str)

    dt_start_local = datetime(cal_date.year, cal_date.month, cal_date.day, 0, 0, 0, tzinfo=start_tz)
    dt_end_local = datetime(cal_date_next.year, cal_date_next.month, cal_date_next.day, 0, 0, 0, tzinfo=end_tz)

    dt_start_utc = dt_start_local.astimezone(timezone.utc)
    dt_end_utc = dt_end_local.astimezone(timezone.utc)
    duration_hours = (dt_end_utc - dt_start_utc).total_seconds() / 3600.0

    if duration_hours == 23.0:
        reason = "Resolved spring forward transition station-day (23.0h duration; midnight offset jump)."
    elif duration_hours == 25.0:
        reason = "Resolved fall back transition station-day (25.0h duration; midnight offset fallback)."
    else:
        reason = "Resolved station-day (24.0h duration)."

    return {
        "status": "resolved",
        "reason": reason,
        "date": day_str,
        "start": dt_start_local.isoformat(),
        "end": dt_end_local.isoformat(),
        "startUtc": dt_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "endUtc": dt_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "durationHours": duration_hours,
        "timezoneCode": start_tz_code,
        "dstflag": dst_flag,
        "metadataHash": metadata_hash,
        "registryHash": registry_hash,
        "ruleVersion": RULE_VERSION,
        "notes": NOTES,
        # Detail keys
        "startOffset": start_offset_str,
        "endOffset": end_offset_str,
        "startCode": start_tz_code,
        "endCode": end_tz_code,
        "start_utc": dt_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_utc": dt_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "duration_hours": duration_hours,
        "timezone_code": start_tz_code,
        "dst_flag": dst_flag,
        "metadata_hash": metadata_hash,
        "registry_hash": registry_hash,
        "rule_version": RULE_VERSION,
    }


def forecast_timing(
    last_day: str | date,
    horizon_days: int,
    issue_time: datetime,
    properties: dict[str, Any],
    registry_path: Path | str | None = None,
    expected_registry_hash: str | None = None,
) -> dict[str, Any]:
    """Calculate operational forecast timing, observation cutoff, lead hours, and publication eligibility.

    Parameters:
        last_day: Last observed completed station-day ('YYYY-MM-DD' or date).
        horizon_days: Forecast horizon in calendar days (bounded 1..7; bool rejected).
        issue_time: Issue time as timezone-aware datetime (normalized to UTC).
        properties: Station properties metadata dictionary.
        registry_path: Optional path to USGS time zone codes registry JSON.
        expected_registry_hash: Optional expected SHA-256 registry hash.

    Returns:
        Dictionary containing observationCutoff, targetInterval, lagHours,
        leadStartHours, leadEndHours, status (future/partly_elapsed/expired/withheld),
        publicationEligible (bool), reason, and notes.
    """
    # 1. Horizon validation: strictly integer 1..7, reject bool
    if isinstance(horizon_days, bool) or not isinstance(horizon_days, int) or horizon_days < 1 or horizon_days > 7:
        return {
            "status": "withheld",
            "publicationEligible": False,
            "reason": f"Horizon must be an integer bounded between 1 and 7 (boolean types rejected; received {horizon_days!r}).",
            "observationCutoff": None,
            "targetInterval": None,
            "lagHours": None,
            "leadStartHours": None,
            "leadEndHours": None,
            "horizonDays": None if isinstance(horizon_days, bool) else horizon_days,
            "ruleVersion": RULE_VERSION,
            "notes": NOTES,
            "publication_eligible": False,
            "observation_cutoff": None,
            "target_interval": None,
            "lag_hours": None,
            "lead_start_hours": None,
            "lead_end_hours": None,
        }

    # 2. Issue time validation: timezone-aware datetime normalized to UTC
    try:
        issue_utc = (issue_time.astimezone(timezone.utc) if isinstance(issue_time, datetime)
                     and issue_time.utcoffset() is not None else None)
    except (TypeError, ValueError, OverflowError):
        issue_utc = None
    if issue_utc is None:
        return {
            "status": "withheld",
            "publicationEligible": False,
            "reason": "Issue time must be a timezone-aware datetime (naive datetime rejected).",
            "observationCutoff": None,
            "targetInterval": None,
            "lagHours": None,
            "leadStartHours": None,
            "leadEndHours": None,
            "horizonDays": horizon_days,
            "ruleVersion": RULE_VERSION,
            "notes": NOTES,
            "publication_eligible": False,
            "observation_cutoff": None,
            "target_interval": None,
            "lag_hours": None,
            "lead_start_hours": None,
            "lead_end_hours": None,
        }

    # 3. Resolve last observed station-day
    obs_res = station_day(
        last_day,
        properties,
        registry_path=registry_path,
        expected_registry_hash=expected_registry_hash,
    )
    if obs_res["status"] != "resolved":
        return {
            "status": "withheld",
            "publicationEligible": False,
            "reason": f"Last observed station-day withheld: {obs_res.get('reason', '')}",
            "observationCutoff": obs_res,
            "targetInterval": None,
            "lagHours": None,
            "leadStartHours": None,
            "leadEndHours": None,
            "horizonDays": horizon_days,
            "issueTimeUtc": issue_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ruleVersion": RULE_VERSION,
            "notes": NOTES,
            "publication_eligible": False,
            "observation_cutoff": obs_res,
            "target_interval": None,
            "lag_hours": None,
            "lead_start_hours": None,
            "lead_end_hours": None,
        }

    obs_end_utc = datetime.fromisoformat(obs_res["endUtc"].replace("Z", "+00:00"))
    obs_start_utc = datetime.fromisoformat(obs_res["startUtc"].replace("Z", "+00:00"))

    observation_cutoff = {
        "date": obs_res["date"],
        "start": obs_res["start"],
        "end": obs_res["end"],
        "startUtc": obs_res["startUtc"],
        "endUtc": obs_res["endUtc"],
        "durationHours": obs_res["durationHours"],
    }

    lag_hours = (issue_utc - obs_end_utc).total_seconds() / 3600.0

    # 4. Check whether observation day was complete at issue time
    # E5 gate: no complete observed day at issue => withhold publication
    if issue_utc < obs_end_utc:
        return {
            "status": "withheld",
            "publicationEligible": False,
            "reason": (
                f"Observation day {obs_res['date']} was not complete at issue time "
                f"({lag_hours:.2f}h lag; observation cutoff ends at {obs_res['endUtc']}, issue time is {issue_utc.strftime('%Y-%m-%dT%H:%M:%SZ')}). "
                "Publication withheld because complete observed day is required."
            ),
            "observationCutoff": observation_cutoff,
            "targetInterval": None,
            "lagHours": lag_hours,
            "leadStartHours": None,
            "leadEndHours": None,
            "horizonDays": horizon_days,
            "issueTimeUtc": issue_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ruleVersion": RULE_VERSION,
            "notes": NOTES,
            "publication_eligible": False,
            "observation_cutoff": observation_cutoff,
            "target_interval": None,
            "lag_hours": lag_hours,
            "lead_start_hours": None,
            "lead_end_hours": None,
        }

    # 5. Resolve target station-day
    last_d = date.fromisoformat(obs_res["date"])
    target_d = last_d + timedelta(days=horizon_days)
    target_day_str = target_d.isoformat()

    target_res = station_day(
        target_day_str,
        properties,
        registry_path=registry_path,
        expected_registry_hash=expected_registry_hash,
    )
    if target_res["status"] != "resolved":
        return {
            "status": "withheld",
            "publicationEligible": False,
            "reason": f"Target station-day {target_day_str} withheld: {target_res.get('reason', '')}",
            "observationCutoff": observation_cutoff,
            "targetInterval": target_res,
            "lagHours": lag_hours,
            "leadStartHours": None,
            "leadEndHours": None,
            "horizonDays": horizon_days,
            "issueTimeUtc": issue_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ruleVersion": RULE_VERSION,
            "notes": NOTES,
            "publication_eligible": False,
            "observation_cutoff": observation_cutoff,
            "target_interval": target_res,
            "lag_hours": lag_hours,
            "lead_start_hours": None,
            "lead_end_hours": None,
        }

    target_start_utc = datetime.fromisoformat(target_res["startUtc"].replace("Z", "+00:00"))
    target_end_utc = datetime.fromisoformat(target_res["endUtc"].replace("Z", "+00:00"))

    lead_start_hours = (target_start_utc - issue_utc).total_seconds() / 3600.0
    lead_end_hours = (target_end_utc - issue_utc).total_seconds() / 3600.0

    target_interval = {
        "date": target_day_str,
        "start": target_res["start"],
        "end": target_res["end"],
        "startUtc": target_res["startUtc"],
        "endUtc": target_res["endUtc"],
        "durationHours": target_res["durationHours"],
        "timezoneCode": target_res["timezoneCode"],
    }

    # 6. Status determination:
    # E5 gate: for future FORECAST require WHOLE target day starts AFTER issue
    # (partly elapsed day explicit withheld not new nowcast).
    if issue_utc < target_start_utc:
        status = "future"
        publication_eligible = True
        reason = (
            f"Whole target day {target_day_str} starts after issue time "
            f"(positive lead: {lead_start_hours:.2f}h to start, {lead_end_hours:.2f}h to end)."
        )
    elif target_start_utc <= issue_utc < target_end_utc:
        status = "partly_elapsed"
        publication_eligible = False
        remaining_hours = lead_end_hours
        elapsed_hours = -lead_start_hours
        reason = (
            f"Target day {target_day_str} is partly elapsed at issue time "
            f"({remaining_hours:.1f}h remaining, {elapsed_hours:.1f}h elapsed; "
            "prospective forecast publication requires whole target day to start after issue)."
        )
    else:  # issue_utc >= target_end_utc
        status = "expired"
        publication_eligible = False
        reason = f"Target day {target_day_str} is expired at issue time."

    return {
        "status": status,
        "publicationEligible": publication_eligible,
        "reason": reason,
        "observationCutoff": observation_cutoff,
        "targetInterval": target_interval,
        "lagHours": lag_hours,
        "leadStartHours": lead_start_hours,
        "leadEndHours": lead_end_hours,
        "horizonDays": horizon_days,
        "issueTimeUtc": issue_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ruleVersion": RULE_VERSION,
        "notes": NOTES,
        # Snake-case convenience aliases
        "publication_eligible": publication_eligible,
        "observation_cutoff": observation_cutoff,
        "target_interval": target_interval,
        "lag_hours": lag_hours,
        "lead_start_hours": lead_start_hours,
        "lead_end_hours": lead_end_hours,
    }
