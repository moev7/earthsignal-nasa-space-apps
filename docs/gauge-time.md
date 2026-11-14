# Station-Day Timing Primitive and Forecast Lead Semantics

## 1. Scientific Motivation and Decision Gates (E1 / E5)

This document specifies the isolated station-day timing primitive and forecast lead verification rules implemented in `service/observatory/gauge_time.py`.

In streamflow forecasting and hydrological assessment (decision gates **E1** and **E5** in `docs/research/scientific-excellence-2026-10-12/BENCHMARKS.md`):
- **E1 (Temporal semantics and daily intervals):** Observations and forecasts must publish explicit, reproducible target intervals (`start`, `end`, `startUtc`, `endUtc`, `durationHours`) aligned with the station's local measurement schedule. Neither synthetic substitutions nor naive assumptions of UTC midnight (`00:00:00Z`) are permitted.
- **E5 (Operational forecast policy):** Prospective forecasts require unambiguous issue-relative lead semantics. Target days cannot be evaluated or published if the underlying observation day is incomplete at issue time. Furthermore, prospective forecasts require that the **whole target day starts after issue time**. Partly elapsed target days are explicitly withheld rather than silently conflated with nowcasts or substituted with incomplete intervals.

To guarantee reproducibility without runtime network dependencies, paid APIs, or external IANA database ambiguities, all timing calculations are bounded to official USGS registry definitions and verified NIST transition rules.

---

## 2. Official Sources and Registry Verification

### 2.1 USGS Time Zone Codes Registry
- **Source URL:** `https://api.waterdata.usgs.gov/ogcapi/v1/collections/time-zone-codes/items?f=json`
- **Data File:** `service/observatory/data/usgs-time-zone-codes-20261012.json`
- **Specification:** OGC API Features collection containing 53 time zone code definitions (single page, `numberReturned: 53`, `numberMatched: 53`, no `next` link).
- **Download Constraint:** Bounded once via task budget (max 131,072 bytes, wall-clock timeout <= 30 seconds; completed in 1.12 seconds, 25,206 bytes).
- **SHA-256 Hashes:**
  - **Actual Downloaded Hash (2026-10-12):** `df09aed8e7840c6483551fb8748fce8d125d39626a83d9dd97c5c16c24fe7d41`
  - **Task Brief Benchmark Hash:** `a7bd85c2b21e3d6afeee8963de04c8868fab9e2adee5b111f8252477de0573f9`
  *(Note: The USGS OGC API dynamic payload contains an upstream server timestamp field `timeStamp: "2026-10-12T...Z"`. The captured response contains the expected 53 records and the offsets used by this implementation were independently checked. A full bytewise comparison against the earlier ephemeral response is not claimed here.)*
- **Registry Properties Used:**
  - `id`: Time zone abbreviation (e.g., `PST`, `MST`, `CST`, `EST`, `AKST`, `HST`)
  - `time_zone_utc_offset`: Standard UTC offset string (e.g., `-08:00`, `-07:00`, `-05:00`)
  - `time_zone_daylight_savings_time_code`: Daylight saving time abbreviation (e.g., `PDT`, `MDT`, `EDT`)
  - `time_zone_daylight_savings_utc_offset`: Daylight saving UTC offset string (e.g., `-07:00`, `-06:00`, `-04:00`)

### 2.2 NIST Daylight Saving Time Transition Rules
- **Source URL:** `https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst`
- **Statutory Authority:** U.S. Energy Policy Act of 2005 (in effect from 2007 through 2026).
- **Rules:**
  - **Spring forward:** Begins at 2:00 a.m. on the second Sunday in March (local time advances 02:00 -> 03:00).
  - **Fall back:** Ends at 2:00 a.m. on the first Sunday in November (local time repeats 02:00 -> 01:00).
  - **2026 Dates:** Spring transition on **March 8, 2026**; Fall transition on **November 1, 2026**.
  - **2024 Dates:** Spring transition on **March 10, 2024**; Fall transition on **November 3, 2024**.

---

## 3. Station-Day Resolution Method

