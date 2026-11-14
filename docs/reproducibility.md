# Reproducibility & Scientific Verification

This document provides exact reproduction recipes and baseline metrics for both the optical baseline and the NISAR radar change processing pipeline.

---

## 1. Reproducing the OPERA Optical Water Analysis

The historical water-classification raster is derived from an actual OPERA DSWx-HLS GeoTIFF pinned to an official repository commit.

### Execution Steps
```sh
# Set up isolated Python virtual environment
python3 -m venv .venv
.venv/bin/pip install -r scripts/processing/requirements.txt

# Run the deterministic processing pipeline
.venv/bin/python scripts/processing/process_water.py

# Execute unit verification tests
.venv/bin/python -m unittest discover -s scripts/processing -p 'test_*.py'
```

### Deterministic Scientific Checks
- **Source Git Blob**: `65ae6cbb470346bdd64a499a7ea881169c243a6f`
- **Source Commit**: `452c0145b1dbdd5ca82c6d13d7fadc8fba0bbd06` (`OPERA-Cal-Val/OPERA_Applications`)
- **Native CRS**: UTM Zone 11N (`EPSG:32611`), 30-meter square pixels.
- **Affine Pixel Area**: Native pixel counts are tallied before reprojection and multiplied by the absolute affine determinant ($|a \cdot e - b \cdot d| = 900.0 \text{ m}^2$).
- **Expected classified-area outputs** (source algorithm classes, not independently reviewed ground truth):
  - Class 1 (Open water): **402.7365 km²**
  - Class 2 (Vegetated / partial water pixel footprint): **98.5779 km²**
  - Combined Classes 0, 1, 2: **94.3431%** of all mosaic pixels.

These areas describe nominal native projected pixel footprints. Reproducing them
does not establish water-classification accuracy, ecological truth or an
accuracy-adjusted area estimate.

---

## 2. Prepared NISAR Radar Study Audit Record

A real, bounded NISAR L2 GCOV study was prepared using `service.prepare_study` over the Lake Mead region.

### Candidate Job Metadata
- **Job ID**: `932485953d57489eb109b90eb34a606b`
- **Study Region**: Lake Mead (`lake-mead`)
- **Target Bounding Box**: `[-114.75, 36.05, -114.74, 36.06]`
- **Algorithm**: `gcov-hhhh-v3`
- **Native CRS**: `EPSG:32611` (10-meter square pixel spacing)
- **Crop Dimensions**: Width: 94 pixels, Height: 114 pixels

### Input Granule Provenance
- **Before Acquisition**:
  - Exact ID: `NISAR_L2_PR_GCOV_024_005_A_020_4005_DHDH_A_20260626T125220_20260626T125255_P05023_N_F_J_001`
  - Acquisition Time: `2026-06-26T12:52:20Z`
  - Geometry: Track 5, Frame 20, Ascending, Left-looking
  - Mask Specification: Schema 1.5.0 (`uint8` anomaly byte)
- **After Acquisition**:
  - Exact ID: `NISAR_L2_PR_GCOV_032_005_A_020_4005_DHDH_A_20260930T125217_20260930T125252_P05023_N_F_J_001`
  - Acquisition Time: `2026-09-30T12:52:17Z`
  - Geometry: Track 5, Frame 20, Ascending, Left-looking
  - Mask Specification: Schema 1.5.0 (`uint8` anomaly byte)

### Verified Execution Metrics
- **Total Crop Pixels**: 10,716 pixels
- **Before Valid Pixels**: 10,002 pixels
- **After Valid Pixels**: 10,002 pixels
- **Common Valid Pixels**: **10,002 pixels** (93.337%)
- **Calculated Valid Area**: **1.0002 km²**
- **Logarithmic Difference Statistics ($\Delta \gamma^0_{\text{dB}}$)**:
  - Median: **-1.461262 dB**
  - 5th Percentile ($p_{05}$): **-6.727505 dB**
  - 95th Percentile ($p_{95}$): **+3.482203 dB**
  - Minimum: -12.577781 dB
  - Maximum: +11.486079 dB
- **Network Transfer Budget**: Transferred **6,919,780 bytes** (~6.6 MiB) via HTTP range requests against the 512 MiB maximum transfer ceiling.

---

## 3. Reconciliation and acceptance

Independent native-source reproduction passed on2026-10-09. `service.verify_study` re-read the same source crop through the bounded transport, independently derived aligned windows, applied masks, computed ratios/statistics and serialized extracted-input digests. It shares production transport and metadata validation; it does **not** use the production comparison function. Both input digests, per-date masks, common mask, native exports and every statistic matched. Transfer6919780bytes; runtime492.756seconds; memory peak148.9MiB with no swap. The exported ratio median independently measured−1.461262118068192dB.

```sh
# Requires production-compatible GDAL and the authorized operator netrc.
# Run while the worker is idle, under the same memory/CPU/transfer limits.
python -m service.verify_study /var/lib/earthsignal/results/932485953d57489eb109b90eb34a606b --remote-source
# Omit --remote-source for export/hash/coverage/ratio checks only.
```

[Exact source/result manifest](../examples/prepared-study/manifest.json) and [receipt](../examples/prepared-study/verification.json). These are real retained-study evidence; synthetic unit fixtures are explicitly separate. Statistics use float64 computations; GeoTIFFs are float32, compared with explicit export tolerances. Input digests cover the native extracted arrays plus inspected metadata/window, not entire granules.

## 4. Offline native exports and detector readiness

The [bounded native reproduction bundle](../examples/native-radar-development/README.md)
contains the original masked numerical exports and a separate geometry mask.
Run `python -m service.verify_native_radar` to reproduce the original statistics
and `python -m service.benchmarks.native_radar` to exercise the sealed offline
detector on those real arrays. Neither command retrieves new data.

The original 93.337% describes 10,002 valid cells among 10,716 cells in the
padded rectangular window. The separate geometry-only reconstruction has
10,002 selected-area pixel centres, all common-valid in this case; 714 window
cells lie outside the area. This denominator clarification preserves the
original result. It does not certify radiometric accuracy.

The ±3 dB descriptive baseline reproduces 3,156 decreased, 698 increased and
6,148 within-threshold signal cells. Empirical pair calibration and temporal
detection remain withheld because independent reference labels and compatible
history are absent. See [the detector contract](radar-detection.md).
