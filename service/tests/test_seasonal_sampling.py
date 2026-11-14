import copy
import math
import unittest
from pathlib import Path
import tempfile
from unittest.mock import patch
from service.observatory.sampling import seasonal_sampling


def series(points):
    return dict(id='fixture',label='Fixture',unit='index',evidenceIds=['fixture-source'],
        points=[dict(p,quality='fixture') for p in points])


class SamplingTests(unittest.TestCase):
    def fixture(self):
        return series([dict(date='2024-06-01',value=0.)]+
            [dict(date=f'2025-06-{d:02d}',value=100.) for d in range(1,13)]+
            [dict(date='2026-06-01',value=50.)])

    def test_even_median_preserves_finite_subnormal_and_large_values(self):
        from service.observatory.sampling import _median
        self.assertEqual(_median([5e-324,5e-324]),5e-324)
        self.assertEqual(_median([1e308,1e308]),1e308)
        self.assertEqual(_median([-1e308,1e308]),0)

    def test_density_sensitive_sample_is_explicit_not_replaced(self):
        s=self.fixture();before=copy.deepcopy(s);out=seasonal_sampling(s)
        self.assertEqual(s,before)
        self.assertTrue(out['supported']);self.assertEqual(out['sampleCount'],13)
        self.assertEqual(out['pooled']['median'],100);self.assertEqual(out['yearBalanced']['median'],50)
        self.assertAlmostEqual(out['pooled']['percentile'],100/13)
        self.assertEqual(out['yearBalanced']['percentile'],50)
        self.assertEqual([y['count'] for y in out['byYear']],[1,12])
        self.assertEqual(out['sparseYears'],[2024]);self.assertTrue(out['directionChanges'])
        self.assertAlmostEqual(out['maxYearSharePercent'],1200/13)

    def test_equal_year_medians_invariant_to_more_identical_readings(self):
        s=self.fixture();s['points'][0]['value']=100
        out=seasonal_sampling(s)
        self.assertEqual(out['pooled']['median'],out['yearBalanced']['median'])
        self.assertFalse(out['directionChanges'])

    def test_withheld_support_still_exposes_actual_counts(self):
        s=series([dict(date='2025-06-01',value=3.),dict(date='2026-06-01',value=4.)])
        out=seasonal_sampling(s)
        self.assertFalse(out['supported']);self.assertEqual(out['byYear'][0]['count'],1)
        self.assertIsNone(out['pooled']['median']);self.assertIsNone(out['yearBalanced']['percentile'])
        self.assertIsNone(out['directionChanges'])

    def test_missing_and_empty_have_no_fabricated_reference(self):
        for points in ([],[dict(date='2025-06-01',value=None)]):
            out=seasonal_sampling(series(points))
            self.assertEqual(out['sampleCount'],0);self.assertEqual(out['byYear'],[])
            self.assertIsNone(out['targetDate']);self.assertIsNone(out['maxYearSharePercent'])

    def test_duplicates_invalid_and_unordered_rejected(self):
        for points in ([dict(date='2025-06-01',value=1)]*2,
            [dict(date='2025-06-02',value=1),dict(date='2025-06-01',value=2)],
            [dict(date='2025-06-01',value=v) for v in (True,float('nan'))]):
            with self.assertRaises(ValueError):seasonal_sampling(series(points))

    def test_circular_calendar_window_and_leap_day(self):
        s=series([dict(date='2024-12-31',value=1.),dict(date='2025-06-01',value=999.),
            dict(date='2025-12-31',value=2.),dict(date='2026-01-01',value=3.)])
        out=seasonal_sampling(s)
        self.assertEqual([y['dates'] for y in out['byYear']],[['2024-12-31'],['2025-12-31']])
        out=seasonal_sampling(series([dict(date='2024-02-29',value=1.),dict(date='2025-03-01',value=2.),dict(date='2026-03-01',value=3.)]))
        self.assertEqual(out['sampleCount'],2)

    def test_hash_binds_unit_quality_source_and_only_raw_fields(self):
        s=self.fixture();a=seasonal_sampling(s)
        self.assertEqual(a,seasonal_sampling(copy.deepcopy(s)))
        for key,value in [('unit','K'),('evidenceIds',['other-source'])]:
            changed=copy.deepcopy(s);changed[key]=value
            self.assertNotEqual(a['inputHash'],seasonal_sampling(changed)['inputHash'])
        s['analysis']={'ignored-derived':'fixture'}
        self.assertEqual(a,seasonal_sampling(s))
        s['points'][0]['quality']='changed'
        self.assertNotEqual(a['inputHash'],seasonal_sampling(s)['inputHash'])

    def test_finite_extreme_medians_do_not_overflow(self):
        s=self.fixture()
        for p in s['points']:p['value']=1e308
        out=seasonal_sampling(s)
        self.assertTrue(math.isfinite(out['pooled']['median']))
        self.assertTrue(math.isfinite(out['yearBalanced']['median']))
        self.assertEqual(out['percentileDifferencePoints'],0.)

    def test_new_assessment_binds_sampling_and_old_archive_need_not_have_it(self):
        from service.observatory.engine import run_assessment
        from service.assessment_validation import validate_assessment_manifest
        from service.config import Config
        from service.tests.test_observatory_providers import request,QueueBudget,station,daily
        r=request();r['options']['sourceIds']=['usgs-daily']
        fixture=QueueBudget(station(),dict(features=[daily('2025-06-01','100'),daily('2025-06-03','200')],links=[]))
        with tempfile.TemporaryDirectory() as tmp,patch('service.observatory.net.Budget.fetch',side_effect=fixture.fetch):
            a=run_assessment(r,Config(Path(tmp),b'fixture-secret'),tmp)
        self.assertIn('seasonalSampling',a['series'][0])
        validate_assessment_manifest(a,r)
        bad=copy.deepcopy(a);bad['series'][0]['seasonalSampling']['sampleCount']=100
        with self.assertRaises(ValueError):validate_assessment_manifest(bad,r)
        # Archive retains its original analyses and exact raw history hash.
        old=copy.deepcopy(a);old['series'][0].pop('seasonalSampling');old['methodVersion']='observatory-1.3.0'
        validate_assessment_manifest(old,r,allow_archived=True)


if __name__=='__main__':unittest.main()