### 3.1 Local Midnight Boundary Definition
A local station-day for calendar date `D` is bounded by two consecutive local midnights:
- **Start:** `D 00:00:00` in the local time zone offset applicable at that specific midnight.
- **End:** `(D + 1) 00:00:00` in the local time zone offset applicable at the subsequent midnight.

### 3.2 Independent Midnight Offset Calculation
Because statutory DST transitions occur at 2:00 a.m. local time:
- **On Spring Transition Sunday (e.g., 2026-03-08):**
  - At start midnight (`2026-03-08T00:00:00`), it is 2 hours before the 2:00 a.m. clock jump. The station is in **Standard Time** (e.g., `-08:00` for PST, UTC `08:00:00Z`).
  - At end midnight (`2026-03-09T00:00:00`), the 2:00 a.m. jump has already occurred. The station is in **Daylight Saving Time** (e.g., `-07:00` for PDT, UTC `07:00:00Z`).
  - Elapsed duration: `(07:00:00Z next day - 08:00:00Z today) = 23.0 hours`.
- **On Fall Transition Sunday (e.g., 2026-11-01):**
  - At start midnight (`2026-11-01T00:00:00`), it is 2 hours before the 2:00 a.m. clock repeat. The station is still in **Daylight Saving Time** (e.g., `-07:00` for PDT, UTC `07:00:00Z`).
  - At end midnight (`2026-11-02T00:00:00`), the clock has fallen back at 2:00 a.m. The station is in **Standard Time** (e.g., `-08:00` for PST, UTC `08:00:00Z`).
  - Elapsed duration: `(08:00:00Z next day - 07:00:00Z today) = 25.0 hours`.
- **On All Other Days:**
  - Both midnights have identical offsets, resulting in exactly `24.0 hours` (including leap day `2024-02-29`).

### 3.3 Station Policy Rules & Scopes
1. **Station Metadata Fields:**
   - `country_code`: Must be `"US"`. Non-US, missing, or unknown country codes are withheld (no geographic guessing from abbreviation).
   - `uses_daylight_savings`: Must be `"Y"` or `"N"`. Any other value is withheld.
   - `time_zone_abbreviation`: Must be present in the USGS registry.
2. **Fixed Offset Resolution (`uses_daylight_savings == "N"`):**
   - Resolves fixed 24.0-hour station days using the registry's `time_zone_utc_offset`.
   - Supports any valid US registry code (e.g., Arizona `MST`, Hawaii `HST`).
3. **Daylight Saving Time Resolution (`uses_daylight_savings == "Y"`):**
   - Strictly supported codes: `PST`, `MST`, `CST`, `EST`, `AKST`.
   - `HST` (Hawaii Standard Time) does not observe DST; any metadata pairing `HST` with `uses_daylight_savings == "Y"` is withheld.
4. **Policy Review Ceiling and Window:**
   - **Covered Range:** Years `2007` through `2026` (policy review date: `2026-10-12`, review ceiling: `2026-12-31`).
   - Dates before `2007-01-01` or after `2026-12-31` (e.g., `2027-01-01`) are structured as `status: "withheld"` with null timestamps. UTC is never assumed.
5. **Tampering and Integrity Enforcement:**
   - Station properties hash: `metadataHash` is computed deterministically using canonical SHA-256. If `metadataHash` is supplied and mismatches, tampering is caught and the day is withheld.
   - Registry integrity: The registry file hash is validated on load against pinned hashes. Malformed or tampered registry files are rejected with `status: "withheld"`.

---

## 4. Operational Forecast Timing Semantics

Function `forecast_timing(last_day, horizon_days, issue_time, properties)` establishes unambiguous timing relationships:

### 4.1 Inputs and Normalization
- `last_day`: Last observed completed calendar day string (`YYYY-MM-DD`) or `date`.
- `horizon_days`: Bounded integer `1..7`. Boolean values (`True`, `False`) are strictly rejected.
- `issue_time`: Must be a timezone-aware `datetime` object, normalized immediately to UTC (`issue_utc`).
- `properties`: Station metadata dictionary.

