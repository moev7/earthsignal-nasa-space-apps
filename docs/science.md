# Scientific Foundation & Data Specifications

## Interactive analytics and historical forecasts

Radar analytics sample the retained **native exported GeoTIFFs**, not the Web Mercator display PNG. Exported power/difference arrays are float32; these downstream calculations can differ slightly from the original float64 processing summaries. Before/after distributions and change distributions use the same selected common-valid pixels. A region includes native pixel centers inside its polygon. Thresholded increase/decrease areas describe signal change, not statistical significance or a classified hazard. Point and transect probes keep invalid/outside samples missing.

Human annotations record hypotheses with an author-scoped version and timestamp. They are explicitly unverified; exporting them supports later reviewed training datasets but does not train or validate a classifier automatically.

The water-history panel uses **observed daily Lake Mead gauge elevation**, a distinct data type from satellite water-class area. The source is the pinned OPERA Applications `DSWx/Reservoir/data/accumweb_09192023.json`, Git blob `f1839d5db7628b2be521175e982c9468e68fa226`, SHA-256 `f481fbb5c7e5d5493be396980e0fe5bfff1b22f341e3efae042690a9fd14e5b5`. The source contains 14,506 observed readings from 1984-01-01 through 2023-09-18. Blank source values are recorded as missing, never filled. Units are feet; the archived export does not declare a vertical datum, so no vertical-datum conversion or volume inference is made. Reproduce with `python3 scripts/processing/process_water_history.py`.

Forecast experiments use a user-selected historical cutoff. Require 365 consecutive recent daily observations, fit ordinary least squares to the last 28 days, and project seven days. Twenty earlier weekly origins calibrate horizon-specific empirical 90% absolute-error bands; twelve disjoint later weekly origins validate 84 daily predictions. At each origin only previous observations enter its fit. Persistence predicts the origin's last value. Forecast publication requires at least 10% lower validation MAE than persistence and at least 75% observed coverage of the empirical band. Validation is used for model selection, not a claim of independent prospective accuracy. Reservoir operations/weather are omitted; nonstationarity and temporal dependence limit interval interpretation. Future coverage is not guaranteed. These experiments are historical, not operational forecasts for today.

At cutoff 2023-09-18 the deterministic validation gives linear-model MAE 0.313504 ft, persistence MAE 0.481548 ft and 91.667% empirical-band coverage across 84 predictions. Exported model evidence includes individual validation predictions and errors, fitted recent slope, gate outcomes, cutoff and exact source identity.

Earthsignal is built to provide rigorous, scientifically defensible earth observation analysis without synthetic shortcuts, arbitrary data smoothing, or unauthorized resampling.

---

## 1. NISAR L2 GCOV Radar Change Detection

### Product & Radiometry Standard
- **Mission & Instrument**: NASA-ISRO Synthetic Aperture Radar (NISAR), L-band SAR.
- **Product Type**: Level-2 Geocoded Polarimetric Covariance (`L2 GCOV`).
- **Channel**: Frequency A, HHHH polarization term (`/science/LSAR/GCOV/grids/frequencyA/HHHH`).
- **Radiometric Quantity**: Unscaled linear $\gamma^0$ (gamma naught) backscatter power.
  - Verified by checking that Radiometric Terrain Correction (`RTC`) was applied (`radiometricTerrainCorrectionApplied=True`) and inspecting the normalization factor `/science/LSAR/GCOV/grids/frequencyA/rtcGammaToSigmaFactor`.
  - Data must have units `= 1`, scale factor `= 1`, add offset `= 0`, and positive finite values ($> 0$).
  - Receive-only or diagnostic channel modes are strictly rejected.

### Native Grid Alignment & Crop Windowing
- Scientific analysis operates strictly in the **native projected coordinate reference system** (e.g., UTM EPSG:32611) in meters.
- **Resampling Prohibited**: No interpolation, bilinear smoothing, or spatial reprojection is applied to analytical radar arrays.
- Pair validation enforces that before and after scenes share identical:
  - Track number, frame number, orbit pass direction, look direction, composite release ID, and nominal processing type (`Nominal`).
  - Identical pixel resolution ($\Delta x, \Delta y$).
  - Integer-aligned grid origin: the spatial offset between scene origins must be an exact integer multiple of the pixel spacing:
    $$\Delta \text{pixel}_x = \frac{x_2 - x_1}{\Delta x} \in \mathbb{Z}, \quad \Delta \text{pixel}_y = \frac{y_2 - y_1}{\Delta y} \in \mathbb{Z}$$
- **Crop Budget**: Total crop window is bounded by `EARTHSIGNAL_MAX_PIXELS` (default and hard cap: 1,000,000 native pixels).

### Mathematical Formulation
The backscatter change between chronologically ordered scenes is computed in decibels (dB) across common valid pixels:
$$\Delta \sigma_{\text{dB}} = 10 \log_{10} \left( \frac{\gamma^0_{\text{after}}}{\gamma^0_{\text{before}}} \right) = 10 \left( \log_{10} \gamma^0_{\text{after}} - \log_{10} \gamma^0_{\text{before}} \right)$$

This logarithmic difference avoids numerical overflow while computing precise change ratios.

---

## 2. Quality Masks & Anomaly Schemas

