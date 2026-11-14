# 🔬 Reproduce the original radar signal

This is the original **26 June → 30 September 2026** NISAR Frequency A HH
comparison for the island-and-water patch
`[-114.75,36.05,-114.74,36.06]`. Its identity and recorded measurements are
preserved. These small native-grid exports let you reproduce the numbers
without downloading the two full science granules.

```sh
service/.venv/bin/python -m service.verify_native_radar
service/.venv/bin/python -m service.benchmarks.native_radar
service/.venv/bin/python -m unittest service.tests.test_native_radar_reproduction -v
```

## In simple terms

The radar return became fainter at the median pixel: **−1.461262 dB**, across
**10,002 common valid pixels /1.0002 km² of nominal projected cell footprints**.
With a fixed±3 dB cutoff,3,156 pixels are substantially fainter,698 brighter
and6,148 remain within the cutoff. That is **38.532% of the common-valid pixels
beyond this chosen signal cutoff**—not a false-alarm rate, water-loss percentage,
whole-lake condition, damage classification or probability of danger.

The [nearby-date optical images](../optical-reference-development/README.md)
provide a useful cross-sensor check. Their classifications are unreviewed;
stable water class does not establish constant radar brightness. Surface
roughness and other conditions can change the radar signal without moving
the shoreline. Additional evidence is needed to distinguish explanations.

## What is frozen

- `manifest.json`: the unchanged original source/product metadata, acquisitions,
  native crop/grid, producer-mask policy, original statistics and artifact hashes.
- `before.tif` / `after.tif`: linear gamma-zero power, Float32, with per-date
  excluded cells stored as NaN.
- `difference.tif`: original Float32 difference on the common valid footprint.
- `validity.tif`:1 common-valid,0 excluded.
- `inputs.npz`: the four decoded native arrays, preserving pixel positions and
  dtypes. The NPZ archive is pinned separately from the original GeoTIFFs.
- `aoi.npz`: a separate geometry-only pixel-centre mask reconstructed from the
  unchanged bbox/CRS/affine using the original processing method and native GDAL
  runtime. It is not an additional product-quality mask or a rewritten result.
- `detection-receipt.json`: a supplementary, offline development run of the
  sealed detector API. Its fixed ±3 dB baseline reproduces the original counts;
  empirical pair calibration and temporal detection are explicitly withheld.

The unchanged original manifest also lists its four display PNGs. Those images
are not bundled in this numerical subset and their display hashes are not
verified by this recipe. Only the supplied numerical artifacts and geometry
archive are checked here; this directory is not the complete original job.

All four GeoTIFFs use EPSG:32611, metre units and the same GDAL transform
`[702640,10,0,3992970,0,-10]`,114 rows ×94 columns. No analytical resampling is
performed. Recomputing from positive native exported powers reproduces the
original median and percentiles exactly. The original Float32 difference raster
has maximum rounding difference **4.75447×10⁻⁷ dB**, below the declared1×10⁻⁶ dB
comparison tolerance.

**Coverage denominators differ.** The rectangular raster window has10,716
pixels;714 are outside the selected geographic box. All10,002 selected-area
pixel centres are common-valid in this case. The original93.337% statistic
describes the padded window, while the supplementary geometry context gives
100% within-area coverage. Neither percentage certifies radiometric accuracy or
removes the known provisional-product limitations. The original value remains
unchanged and labeled with its original window denominator.

The original raw-crop input hashes cover power, subswath and exception masks,
ancillary metadata and crop windows. The reproduction archive covers the
**masked exported arrays**. Those scopes are different; neither is a checksum
of a full granule, and the reproduction does not recreate unavailable excluded
source values or certify every upstream metadata assertion.

## Evaluation status

This inspected patch is **development evidence**, excluded from untouched final
evaluation. It has no independently reviewed target-stable or true-change labels
and no adequate frozen compatible temporal history. It cannot fit a defensible
quiet-reference policy or establish calibrated detector performance. The new
numerical detector must explicitly withhold those missing capabilities.

The detector recipe exercises those gates on these actual exports. The case is
marked **exploratory development**, with no registered final holdout. It cannot
be relabeled an untouched evaluation. Its source hashes identify exported
GeoTIFFs, not full HDF5 granules. Candidate budgets/history counts in the withheld
readiness exercise are development parameters, not a preregistered field policy.

Source: NASA–ISRO NISAR / ASF DAAC, provisional GCOV releaseP05023; exact product
IDs are in the manifest. [ASF GCOV documentation](https://nisar-docs.asf.alaska.edu/gcov/),
[NASA's NISAR data overview](https://science.nasa.gov/mission/nisar/data/) and
[NASA data-use/citation guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software/data-use-policy).
NISAR science data is openly available; source attribution is retained.
This grants no claim over unrelated third-party software, logos or materials.

## Reproduce the inspection list

`inspection-receipt.json` is a separate descriptive development artifact; the
original manifest, masks and measurements above are unchanged. With the declared
optional Rasterio test reader installed, run:

```sh
service/.venv/bin/python -m service.benchmarks.native_inspection
service/.venv/bin/python -m unittest service.tests.test_native_inspection_reproduction -v
```

The runner verifies original TIFF bytes and compares their decoded native arrays
with the pinned NPZ before calculation. It uses the original 10,002-cell
geographic selection, rather than the padded 10,716-cell window. All twelve
candidate windows recover the 698 brighter and 3,156 fainter pixels beyond the
fixed ±3 dB cutoff. The first-ranked window contains 463 such pixels; its
representative is native row38/column77, −12.48598861694336 dB. These are signal
measurements and browsing priorities, not water classes or validated hazards.

An independent scalar-cell oracle checks each window's population, rank and
representative; transformed coordinates round-trip to native pixel centres.
Coordinate reproduction permits 1e−9 degrees of projection-library rounding.
One local full-file reproduction took0.43s and57,720,832bytes maximumRSS, including
the optional reader. This is an offline crop check, not a production capacity
or user-benefit measurement. The receipt explicitly leaves field accuracy and
human inspection benefit unestablished.
