"""Synthetic prerequisite checks; no field availability, utility or skill claims."""
import copy
import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from service.observatory.forecast_information import METHOD, forecast_information
from service.observatory.gauge_time import ACTUAL_REGISTRY_HASH, RULE_VERSION
from service.observatory.vintage_contract import validate_gauge_snapshot, validate_gauge_vintage
from service.observatory.vintages import ObservationVintageLedger, canonical_hash, canonical_json
from service.tests.test_vintages import IDENTITY, PROPS, R1, R2, M1, record

ISSUE = '2026-01-04T12:00:00Z'


def rehash(snapshot, records=False):
    """Test-only adversarial self-rehash, never a trusted external pin."""
    if records:
        for item in snapshot['observations']:
            content = {k: item[k] for k in ('identity', 'date', 'value', 'quality',
                                          'qualifiers', 'stationTimeProperties')}
            item['contentHash'] = canonical_hash(content)
            item['stationPropertiesHash'] = canonical_hash(item['stationTimeProperties'])
            item['versionHash'] = canonical_hash({k: v for k, v in item.items() if k != 'versionHash'})
    snapshot['snapshotHash'] = canonical_hash({k: v for k, v in snapshot.items() if k != 'snapshotHash'})
    return snapshot


class ForecastInformationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.ledger = ObservationVintageLedger(Path(self.temp.name).resolve(), 'fixture', reserve_bytes=0)

    def capture(self, rows=None, at=ISSUE, props=None, response=R1):
        return self.ledger.capture(IDENTITY, rows if rows is not None else [record('2026-01-03')],
                                   station_time_properties=PROPS if props is None else props,
                                   response_hash=response, metadata_hash=M1, received_at=at)

    def snapshot(self, at=ISSUE, start='2026-01-01', end='2026-01-05'):
        return self.ledger.as_of(IDENTITY, at, start=start, end=end)

    def info(self, snapshot=None, **options):
        snap = snapshot if snapshot is not None else self.snapshot()
        defaults = dict(expected_snapshot_hash=snap['snapshotHash'], issue_time=snap['issueTime'])
        defaults.update(options)
        return forecast_information(snap, **defaults)

    def invalid(self, action, forecast=False):
        with self.assertRaises(ValueError) as raised:
            action()
        self.assertEqual(str(raised.exception), 'Invalid forecast information input' if forecast
                         else 'Invalid observation availability snapshot')
        self.assertIsNone(raised.exception.__cause__)

    def test_late_revision_old_asof_byte_exact_and_new_version_distinct(self):
        self.capture()
        early = self.snapshot()
        frozen = canonical_json(self.info(early))
        self.capture([record('2026-01-03', value=20, quality='approved')],
                     at='2026-01-05T12:00:00Z', response=R2)
        self.assertEqual(self.snapshot(), early)
        self.assertEqual(canonical_json(self.info(self.snapshot())), frozen)
        later = self.info(self.snapshot(at='2026-01-05T12:00:00Z'))
        self.assertEqual(later['points'][0]['value'], 20)
        self.assertEqual(later['ledger'][0]['record']['revision'], 2)
        self.assertNotEqual(later['report']['informationHash'], self.info(early)['report']['informationHash'])

    def test_self_rehashed_tamper_does_not_bypass_external_pin(self):
        self.capture()
        snap = self.snapshot()
        trusted = snap['snapshotHash']
        snap['observations'][0]['value'] = 999.0
        rehash(snap, records=True)
        validate_gauge_snapshot(snap)  # Integrity alone is not authenticity.
        self.invalid(lambda: self.info(snap, expected_snapshot_hash=trusted), forecast=True)
        with self.assertRaises(TypeError):
            forecast_information(snap, issue_time=ISSUE)

    def test_caller_mutation_at_copy_boundary_cannot_bypass_external_pin(self):
        self.capture(); snap = self.snapshot(); pin = snap['snapshotHash']
        def mutate_and_copy(value):
            value['observations'][0]['value'] = 999.0
            rehash(value, records=True)
            return copy.deepcopy(value)
        with patch('service.observatory.forecast_information.deepcopy', side_effect=mutate_and_copy):
            self.invalid(lambda: self.info(snap, expected_snapshot_hash=pin), forecast=True)

    def test_arbitrary_issue_instant_and_captured_wrapper_constraints(self):
        receipt = self.capture()
        later = self.snapshot(at='2026-01-04T13:01:02Z')
        self.assertIsNone(validate_gauge_snapshot(later, expected_issue_time='2026-01-04T05:01:02-08:00'))
        self.info(later, issue_time=datetime(2026, 1, 4, 13, 1, 2, tzinfo=timezone.utc))
        self.invalid(lambda: self.info(later, issue_time=ISSUE), forecast=True)
        request = dict(start=later['start'], end=later['end'])
        self.invalid(lambda: validate_gauge_vintage(dict(status='captured', receipt=receipt, snapshot=later),
                                                   request, '2026-01-06T00:00:00Z'))
        snap = self.snapshot()
        captured = dict(status='captured', receipt=receipt, snapshot=snap)
        validate_gauge_vintage(captured, request, ISSUE)
        self.invalid(lambda: validate_gauge_vintage(captured, request, '2026-01-04T11:59:59Z'))
        self.invalid(lambda: validate_gauge_vintage(captured, dict(start='2026-01-02', end=snap['end']), ISSUE))
        for change in (dict(insertedVersions=True), dict(insertedVersions=0, unchangedRecords=0),
                       dict(insertedVersions=2001), dict(policyVersion='unknown'),
                       dict(receivedAt='2026-01-04T12:00:00Z')):
            bad = copy.deepcopy(captured); bad['receipt'].update(change)
            self.invalid(lambda: validate_gauge_vintage(bad, request, ISSUE))

    def test_null_unknown_singleton_zero_and_all_source_lineage_preserved(self):
        self.capture([record('2026-01-01', 0, qualifiers=['P', 'A']),
                      record('2026-01-03', None, quality='withdrawn')])
        out = self.info()
        self.assertEqual(out['report']['counts'], dict(calendarDays=5, attemptedRecords=2,
            retainedRecords=1, excludedRecords=1, unknownCalendarDays=3, nullWithdrawals=1,
            unresolvedStationTime=0, incompleteAtIssue=0))
        self.assertEqual(out['report']['latestRetainedDate'], '2026-01-01')
        self.assertEqual(out['points'][0]['value'], 0.0)
        self.assertEqual(out['points'][0]['qualifiers'], ['A', 'P'])
        self.assertEqual([p['record'] for p in out['ledger']], self.snapshot()['observations'])
        self.assertEqual(out['ledger'][1]['reason'], 'null_withdrawal')
        self.assertEqual(set(out['points'][0]), {'date', 'value', 'quality', 'qualifiers', 'versionHash', 'interval'})

    def test_incomplete_day_excluded_and_targets_anchor_to_latest_completed_actual_day(self):
        self.capture([record('2026-01-03'), record('2026-01-04', 30)])
        out = self.info()
        self.assertEqual(out['report']['counts']['incompleteAtIssue'], 1)
        self.assertEqual(out['report']['latestRetainedDate'], '2026-01-03')
        self.assertEqual(out['ledger'][1]['reason'], 'incomplete_at_issue')
        self.assertEqual(out['report']['timingAttempts'][1]['targetInterval']['date'], '2026-01-06')

    def test_spring_and_fall_station_intervals_23_and_25_hours(self):
        self.capture([record('2026-03-08'), record('2026-11-01')], at='2026-11-02T12:00:00Z')
        out = self.info(self.snapshot(at='2026-11-02T12:00:00Z', start='2026-03-08', end='2026-11-02'))
        self.assertEqual([p['interval']['durationHours'] for p in out['points']], [23.0, 25.0])
        self.assertEqual(out['report']['stationTime']['registryHashes'], [ACTUAL_REGISTRY_HASH])
        self.assertEqual(out['report']['stationTime']['ruleVersion'], RULE_VERSION)

    def test_target_spring_and_fall_intervals_use_calendar_horizons(self):
        for day, issue, hours in (('2026-03-07', '2026-03-08T09:00:00Z', 23),
                                  ('2026-10-31', '2026-11-01T08:00:00Z', 25)):
            self.capture([record(day)], at=issue)
            attempt = self.info(self.snapshot(at=issue, start=day, end=day), horizons=(1,))['report']['timingAttempts'][0]
            self.assertEqual(attempt['targetInterval']['durationHours'], hours)
            self.assertFalse(attempt['timingEligible'])

    def test_exact_target_start_future_expired_and_no_auto_advance(self):
        self.capture(at='2026-01-04T08:00:00Z')
        snap = self.snapshot(at='2026-01-04T08:00:00Z')
        attempts = self.info(snap, horizons=(1, 3, 7))['report']['timingAttempts']
        self.assertEqual(attempts[0]['status'], 'partly_elapsed')
        self.assertEqual(attempts[0]['leadStartHours'], 0)
        self.assertFalse(attempts[0]['timingEligible'])
        self.assertTrue(attempts[1]['timingEligible'])
        late = self.info(self.snapshot(at='2026-01-12T12:00:00Z'))
        self.assertTrue(all(t['status'] == 'expired' and not t['timingEligible'] for t in late['report']['timingAttempts']))
        self.assertEqual([t['targetInterval']['date'] for t in late['report']['timingAttempts']],
                         ['2026-01-04', '2026-01-06', '2026-01-10'])
        self.assertNotIn('publicationEligible', canonical_json(late))

    def test_empty_null_only_or_incomplete_only_are_explicitly_withheld(self):
        empty = self.info()
        self.assertEqual(empty['report']['counts']['unknownCalendarDays'], 5)
        for out in (empty,):
            self.assertEqual(out['report']['reason'], 'no_eligible_day')
            self.assertIsNone(out['report']['latestRetainedDate'])
            self.assertTrue(all(t['status'] == 'withheld' and t['targetInterval'] is None for t in out['report']['timingAttempts']))
        self.capture([record('2026-01-04')])
        self.assertEqual(self.info()['report']['reason'], 'no_eligible_day')
        self.capture([record('2026-01-04', None)], at='2026-01-04T13:00:00Z')
        out = self.info(self.snapshot(at='2026-01-04T13:00:00Z'))
        self.assertEqual(out['report']['reason'], 'no_eligible_day')
        self.assertEqual(out['report']['counts']['nullWithdrawals'], 1)

    def test_unknown_metadata_withheld_and_known_other_day_survives(self):
        self.capture([record('2026-01-01')], props={})
        self.capture([record('2026-01-03')], at='2026-01-04T13:00:00Z')
        out = self.info(self.snapshot(at='2026-01-04T13:00:00Z'))
        self.assertEqual(out['report']['counts']['unresolvedStationTime'], 1)
        self.assertEqual(out['ledger'][0]['stationDay']['status'], 'withheld')
        self.assertEqual(out['report']['status'], 'resolved')
        self.assertEqual(out['report']['stationTime']['properties'], PROPS)

    def test_mixed_retained_metadata_withholds_without_guess_and_report_is_compact(self):
        self.capture([record('2026-01-01')])
        self.capture([record('2026-01-03')], at='2026-01-04T13:00:00Z',
                     props=dict(PROPS, time_zone_abbreviation='MST'))
        out = self.info(self.snapshot(at='2026-01-04T13:00:00Z'))
        self.assertEqual(out['report']['reason'], 'mixed_station_metadata')
        self.assertEqual(out['report']['counts']['retainedRecords'], 2)
        self.assertEqual(out['report']['stationTime']['retainedMetadataCount'], 2)
        self.assertIsNone(out['report']['stationTime']['properties'])
        self.assertIsNone(out['report']['stationTime']['stationPropertiesHash'])
        self.assertTrue(all(t['targetInterval'] is None and not t['timingEligible'] for t in out['report']['timingAttempts']))
        self.assertNotIn('versionHash', canonical_json(out['report']))

    def test_unknown_dst_zone_country_and_review_window_are_not_guessed(self):
        for props in ({}, dict(PROPS, uses_daylight_savings=None),
                      dict(PROPS, time_zone_abbreviation='UNKNOWN'), dict(PROPS, country_code='CA')):
            self.capture(at=ISSUE, props=props)
            out = self.info()
            self.assertEqual(out['report']['reason'], 'no_eligible_day')
            self.assertEqual(out['report']['counts']['unresolvedStationTime'], 1)
            # Clear fixture between incompatible equal-time revisions.
            self.ledger = ObservationVintageLedger(Path(self.temp.name).resolve(), canonical_hash(props), reserve_bytes=0)
        self.capture([record('2006-01-01')], at='2026-01-04T14:00:00Z', props=PROPS)
        old = self.info(self.snapshot(at='2026-01-04T14:00:00Z', start='2006-01-01', end='2006-01-01'))
        self.assertEqual(old['report']['counts']['unresolvedStationTime'], 1)
        self.capture([record('2026-12-31')], at='2027-01-01T12:00:00Z')
        boundary = self.info(self.snapshot(at='2027-01-01T12:00:00Z', start='2026-12-31', end='2026-12-31'))
        self.assertEqual(boundary['report']['timingAttempts'][0]['status'], 'withheld')
        self.assertFalse(boundary['report']['timingAttempts'][0]['timingEligible'])

    def test_horizons_unique_sorted_bounded_bool_rejected(self):
        self.capture()
        out = self.info(horizons=[7, 1, 3, 1])
        self.assertEqual([t['horizonDays'] for t in out['report']['timingAttempts']], [1, 3, 7])
        self.assertEqual(out, self.info(horizons=(1, 3, 7)))
        self.assertEqual(len(self.info(horizons=tuple(range(1, 8)))['report']['timingAttempts']), 7)
        for invalid in ((), [True], [0], [8], [1.0], [1] * 8, '137', {1, 3}, iter([1, 3])):
            self.invalid(lambda: self.info(horizons=invalid), forecast=True)

    def test_detached_copies_input_internal_sections_and_subsequent_calls(self):
        self.capture([record('2026-01-03', qualifiers=['P'])])
        snap = self.snapshot(); before = copy.deepcopy(snap)
        out = self.info(snap); frozen = copy.deepcopy(out)
        out['points'][0]['qualifiers'].append('A')
        out['points'][0]['interval']['durationHours'] = 999
        out['report']['stationTime']['properties']['country_code'] = 'CA'
        self.assertEqual(out['ledger'], frozen['ledger'])
        self.assertEqual(snap, before)
        self.assertEqual(self.info(snap), frozen)
        snap['observations'][0]['qualifiers'].append('NEW')
        self.assertEqual(frozen['points'][0]['qualifiers'], ['P'])

    def test_information_hash_binds_all_sections_and_canonical_json_is_finite(self):
        self.capture()
        out = self.info()
        digest = out['report'].pop('informationHash')
        self.assertEqual(canonical_hash(out), digest)
        self.assertEqual(out['report']['method'], METHOD)
        self.assertEqual(json.loads(canonical_json(out)), out)
        self.assertLess(len(canonical_json(out['report']).encode()), 8192)

    def test_duplicate_days_order_population_and_schema_tampering_rejected_even_rehashed(self):
        self.capture([record('2026-01-01'), record('2026-01-03')])
        snap = self.snapshot()
        changes = (
            lambda s: s['observations'].reverse(),
            lambda s: s['observations'].append(copy.deepcopy(s['observations'][0])),
            lambda s: s.update(unknownDays=0), lambda s: s.update(calendarDays=True),
            lambda s: s.update(extra='PRIVATE'), lambda s: s.update(start='20260101'),
            lambda s: s.update(end='2026-01-00'), lambda s: s.update(policyVersion='unknown'),
            lambda s: s.update(availabilityBasis='publication'),
            lambda s: s['observations'][0].update(extra='PRIVATE'),
            lambda s: s['observations'][0].update(revision=True),
            lambda s: s['observations'][0].update(revision=100001),
            lambda s: s['observations'][0]['identity'].update(timeSeriesId='different'),
            lambda s: s['observations'][0].update(date='2026-01-06'),
        )
        for change in changes:
            bad = copy.deepcopy(snap); change(bad); rehash(bad, records=True)
            self.invalid(lambda: validate_gauge_snapshot(bad))

    def test_finite_values_and_json_text_collection_bounds(self):
        self.capture(); snap = self.snapshot()
        for value in (True, -1, float('nan'), float('inf'), -float('inf'), 10**400, '10'):
            bad = copy.deepcopy(snap); bad['observations'][0]['value'] = value
            self.invalid(lambda: validate_gauge_snapshot(bad))
        for change in (dict(quality='q' * 257), dict(qualifiers=['q' * 65]),
                       dict(qualifiers=['P'] * 17), dict(qualifiers=['P', 'P']),
                       dict(stationTimeProperties=dict(PROPS, extra='PRIVATE'))):
            bad = copy.deepcopy(snap); bad['observations'][0].update(change); rehash(bad, records=True)
            self.invalid(lambda: validate_gauge_snapshot(bad))
        with patch('service.observatory.vintage_contract.MAX_RECORD_BYTES', 1):
            self.invalid(lambda: validate_gauge_snapshot(snap))
        with patch('service.observatory.vintage_contract.MAX_SNAPSHOT_BYTES', 1):
            self.invalid(lambda: validate_gauge_snapshot(snap))

    def test_hard_2000_calendar_and_record_cap_and_compact_report(self):
        rows = [record((date(2020, 1, 1) + timedelta(days=i)).isoformat(), i) for i in range(2000)]
        self.capture(rows)
        snap = self.snapshot(start=rows[0]['date'], end=rows[-1]['date'])
        out = self.info(snap)
        self.assertEqual(len(out['ledger']), 2000)
        self.assertEqual(len(out['points']), 2000)
        self.assertLess(len(canonical_json(out['report']).encode()), 8192)
        bad = copy.deepcopy(snap); bad['calendarDays'] += 1
        bad['end'] = (date.fromisoformat(bad['end']) + timedelta(days=1)).isoformat()
        bad['unknownDays'] = 1; rehash(bad)
        self.invalid(lambda: validate_gauge_snapshot(bad))
        bad = copy.deepcopy(snap); bad['observations'].append(copy.deepcopy(bad['observations'][-1])); rehash(bad)
        self.invalid(lambda: validate_gauge_snapshot(bad))

    def test_identity_hash_timestamp_and_station_schema_bounds(self):
        self.capture(); snap = self.snapshot()
        for change in (
            lambda s: s['identity'].update(station='PRIVATE/path'),
            lambda s: s['identity'].update(timeSeriesId='a' * 129),
            lambda s: s['identity'].update(parameter='00065'),
            lambda s: s['identity'].update(unit='m^3/s'),
            lambda s: s.update(issueTime='2026-01-04T12:00:00Z'),
            lambda s: s['observations'][0].update(receivedAt='2026-01-04T12:00:01.000000Z'),
            lambda s: s['observations'][0].update(firstReceivedAt='2026-01-05T12:00:00.000000Z'),
            lambda s: s['observations'][0].update(receivedAt='2026-01-04T12:00:00-00:00'),
            lambda s: s['observations'][0].update(sourceResponseHash='A' * 64),
            lambda s: s['observations'][0].update(sourceMetadataHash='PRIVATE/path'),
            lambda s: s['observations'][0].update(stationTimeProperties=[]),
        ):
            bad = copy.deepcopy(snap); change(bad); rehash(bad)
            self.invalid(lambda: validate_gauge_snapshot(bad))
        for invalid in (None, [], {}, 'PRIVATE/path'):
            self.invalid(lambda: validate_gauge_snapshot(invalid))
        for issue in ('PRIVATE/path', '2026-01-04T12:00:00', datetime(2026, 1, 4), None):
            self.invalid(lambda: self.info(snap, issue_time=issue), forecast=True)

    def test_every_internal_hash_is_checked_with_outer_hash_recomputed(self):
        self.capture(); snap = self.snapshot()
        for key in ('contentHash', 'stationPropertiesHash', 'versionHash'):
            bad = copy.deepcopy(snap); bad['observations'][0][key] = '0' * 64
            rehash(bad)
            self.invalid(lambda: validate_gauge_snapshot(bad))
        bad = copy.deepcopy(snap); bad['snapshotHash'] = '0' * 64
        self.invalid(lambda: validate_gauge_snapshot(bad))
        for pin in (None, '0' * 64, 'A' * 64, [], 'PRIVATE/path'):
            self.invalid(lambda: self.info(snap, expected_snapshot_hash=pin), forecast=True)

    def test_empty_valid_snapshot_and_unavailable_capture_wrapper(self):
        snap = self.snapshot()
        self.assertIsNone(validate_gauge_snapshot(snap))
        validate_gauge_vintage(dict(status='unavailable', reason='ledger_unavailable'), {}, ISSUE)
        for bad in (dict(status='unavailable', reason='PRIVATE/path'),
                    dict(status='unavailable', reason='storage_limit', extra=True)):
            self.invalid(lambda: validate_gauge_vintage(bad, {}, ISSUE))


if __name__ == '__main__':
    unittest.main()