The processing engine (`gcov-hhhh-v3`) enforces strict dual-layer validity checks:

### Subswath Validity Mask (`mask`)
- Path: `/science/LSAR/GCOV/grids/frequencyA/mask`
- Type: `uint8`, identical raster grid as power data.
- **Policy**:
  - Values `1` through `254`: **Retained**. Indicates valid samples generated from fully-focused radar returns within subswath segments.
  - Value `0`: **Excluded**. Indicates partially focused or invalid radar returns in the averaging set.
  - Value `255`: **Excluded**. Fill value indicating areas outside the radar acquisition extent.
- *Scientific Note*: The subswath mask is **not** a radar layover/shadow mask.

### Input Data Exception Mask (`inputDataExceptionMask`)
NISAR GCOV products contain versioned exception masks. Earthsignal supports verified schemas **1.5.0** and **1.6.0**:

| Specification Attribute | Schema 1.5.0 (isce3 `v0.25.13`) | Schema 1.6.0 (Git `127452609b...`) |
| :--- | :--- | :--- |
| **Data Type** | `uint8` | `uint16` |
| **Fill Value** | None (`_FillValue` absent) | `65535` (`_FillValue=65535`) |
| **Channel Focus Bit** | N/A (single anomaly byte) | Bit 8 (`256` = `0x0100`): Fully focused HH channel required |
| **Low-Byte Anomaly** | `0`: No anomaly (retained)<br>`2`: Sample slip (excluded) | `0`: No anomaly (retained)<br>`2`: Sample slip (excluded) |
| **Validation Rule** | Retain code 0; exclude code 2; reject any other code. | Exclude fill 65535; require bit 256 set; require low-byte anomaly == 0. |

Any product containing unrecognized anomaly codes, missing exception datasets, or unsupported specification versions is rejected immediately to prevent erroneous scientific conclusions.

---

## 3. OPERA DSWx-HLS Optical Water Mosaic

Alongside radar change detection, Earthsignal integrates a verified optical baseline:

- **Source Asset**: Small historical Dynamic Surface Water Extent (`DSWx-HLS`) B01 mosaic from the OPERA Cal/Val repository (`OPERA-Cal-Val/OPERA_Applications`), pinned to commit `452c0145b1dbdd5ca82c6d13d7fadc8fba0bbd06` (`DSWx/Reservoir/data/B01_mosaics/2023/20230331.tif`).
- **Identity Verification**: Verified via Git blob SHA `65ae6cbb470346bdd64a499a7ea881169c243a6f`.
- **Sensor Family**: Optical imagery from Harmonized Landsat Sentinel-2 (HLS).
- **Coordinate Grid**: 30 m pixel resolution in UTM zone 11N (`EPSG:32611`).
- **Quantification & Mosaic Footprint**:
  - Class 1 (Open water): **402.7365 km²**
  - Class 2 (Partial/vegetated water pixel footprint): **98.5779 km²**
  - Classes 0, 1, 2 comprise **94.3431%** of all mosaic pixels.
  - *Scientific Limits*: These values represent **whole-mosaic totals**, not Lake Mead reservoir area alone. Class 2 is a categorical pixel footprint and is not converted into an exact fractional water volume. One historical optical mosaic cannot establish temporal trends, water-level change, or current drought conditions.

---

## 4. Analytical Outputs vs. Display Layers

When a radar change job completes, nine immutable artifacts are produced:

1. `before.tif`: Unwarped native float32 GeoTIFF of the initial scene backscatter.
2. `after.tif`: Unwarped native float32 GeoTIFF of the subsequent scene backscatter.
3. `difference.tif`: Unwarped native float32 GeoTIFF of the $\Delta \sigma_{\text{dB}}$ difference.
4. `validity.tif`: Byte mask GeoTIFF indicating common valid native pixels.
5. `before.png`: Contrast-stretched 8-bit PNG warped to Web Mercator (`EPSG:3857`) for Leaflet display.
6. `after.png`: Contrast-stretched 8-bit PNG warped to Web Mercator using the shared stretch scale.
7. `difference.png`: Symmetric diverging color-mapped PNG centered at 0 dB change.
8. `excluded.png`: RGBA overlay highlighting pixels masked out by quality/exception rules.
9. `manifest.json`: Cryptographic and scientific provenance receipt matching `lib/radar-contract.ts`.

> [!WARNING]
> Web Mercator PNGs are generated strictly for browser rendering. All quantitative analysis, percentiles, medians, and pixel areas are derived directly from the unwarped native raster arrays.

Source definitions: [ASF GCOV](https://nisar-docs.asf.alaska.edu/gcov/), [ASF GDAL](https://nisar-docs.asf.alaska.edu/gdal/), [schema1.5 producer XML](https://github.com/isce-framework/isce3/blob/v0.25.13/python/packages/nisar/products/XML/L2/nisar_L2_GCOV.xml), [schema1.6 pinned producer XML](https://github.com/isce-framework/isce3/blob/127452609bb9b3bdf3f7a2bf1cdf49c493b49441/python/packages/nisar/products/XML/L2/nisar_L2_GCOV.xml). The observation-mode label may be unspecified in the producer file; compatibility also requires identical actual A/B polarizations and processed/acquired bandwidth metadata. The manifest preserves that evidence.
