"""Independent native-cell accounting on the pinned real development crop."""
import io
import json
import math
import unittest

import numpy as np

from service.verify_native_radar import ROOT, ARCHIVE_SHA256, AOI_SHA256, pinned_bytes, verify

try:
    import rasterio
except ImportError:
    rasterio = None


@unittest.skipIf(rasterio is None, 'Requires optional Rasterio development reader')
class NativeInspectionReproduction(unittest.TestCase):
    def test_real_windows_match_scalar_oracle_and_frozen_receipt(self):
        from service.benchmarks.native_inspection import evaluate
        from rasterio.warp import transform
        verify()
        actual = evaluate()
        recorded = json.loads((ROOT / 'inspection-receipt.json').read_bytes())
        # Coordinate transforms may have harmless library-version rounding.
        for candidate, frozen in zip(actual['inspectionWindows']['candidates'], recorded['inspectionWindows']['candidates']):
            np.testing.assert_allclose(candidate['representative']['coordinate'], frozen['representative']['coordinate'], atol=1e-9, rtol=0)
            candidate['representative']['coordinate'] = frozen['representative']['coordinate']
        self.assertEqual(actual, recorded)
        with np.load(io.BytesIO(pinned_bytes(ROOT / 'inputs.npz', ARCHIVE_SHA256, 1024**2)), allow_pickle=False) as archive:
            difference = archive['difference_exported'].copy()
            common = archive['common_observable'].copy()
        with np.load(io.BytesIO(pinned_bytes(ROOT / 'aoi.npz', AOI_SHA256, 128 * 1024)), allow_pickle=False) as archive:
            selected = archive['aoi'].copy()
        expected = []
        height, width = difference.shape
        for row in range(0, height, 32):
            for column in range(0, width, 32):
                cells = [(r, c, float(difference[r, c])) for r in range(row, min(row+32, height)) for c in range(column, min(column+32, width)) if selected[r, c]]
                valid = [(r, c, d) for r, c, d in cells if common[r, c] == 1 and math.isfinite(d)]
                positive = sum(d > 3 for _, _, d in valid)
                negative = sum(d < -3 for _, _, d in valid)
                if not positive + negative:
                    continue
                representative = sorted(valid, key=lambda p: (-abs(p[2]), p[0], p[1]))[0]
                expected.append((positive+negative, abs(representative[2]), row, column, len(cells), len(valid), positive, negative, representative))
        expected.sort(key=lambda p: (-p[0], -p[1], p[2], p[3]))
        result = recorded['inspectionWindows']
        self.assertEqual(len(expected), result['candidateWindows'])
        self.assertEqual(result['selectedPixels'], 10002)
        self.assertEqual(result['unknownPixels'], 0)
        self.assertFalse(recorded['fieldAccuracyEstablished'])
        self.assertFalse(recorded['humanInspectionBenefitEstablished'])
        for wanted, candidate in zip(expected[:12], result['candidates']):
            self.assertEqual((candidate['window']['rowStart'], candidate['window']['columnStart'], candidate['selectedPixels'], candidate['validPixels'], candidate['increasedPixels'], candidate['decreasedPixels']), wanted[2:8])
            p = candidate['representative']
            self.assertEqual((p['row'], p['column'], p['differenceDb']), wanted[8])
            self.assertAlmostEqual(candidate['exceededAreaKm2'], wanted[0] * .0001)
            xs, ys = transform('EPSG:4326', recorded['source']['crs'], [p['coordinate'][0]], [p['coordinate'][1]])
            affine = recorded['source']['transform']
            self.assertAlmostEqual(xs[0], affine[0] + (p['column']+.5)*affine[1] + (p['row']+.5)*affine[2], places=6)
            self.assertAlmostEqual(ys[0], affine[3] + (p['column']+.5)*affine[4] + (p['row']+.5)*affine[5], places=6)