### 4.2 Observation Cutoff and Lag
- The observation cutoff interval `[obs_start_utc, obs_end_utc]` is resolved via `station_day(last_day, properties)`.
- `lagHours = (issue_utc - obs_end_utc).total_seconds() / 3600.0`.
- **E5 Gate (Completeness at issue):** If `issue_utc < obs_end_utc` (`lagHours < 0`), the observation day was not complete when the forecast was issued. Publication is withheld (`publicationEligible: False`, `status: "withheld"`).

### 4.3 Target Day and Lead Calculation
- Target date is `last_day + horizon_days`.
- Target interval `[target_start_utc, target_end_utc]` is resolved via `station_day(target_date, properties)`.
- `leadStartHours = (target_start_utc - issue_utc).total_seconds() / 3600.0`.
- `leadEndHours = (target_end_utc - issue_utc).total_seconds() / 3600.0`.

### 4.4 Status Vocabulary and Publication Eligibility
| Status | Condition | `publicationEligible` | Scientific Rationale |
|---|---|---|---|
| `future` | `issue_utc < target_start_utc` | `True` | Passes the timing gate only. Observation availability, model validation and the frozen publication policy must also pass. |
| `partly_elapsed` | `target_start_utc <= issue_utc < target_end_utc` | `False` | Part of the target day has already occurred at issue time. Withheld to prevent nowcast substitution. |
| `expired` | `issue_utc >= target_end_utc` | `False` | Target day is entirely in the past relative to issue time. |
| `withheld` | Incomplete observation, invalid inputs, unreviewed year, or metadata error | `False` | Fails temporal or policy integrity gates. |

#### Example: Pacific January 4-Hour Lag
- Station in Pacific Standard Time (`PST`, `-08:00`).
- Observation cutoff for `2026-01-15` ends at `2026-01-16T08:00:00Z` (`00:00:00` local).
- Forecast issued with 4 hours latency: `issue_time = 2026-01-16T12:00:00Z` (`lagHours = 4.0`).
- **Horizon 1 (`2026-01-16`):**
  - Target day interval: `2026-01-16T08:00:00Z` to `2026-01-17T08:00:00Z`.
  - At issue time (`12:00:00Z`), 4 hours of the target day have elapsed, leaving **20.0 hours remaining**.
  - `status: "partly_elapsed"`, `publicationEligible: False`.
- **Horizon 3 (`2026-01-18`):**
  - Target day interval: `2026-01-18T08:00:00Z` to `2026-01-19T08:00:00Z`.
  - `leadStartHours = +44.0`, `leadEndHours = +68.0`.
  - `status: "future"`, `publicationEligible: True`.

---

## 5. Limitations and Provenance Boundaries

1. **Station Metadata Point-in-Time:** Current station properties (`country_code`, `time_zone_abbreviation`, `uses_daylight_savings`) reflect current site attributes. They do not constitute historical proof of site relocation, time zone changes, or sensor aggregation history prior to the current vintage.
2. **Review Policy Ceiling:** Rules are verified through `2026-12-31`. Prospective deployment beyond 2026 requires formal review of federal and statutory daylight saving policies before advancing the review ceiling.
3. **No External Network Dependencies:** Calculations rely exclusively on the local frozen USGS registry and NIST transition algorithms.

## Integration review

The original writer's 17 timing tests passed independently. Coordinator added
strict rejection of boolean daylight flags and noncanonical date strings, plus
a 128 KiB bound before registry parsing. Every call checks a fresh pinned byte
snapshot; mutating a returned dictionary cannot change subsequent results or
hide a changed file behind a shared cache. Current focused suite: **19 passed**.

The two recorded response hashes differ because the USGS response contains a
dynamic timestamp. Both are dated receipts, not claims that the original
publication time or historical station metadata is known. The 2026 review
ceiling is an application rule; the statute itself is not described as expiring
on 31 December 2026. Existing forecast versions remain unchanged until a
separate, versioned integration and availability-aware validation is complete.

Independent Codex Luna review found that a non-null `tzinfo` can still have an
undefined UTC offset. Coordinator now rejects that pseudo-aware input before
normalization. Supplied empty/null/conflicting metadata hash aliases also fail
explicitly. The two new regressions bring the timing suite to **21 passed**;
the review was accepted for its findings, not as unconditional model approval.
