"""Real provider contract -> captured snapshot -> reproducible timing disclosure."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from service.assessment_validation import validate_assessment_manifest
from service.observatory.forecast_information import forecast_information
from service.tests import test_vintage_integration as fixtures
from service.tests.test_observatory_providers import daily


class ForecastInformationIntegrationTests(unittest.TestCase):
    def test_real_frozen_retrieval_reproduces_expired_targets_without_backdating(self):
        from service.verify_gauge_vintage import verify
        self.assertEqual(verify()['observedDays'],3)
        root=Path(__file__).resolve().parents[2]/'examples/gauge-vintage-receipt'
        snapshot=json.loads((root/'capture.json').read_text())[0]['snapshot']
        pin='af5a11a94aec157726724c311fef561393b40df0076dfa8933cc6bad2a6202b6'
        report=forecast_information(snapshot,expected_snapshot_hash=pin,issue_time=snapshot['issueTime'])['report']
        self.assertEqual(report,json.loads((root/'forecast-information.json').read_text()))
        self.assertEqual(report['latestRetainedDate'],'2025-06-03')
        self.assertEqual(report['counts']['retainedRecords'],3)
        self.assertTrue(all(a['status']=='expired' and not a['timingEligible'] for a in report['timingAttempts']))

    def fixture(self, root):
        return fixtures.VintageIntegrationTests().run_fixture(root, [daily('2025-06-01','100')])

    def test_new_pipeline_publishes_receipt_timing_and_verifies_exact_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,request=self.fixture(Path(tmp))
            snapshot=result['gaugeVintage']['snapshot']
            report=result['forecastInformation']
            self.assertEqual(result['methodVersion'],'observatory-1.6.0')
            self.assertEqual(report,forecast_information(snapshot,
                expected_snapshot_hash=snapshot['snapshotHash'],issue_time=snapshot['issueTime'])['report'])
            self.assertEqual(report['counts']['retainedRecords'],1)
            self.assertTrue(all(not a['timingEligible'] for a in report['timingAttempts']))
            before=copy.deepcopy(result)
            validate_assessment_manifest(result,request)
            self.assertEqual(result,before)
            # Original 1.5.0 archives retain the same strict timing binding.
            legacy=copy.deepcopy(result);legacy['methodVersion']='observatory-1.5.0'
            validate_assessment_manifest(legacy,request,allow_archived=True)
            with self.assertRaises(ValueError):
                validate_assessment_manifest(legacy,request)

    def test_modified_or_missing_timing_report_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,request=self.fixture(Path(tmp))
            for change in (lambda r:r.pop('forecastInformation'),
                           lambda r:r['forecastInformation']['counts'].update(retainedRecords=2),
                           lambda r:r['forecastInformation']['counts'].update(retainedRecords=True),
                           lambda r:r['forecastInformation']['timingAttempts'][0].update(timingEligible=True),
                           lambda r:r['forecastInformation']['timingAttempts'][0].update(timingEligible=0),
                           lambda r:r['forecastInformation'].update(informationHash='a'*64),
                           lambda r:r.pop('gaugeVintage')):
                bad=copy.deepcopy(result);change(bad)
                with self.assertRaises(ValueError):validate_assessment_manifest(bad,request)

    def test_old_captured_assessment_is_preserved_without_reinterpretation(self):
        with tempfile.TemporaryDirectory() as tmp:
            result,request=self.fixture(Path(tmp))
            result['methodVersion']='observatory-1.4.0'
            result.pop('forecastInformation')
            before=copy.deepcopy(result)
            validate_assessment_manifest(result,request,allow_archived=True)
            self.assertEqual(result,before)


if __name__=='__main__':unittest.main()
