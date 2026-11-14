"""Fixed public DEVELOPMENT sources, not final forecast evaluation or field truth."""
from collections import Counter
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from service.observatory import forecast_policy as fp, providers
from service.observatory.net import Transfer
from service.observatory.vintages import ObservationVintageLedger

FIXTURE = Path(__file__).resolve().parents[2] / 'examples/gauge-quality-admission'


class RealGaugeAdmissionTests(unittest.TestCase):
    def check_station(self, number, expected_approvals, expected_flags):
        summary = json.loads((FIXTURE / 'receipt-summary.json').read_bytes())
        sources = {}
        for kind in ('station', 'daily'):
            name = kind + '_USGS-' + number
            raw = (FIXTURE / 'sources' / (name + '.json')).read_bytes()
            receipt = json.loads((FIXTURE / 'sources' / (name + '_receipt.json')).read_bytes())
            self.assertLessEqual(len(raw), 2 * 1024**2)
            self.assertEqual(len(raw), receipt['byte_count'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), summary['sourceFileHashes'][name])
            self.assertEqual(receipt['sha256'], summary['sourceFileHashes'][name])
            self.assertEqual(receipt['status'], 200)
            sources[kind] = raw, receipt
        metadata = json.loads(sources['station'][0])
        x, y = metadata['geometry']['coordinates']
        area = dict(type='Polygon', coordinates=[[[x-.01,y-.01],[x+.01,y-.01],
                    [x+.01,y+.01],[x-.01,y+.01],[x-.01,y-.01]]])

        class SavedBudget:
            def fetch(_, url, **kwargs):
                kind = 'station' if '/monitoring-locations/items/' in url else 'daily'
                if kind == 'daily':
                    self.assertEqual(parse_qs(urlsplit(url).query)['datetime'], ['2021-10-02/2025-09-30'])
                    self.assertEqual(parse_qs(urlsplit(url).query)['monitoring_location_id'], ['USGS-' + number])
                raw, receipt = sources[kind]
                return Transfer(raw, url, receipt['sha256'], receipt['completion_utc'])

        payloads = []
        bundle = providers.usgs_daily(dict(area=area, start='2021-10-02', end='2025-09-30',
                                          options=dict(gaugeId=number)), SavedBudget(), capture=payloads.append)
        self.assertEqual(len(payloads), 1)
        payload = payloads[0]
        self.assertEqual(bundle['observations'], 1460)
        self.assertEqual(len(payload['records']), 1460)
        expected_days = [(date(2021, 10, 2) + timedelta(days=i)).isoformat() for i in range(1460)]
        self.assertEqual([r['date'] for r in payload['records']], expected_days)
        self.assertEqual(Counter(r['quality'] for r in payload['records']), expected_approvals)
        self.assertEqual(Counter(flag for r in payload['records'] for flag in r['qualifiers']), expected_flags)
        case = next(c for c in summary['cases'] if c['station'] == 'USGS-' + number)
        with tempfile.TemporaryDirectory() as root:
            # Offline fixture only: production admission/reserve remains unchanged.
            ledger = ObservationVintageLedger(Path(root).resolve(), 'real-admission-fixture', reserve_bytes=0)
            ledger.capture(payload['identity'], payload['records'], station_time_properties=payload['stationTime'],
                           response_hash=payload['responseHash'], metadata_hash=payload['metadataHash'],
                           received_at=payload['receivedAt'])
            snapshot = ledger.as_of(payload['identity'], case['freezeTime'], start='2021-10-02', end='2025-09-30')
        self.assertEqual(snapshot['snapshotHash'], case['snapshotHash'])
        self.assertEqual(snapshot['unknownDays'], 0)
        with patch.object(fp.forecasts, 'evaluate_gauge', side_effect=AssertionError('unexpected fitting')), \
             patch.object(fp.forecasts, '_evaluate_gauge', side_effect=AssertionError('unexpected fitting')):
            policy = fp.freeze_policy(snapshot, expected_snapshot_hash=case['snapshotHash'], freeze_time=case['freezeTime'])
        self.assertEqual(policy['status'], 'withheld')
        self.assertEqual(policy['reason'], 'unsupported_quality')
        self.assertEqual(policy['development'], [])
        self.assertEqual(policy['sourceSnapshot'], snapshot)
        self.assertEqual(policy['policyHash'], case['policyHash'])

    def test_provisional_history_is_retained_and_blocks_strict_development(self):
        self.check_station('09421500', {'Approved': 1327, 'Provisional': 133}, {})

    def test_approved_history_preserves_estimated_and_interpolated_flags(self):
        self.check_station('03339000', {'Approved': 1460}, {'ESTIMATED': 144, 'FORCEINTERPOLATION': 7})


if __name__ == '__main__':
    unittest.main()
