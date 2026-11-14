"""Unit tests for isolated station-day timing primitive and forecast lead calculations."""
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone, tzinfo
from pathlib import Path

from service.observatory.gauge_time import (
    ACTUAL_REGISTRY_HASH,
    BRIEF_REGISTRY_HASH,
    POLICY_MAX_DATE,
    RULE_VERSION,
    compute_metadata_hash,
    compute_registry_hash,
    forecast_timing,
    get_dst_dates,
    load_registry,
    parse_offset_str,
    station_day,
)


class TestGaugeTime(unittest.TestCase):
    def test_boolean_daylight_flags_and_noncanonical_dates_are_not_assumed(self):
        props={'country_code':'US','time_zone_abbreviation':'PST','uses_daylight_savings':'Y'}
        for flag in (True,False):
            self.assertEqual(station_day('2026-06-01',dict(props,uses_daylight_savings=flag))['status'],'withheld')
        for day in ('20260601','2026-W23-1'):
            self.assertEqual(station_day(day,props)['status'],'withheld')

    def test_registry_bytes_and_returned_objects_remain_pinned(self):
        from pathlib import Path
        from service.observatory.gauge_time import DEFAULT_REGISTRY_PATH,load_registry,RegistryIntegrityError,MAX_REGISTRY_BYTES
        codes,_=load_registry()
        codes['PST']['time_zone_utc_offset']='+01:00'
        fresh,_=load_registry()
        self.assertEqual(fresh['PST']['time_zone_utc_offset'],'-08:00')
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'registry.json';path.write_bytes(DEFAULT_REGISTRY_PATH.read_bytes())
            load_registry(path)
            path.write_bytes(b'x'*(MAX_REGISTRY_BYTES+1))
            with self.assertRaises(RegistryIntegrityError):load_registry(path)

    def setUp(self):
        self.pst_y = {
            "country_code": "US",
            "time_zone_abbreviation": "PST",
            "uses_daylight_savings": "Y",
        }
        self.mst_n = {
            "country_code": "US",
            "time_zone_abbreviation": "MST",
            "uses_daylight_savings": "N",
        }
        self.cst_y = {
            "country_code": "US",
            "time_zone_abbreviation": "CST",
            "uses_daylight_savings": "Y",
        }
        self.est_y = {
            "country_code": "US",
            "time_zone_abbreviation": "EST",
            "uses_daylight_savings": "Y",
        }
        self.akst_y = {
            "country_code": "US",
            "time_zone_abbreviation": "AKST",
            "uses_daylight_savings": "Y",
        }
        self.hst_n = {
            "country_code": "US",
            "time_zone_abbreviation": "HST",
            "uses_daylight_savings": "N",
        }

    # 1. Fixed MST N tests
    def test_fixed_mst_n(self):
        """US metadata N + known registry offset resolves fixed 24h day year-round."""
        for test_date in ("2026-01-15", "2026-03-08", "2026-07-04", "2026-11-01"):
            res = station_day(test_date, self.mst_n)
            self.assertEqual(res["status"], "resolved")
            self.assertEqual(res["durationHours"], 24.0)
            self.assertEqual(res["timezoneCode"], "MST")
            self.assertEqual(res["dstflag"], "N")
            self.assertEqual(res["startOffset"], "-07:00")
            self.assertEqual(res["endOffset"], "-07:00")
            self.assertTrue(res["start"].endswith("-07:00"))
            self.assertTrue(res["end"].endswith("-07:00"))
            # Check UTC conversion: 00:00:00 MST is 07:00:00 UTC
            self.assertTrue(res["startUtc"].endswith("07:00:00Z"))
            self.assertTrue(res["endUtc"].endswith("07:00:00Z"))
            self.assertEqual(res["ruleVersion"], RULE_VERSION)
            self.assertTrue(len(res["notes"]) >= 6)

    # 2. Unknown country, flag, zone, naive issue tests
    def test_unknown_country(self):
        """Non-US or unknown country withheld with null timestamps."""
        props = {"country_code": "CA", "time_zone_abbreviation": "PST", "uses_daylight_savings": "Y"}
        res = station_day("2026-06-01", props)
        self.assertEqual(res["status"], "withheld")
        self.assertIn("Unsupported country", res["reason"])
        self.assertIsNone(res["start"])
        self.assertIsNone(res["end"])
        self.assertIsNone(res["startUtc"])
        self.assertIsNone(res["endUtc"])
        self.assertIsNone(res["durationHours"])

    def test_unknown_flag(self):
        """Missing or non-Y/N daylight savings flag withheld with null timestamps."""
        props = {"country_code": "US", "time_zone_abbreviation": "PST", "uses_daylight_savings": "UNKNOWN"}
        res = station_day("2026-06-01", props)
        self.assertEqual(res["status"], "withheld")
        self.assertIn("Unknown daylight savings flag", res["reason"])
        self.assertIsNone(res["start"])
        self.assertIsNone(res["startUtc"])

    def test_unknown_zone(self):
        """Unrecognized time zone abbreviation not in USGS registry withheld."""
        props = {"country_code": "US", "time_zone_abbreviation": "XYZ", "uses_daylight_savings": "N"}
        res = station_day("2026-06-01", props)
        self.assertEqual(res["status"], "withheld")
        self.assertIn("Unknown time zone code", res["reason"])
        self.assertIsNone(res["start"])

    def test_unsupported_dst_zone_hst(self):
        """HST with uses_daylight_savings='Y' is rejected (HST does not observe DST)."""
        props = {"country_code": "US", "time_zone_abbreviation": "HST", "uses_daylight_savings": "Y"}
        res = station_day("2026-06-01", props)
        self.assertEqual(res["status"], "withheld")
        self.assertIn("not supported", res["reason"].lower())
        self.assertIsNone(res["start"])

    def test_pseudo_aware_issue_time_with_undefined_offset_is_withheld(self):
        class UndefinedOffset(tzinfo):
            def utcoffset(self,dt):return None
            def dst(self,dt):return None
        issue=datetime(2026,1,16,12,tzinfo=UndefinedOffset())
        result=forecast_timing('2026-01-15',3,issue,self.pst_y)
        self.assertEqual(result['status'],'withheld')
        self.assertFalse(result['publicationEligible'])

    def test_supplied_empty_or_conflicting_metadata_hash_is_withheld(self):
        for key in ('metadataHash','metadata_hash','expectedMetadataHash'):
            for value in ('',None,False):
                result=station_day('2026-06-01',dict(self.pst_y,**{key:value}))
                self.assertEqual(result['status'],'withheld')
        good=compute_metadata_hash(self.pst_y)
        result=station_day('2026-06-01',dict(self.pst_y,metadataHash=good,metadata_hash=''))
        self.assertEqual(result['status'],'withheld')
        result=station_day('2026-06-01',dict(self.pst_y,metadataHash=good,metadata_hash=good))
        self.assertEqual(result['status'],'resolved')

    def test_naive_issue_time(self):
        """Naive issue_time rejected in forecast_timing."""
        naive_issue = datetime(2026, 1, 16, 12, 0, 0)
        res = forecast_timing("2026-01-15", 1, naive_issue, self.pst_y)
        self.assertEqual(res["status"], "withheld")
        self.assertFalse(res["publicationEligible"])
        self.assertIn("timezone-aware", res["reason"])

    # 3. Negative or bool h tests
    def test_negative_or_bool_horizon(self):
        """Horizon must be int bounded 1..7; negative, zero, >7 and booleans rejected."""
        issue = datetime(2026, 1, 16, 12, 0, 0, tzinfo=timezone.utc)
        for bad_h in (-1, 0, 8, True, False, "1", 3.5):
            res = forecast_timing("2026-01-15", bad_h, issue, self.pst_y)
            self.assertEqual(res["status"], "withheld", f"Failed for h={bad_h!r}")
            self.assertFalse(res["publicationEligible"], f"Failed for h={bad_h!r}")
            self.assertIn("Horizon must be an integer bounded between 1 and 7", res["reason"])

    # 4. Pacific Jan lag (4 hours lag, h1 partly elapsed withheld 20h remaining)
    def test_pacific_jan_lag_h1_partly_elapsed(self):
        """Pacific Jan lag: 4h lag, h1 target day is partly elapsed (20h remaining => withheld)."""
        # last_day is 2026-01-15 (PST: start 2026-01-15T08:00:00Z, end 2026-01-16T08:00:00Z)
        # 4 hours lag => issue_time is 2026-01-16T12:00:00Z
        issue_time = datetime(2026, 1, 16, 12, 0, 0, tzinfo=timezone.utc)
        res = forecast_timing("2026-01-15", 1, issue_time, self.pst_y)

        self.assertEqual(res["status"], "partly_elapsed")
        self.assertFalse(res["publicationEligible"])
        self.assertEqual(res["lagHours"], 4.0)
        self.assertEqual(res["observationCutoff"]["date"], "2026-01-15")
        self.assertEqual(res["observationCutoff"]["startUtc"], "2026-01-15T08:00:00Z")
        self.assertEqual(res["observationCutoff"]["endUtc"], "2026-01-16T08:00:00Z")

        # Target day is 2026-01-16 (starts 2026-01-16T08:00:00Z, ends 2026-01-17T08:00:00Z)
        self.assertEqual(res["targetInterval"]["date"], "2026-01-16")
        self.assertEqual(res["targetInterval"]["startUtc"], "2026-01-16T08:00:00Z")
        self.assertEqual(res["targetInterval"]["endUtc"], "2026-01-17T08:00:00Z")

        # 4 hours elapsed at issue (12:00 vs 08:00); exactly 20.0 hours remaining
        self.assertEqual(res["leadStartHours"], -4.0)
        self.assertEqual(res["leadEndHours"], 20.0)
        self.assertIn("20.0h remaining", res["reason"])

    # 5. h3 future positive lead test
    def test_pacific_jan_h3_future_positive_lead(self):
        """With 4h lag, h3 target day (2026-01-18) starts after issue => positive lead and publication eligible."""
        issue_time = datetime(2026, 1, 16, 12, 0, 0, tzinfo=timezone.utc)
        res = forecast_timing("2026-01-15", 3, issue_time, self.pst_y)

        self.assertEqual(res["status"], "future")
        self.assertTrue(res["publicationEligible"])
        self.assertEqual(res["lagHours"], 4.0)
        self.assertEqual(res["targetInterval"]["date"], "2026-01-18")
        self.assertEqual(res["targetInterval"]["startUtc"], "2026-01-18T08:00:00Z")
        self.assertEqual(res["targetInterval"]["endUtc"], "2026-01-19T08:00:00Z")

        # 2026-01-18T08:00:00Z minus 2026-01-16T12:00:00Z = 44 hours
        self.assertEqual(res["leadStartHours"], 44.0)
        # 2026-01-19T08:00:00Z minus 2026-01-16T12:00:00Z = 68 hours
        self.assertEqual(res["leadEndHours"], 68.0)
        self.assertIn("positive lead", res["reason"])

    # 6. Leap day test
    def test_leap_day_2024(self):
        """2024-02-29 leap day resolves cleanly as 24.0h standard day."""
        res = station_day("2024-02-29", self.pst_y)
        self.assertEqual(res["status"], "resolved")
        self.assertEqual(res["durationHours"], 24.0)
        self.assertEqual(res["start"], "2024-02-29T00:00:00-08:00")
        self.assertEqual(res["end"], "2024-03-01T00:00:00-08:00")
        self.assertEqual(res["startUtc"], "2024-02-29T08:00:00Z")
        self.assertEqual(res["endUtc"], "2024-03-01T08:00:00Z")
        self.assertEqual(res["timezoneCode"], "PST")

    # 7. 2024/2026 spring 23h/fall 25h and midnight offset differences
    def test_spring_fall_transitions_and_midnight_offsets(self):
        """Verify 2024 and 2026 spring 23h and fall 25h transitions and midnight offset differences."""
        # 2024 DST dates: Spring 2024-03-10, Fall 2024-11-03
        # 2024 Spring: 2024-03-10
        sp24 = station_day("2024-03-10", self.pst_y)
        self.assertEqual(sp24["status"], "resolved")
        self.assertEqual(sp24["durationHours"], 23.0)
        self.assertEqual(sp24["startOffset"], "-08:00")
        self.assertEqual(sp24["endOffset"], "-07:00")
        self.assertEqual(sp24["start"], "2024-03-10T00:00:00-08:00")
        self.assertEqual(sp24["end"], "2024-03-11T00:00:00-07:00")
        self.assertEqual(sp24["startUtc"], "2024-03-10T08:00:00Z")
        self.assertEqual(sp24["endUtc"], "2024-03-11T07:00:00Z")
        self.assertEqual(sp24["timezoneCode"], "PST")
        self.assertEqual(sp24["endCode"], "PDT")

        # 2024 Fall: 2024-11-03
        fa24 = station_day("2024-11-03", self.pst_y)
        self.assertEqual(fa24["status"], "resolved")
        self.assertEqual(fa24["durationHours"], 25.0)
        self.assertEqual(fa24["startOffset"], "-07:00")
        self.assertEqual(fa24["endOffset"], "-08:00")
        self.assertEqual(fa24["start"], "2024-11-03T00:00:00-07:00")
        self.assertEqual(fa24["end"], "2024-11-04T00:00:00-08:00")
        self.assertEqual(fa24["startUtc"], "2024-11-03T07:00:00Z")
        self.assertEqual(fa24["endUtc"], "2024-11-04T08:00:00Z")
        self.assertEqual(fa24["timezoneCode"], "PDT")
        self.assertEqual(fa24["endCode"], "PST")

        # 2026 DST dates: Spring 2026-03-08, Fall 2026-11-01
        # 2026 Spring: 2026-03-08
        sp26 = station_day("2026-03-08", self.pst_y)
        self.assertEqual(sp26["status"], "resolved")
        self.assertEqual(sp26["durationHours"], 23.0)
        self.assertEqual(sp26["startOffset"], "-08:00")
        self.assertEqual(sp26["endOffset"], "-07:00")
        self.assertEqual(sp26["start"], "2026-03-08T00:00:00-08:00")
        self.assertEqual(sp26["end"], "2026-03-09T00:00:00-07:00")
        self.assertEqual(sp26["startUtc"], "2026-03-08T08:00:00Z")
        self.assertEqual(sp26["endUtc"], "2026-03-09T07:00:00Z")
        self.assertEqual(sp26["timezoneCode"], "PST")
        self.assertEqual(sp26["endCode"], "PDT")

        # 2026 Fall: 2026-11-01
        fa26 = station_day("2026-11-01", self.pst_y)
        self.assertEqual(fa26["status"], "resolved")
        self.assertEqual(fa26["durationHours"], 25.0)
        self.assertEqual(fa26["startOffset"], "-07:00")
        self.assertEqual(fa26["endOffset"], "-08:00")
        self.assertEqual(fa26["start"], "2026-11-01T00:00:00-07:00")
        self.assertEqual(fa26["end"], "2026-11-02T00:00:00-08:00")
        self.assertEqual(fa26["startUtc"], "2026-11-01T07:00:00Z")
        self.assertEqual(fa26["endUtc"], "2026-11-02T08:00:00Z")
        self.assertEqual(fa26["timezoneCode"], "PDT")
        self.assertEqual(fa26["endCode"], "PST")

        # Verify EST and AKST also follow spring/fall rules
        est_sp26 = station_day("2026-03-08", self.est_y)
        self.assertEqual(est_sp26["durationHours"], 23.0)
        self.assertEqual(est_sp26["startOffset"], "-05:00")
        self.assertEqual(est_sp26["endOffset"], "-04:00")

        akst_sp26 = station_day("2026-03-08", self.akst_y)
        self.assertEqual(akst_sp26["durationHours"], 23.0)
        self.assertEqual(akst_sp26["startOffset"], "-09:00")
        self.assertEqual(akst_sp26["endOffset"], "-08:00")

    # 8. Review ceiling 2027 withheld test
    def test_review_ceiling_2027_and_prior_years_withheld(self):
        """Review policy ceiling 2026-12-31 withholds 2027 and unsupported pre-2007 years."""
        # Valid boundary: 2026-12-31
        valid_res = station_day("2026-12-31", self.pst_y)
        self.assertEqual(valid_res["status"], "resolved")
        self.assertEqual(valid_res["durationHours"], 24.0)

        # 2027-01-01 is unreviewed future year
        future_res = station_day("2027-01-01", self.pst_y)
        self.assertEqual(future_res["status"], "withheld")
        self.assertIn("Unreviewed future year", future_res["reason"])
        self.assertIsNone(future_res["start"])
        self.assertIsNone(future_res["end"])
        self.assertIsNone(future_res["durationHours"])

        # Pre-2007 is unsupported year
        hist_res = station_day("2006-12-31", self.pst_y)
        self.assertEqual(hist_res["status"], "withheld")
        self.assertIn("Unsupported historical year", hist_res["reason"])
        self.assertIsNone(hist_res["start"])

    # 9. Source hash / metadata hash tampering or invalid registry
    def test_metadata_hash_tampering(self):
        """Altered or mismatched metadataHash is detected and withheld."""
        tampered_props = dict(self.pst_y)
        tampered_props["metadataHash"] = "tampered_hash_00000000000000000000000000000000"
        res = station_day("2026-06-01", tampered_props)
        self.assertEqual(res["status"], "withheld")
        self.assertIn("Metadata hash tampering detected", res["reason"])
        self.assertIsNone(res["start"])

    def test_registry_source_hash_tampering_or_invalid_registry(self):
        """Invalid registry path, corrupt registry, or hash mismatch triggers withheld."""
        # 1. Custom expected hash mismatch
        res_mismatch = station_day(
            "2026-06-01",
            self.pst_y,
            expected_registry_hash="bad_hash_1234567890abcdef1234567890abcdef",
        )
        self.assertEqual(res_mismatch["status"], "withheld")
        self.assertIn("Registry tampering or invalid registry", res_mismatch["reason"])

        # 2. Nonexistent registry file
        res_missing = station_day("2026-06-01", self.pst_y, registry_path="/nonexistent/path.json")
        self.assertEqual(res_missing["status"], "withheld")
        self.assertIn("Registry file not found", res_missing["reason"])

        # 3. Corrupt registry JSON
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=True) as tf:
            tf.write('{"features": "not a list"}')
            tf.flush()
            res_corrupt = station_day("2026-06-01", self.pst_y, registry_path=tf.name, expected_registry_hash="anything")
            self.assertEqual(res_corrupt["status"], "withheld")

    def test_incomplete_observed_day_at_issue(self):
        """If issue_time is earlier than observation cutoff end, publication is withheld."""
        # Observation cutoff for 2026-01-15 ends at 2026-01-16T08:00:00Z
        # Issue time at 2026-01-16T06:00:00Z is 2 hours before completion
        issue_time = datetime(2026, 1, 16, 6, 0, 0, tzinfo=timezone.utc)
        res = forecast_timing("2026-01-15", 1, issue_time, self.pst_y)
        self.assertEqual(res["status"], "withheld")
        self.assertFalse(res["publicationEligible"])
        self.assertEqual(res["lagHours"], -2.0)
        self.assertIn("was not complete at issue time", res["reason"])

    def test_expired_target_day(self):
        """If issue_time is after the target day ends, status is expired."""
        # Target day for h=1 from 2026-01-15 ends at 2026-01-17T08:00:00Z
        # Issue time on 2026-01-18 is after target end
        issue_time = datetime(2026, 1, 18, 0, 0, 0, tzinfo=timezone.utc)
        res = forecast_timing("2026-01-15", 1, issue_time, self.pst_y)
        self.assertEqual(res["status"], "expired")
        self.assertFalse(res["publicationEligible"])
        self.assertIn("expired", res["reason"])

    def test_hawaii_fixed_day_n(self):
        """Hawaii station with uses_daylight_savings='N' resolves fixed 24h day at -10:00."""
        res = station_day("2026-07-04", self.hst_n)
        self.assertEqual(res["status"], "resolved")
        self.assertEqual(res["durationHours"], 24.0)
        self.assertEqual(res["timezoneCode"], "HST")
        self.assertEqual(res["startOffset"], "-10:00")
        self.assertEqual(res["endOffset"], "-10:00")
        self.assertEqual(res["start"], "2026-07-04T00:00:00-10:00")
        self.assertEqual(res["startUtc"], "2026-07-04T10:00:00Z")


if __name__ == "__main__":
    unittest.main()
