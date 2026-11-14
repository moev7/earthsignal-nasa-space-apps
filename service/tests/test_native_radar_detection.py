"""Real development case exercises the actual sealed detector API, not field truth."""
import unittest

from service.benchmarks.native_radar import evaluate, load_case
from service.benchmarks.radar import Spec, RadarError, apply, freeze


class NativeRadarDetectionTests(unittest.TestCase):
    def test_real_detector_population_and_explicit_denominators(self):
        result = evaluate()
        fixed = result['fixedDetection']
        self.assertEqual(fixed['stage'], 'exploratory')
        self.assertEqual(fixed['counts']['valid_cells'], 10002)
        self.assertEqual(fixed['counts']['signal_decrease_cells'], 3156)
        self.assertEqual(fixed['counts']['signal_increase_cells'], 698)
        self.assertEqual(fixed['counts']['no_alert_cells'], 6148)
        self.assertEqual(fixed['counts']['outside_target_footprint_cells'], 714)
        self.assertEqual(fixed['counts']['invalid_within_target_footprint_cells'], 0)
        self.assertEqual(fixed['valid_target_footprint_fraction'], 1)
        self.assertAlmostEqual(fixed['valid_window_fraction'], 10002 / 10716)
        self.assertFalse(result['fieldAccuracyEstablished'])
        self.assertFalse(result['originalMeasurementsChanged'])

    def test_missing_calibration_and_history_never_yield_thresholds(self):
        result = evaluate()
        for name in ('empiricalPairPolicy', 'empiricalTemporalPolicy'):
            receipt = result[name]
            self.assertEqual(receipt['status'], 'withheld')
            self.assertIsNone(receipt['thresholds'])
            self.assertEqual(len(receipt['attempts']), 1)
        self.assertTrue(any('reference' in reason.lower() for reason in result['empiricalPairPolicy']['reasons']))
        self.assertTrue(any('history' in reason.lower() for reason in result['empiricalTemporalPolicy']['reasons']))

    def test_development_case_cannot_be_promoted_to_untouched_final(self):
        case, profile, _ = load_case()
        policy = freeze(Spec('fixed_pair', profile, '2026-10-12T19:42:19Z',
                            task_parameter_evidence='Development-only baseline'))
        with self.assertRaisesRegex(RadarError, 'not registered'):
            apply(policy, case, expected_receipt_sha256=policy['receipt_sha256'], stage='final')


if __name__ == '__main__':
    unittest.main()
