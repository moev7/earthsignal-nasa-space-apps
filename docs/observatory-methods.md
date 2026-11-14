# Implemented assessment methods and limits

The engine `run_assessment(request, config, output)` validates the versioned request before any provider connection. Config is the service dataclass, not a dictionary. Provider adapters return evidence, source-bound metrics and missing states. The engine writes the five base artifacts `manifest.json`, `brief.json`, `metrics.csv`, `area.geojson` and `evidence.json`, plus manifest-listed native GeoTIFF/PNG comparison layers when available, validates the manifest before writing, and lets the service worker independently validate/atomically publish the exact manifest-listed artifact set. No remote stack or private NumPy array is published.

## Transfers and provenance

`net.py` permits exact HTTPS hosts and bounded path prefixes only. It rejects credentials, signed/auth query parameters, alternate ports, fragments, arbitrary client URLs, traversal and private DNS addresses. Redirect targets are vetted before connecting and their response bodies are closed rather than drained without a bound. HTTP/provider exceptions become fixed error codes; response bodies, auth state, local paths and signed redirects are not errors in results.

One job `Budget` shares `service.range_reader.TransferBudget` with raster reads. Metadata/CSV reservations are settled by bytes actually received, including rejected oversize reads. Hard limits include the configured cumulative transfer cap (at most 512MiB), wall deadline (at most 1200 seconds), 15-second metadata connection timeout, 24 metadata requests, 1MiB normal JSON and 2MiB daily/FIRMS tables. There are no automatic access/quota retries or paid fallbacks. The queue independently enforces wall time and cancellation. Native raster windows remain subject to the coordinator's one-million-pixel gate and range-only transport.

Evidence records preserve source/version/product IDs, upstream support, observed/published/retrieved times, mask/calibration policy and SHA256 of fetched bytes. Catalogue records also hash selected item/granule metadata. Private cropped evidence hashes its selected geometry, masks and grid. Derived comparison evidence hashes its two input records' IDs/hashes without introducing retrieval time into the content identity. `public:true` is restricted here to the fixed historical public examples; station queries, catalogue AOI searches, local crops and comparisons use `public:false`. This flag does not itself authorize sharing a private assessment with any external assistant.

## Observations and spatial support

USGS daily mean discharge uses verified station metadata and exact point inclusion in the selected polygon, including holes and antimeridian arcs. It retains one station/time-series/unit, parameter 00060 and statistic 00003. Negative/nonfinite values and inconsistent metadata are excluded; conflicting same-day values are withheld. A bounded series has null missing dates. Endpoint difference is last minus first **returned valid** station observation, not a fitted trend, inundation, reservoir volume or complete spatial assessment. Large date ranges or truncated pages are explicit limitations.

The pinned OPERA mosaic is a historical **full regional mosaic**; its area statistics are never relabelled as the user's crop or Lake Mead alone. The archived elevation series lacks a station geometry and vertical datum. It is historical regional context, not a confirmed in-area or current measurement. Source commit and upstream SHA256 pins must match; changed provenance is rejected.

FIRMS filters record centres by exact AOI, requested calendar dates and nominal/high confidence. It retains rolling feed dates/version, rejects malformed rows and preserves repeat overpass records. No qualifying records means no qualifying **returned** records, not absence of fire. Thermal pixels are not distinct fires, burned area, perimeters, damage or safety. NIFC perimeter discovery is separate, bounded and dated by record update; it does not assert exact AOI exposure or historical inventory completeness.

## Satellite methods

EarthSearch discovery searches the first two component envelopes, explicitly reporting unsearched components, with at most two oldest and two newest records and a four-item cap. GET sorting uses verified `properties.datetime`. Measurements choose at most four distinct compatible dates with identical source kind, platform, grid identity and processing version. Intermediate acquisitions retain statistics and hashes; only endpoint arrays are retained for common-pixel comparison. Remaining acquisitions are not silently converted into a full time-series.

Sentinel Collection 1 uses actual red/NIR/SWIR/SCL COG URLs and declared asset reflectance scale/offset/nodata. Conflicting calibration is rejected; the ambiguous legacy BOA-offset flag is not substituted. Landsat requires actual thermal and QA_PIXEL assets with verified 0.00341802 scale, 149 offset and kelvin unit. S3-to-HTTPS conversion is confined to the exact USGS Collection 2 bucket/path. No calibration or public raster access is inferred from a catalogue title.

The coordinator-owned raster module uses projected metre grids, native AOI pixel centres and holes, conservative QA/finite masks and recorded integer aggregation when spectral band resolutions differ. Sentinel QA retains SCL 4/5/6; Landsat rejects QA_PIXEL bits 0–5; DSWx retains classes 0/1/2. Per-acquisition metrics describe that acquisition's valid subset. `compare_crops` requires the identical target grid and computes pixelwise differences on a common before/after mask; the engine does not subtract independently masked medians. Shifted grids and empty masks withhold comparison. Whole-area interpretation is always withheld: even high valid coverage does not establish representativeness of excluded pixels. NDVI is not biodiversity; NDMI is not measured soil moisture; surface temperature is not air temperature.

OPERA DSWx-HLS v1 and HLSL30 v2 protected COGs use the configured Earthdata connection. HLS Fmask excludes bits 0–4, high aerosol (bits 6–7 equal 3) and fill 255. HLS reflectance retains documented 0.0001 scale and native 30m alignment. Authentication/range failures withhold measurements; access is never inferred from discovery. Annual NLCD release-specific endpoints and matched annual comparisons are unimplemented. No authenticated/paid fallback, full granule or old multi-year NLCD substitution is made.

## Briefs, scenarios and negative results

The five deterministic brief sections cite only resolvable persisted claim/evidence IDs. They describe measured support, meaning, withheld prediction, practical evidence checks and unknowns, aiming at approximately 150–250 words. No generative prose fills missing evidence. Totally unavailable results have no fabricated observed claims; quality messages explain the missing evidence. This version conservatively returns partial for usable bounded local observations and unavailable when none are measured; it does not return complete merely because files were written.

Current NWS forecast/alert metadata is separately timestamped context at a US grid/point. It is not a validated local causal/numeric forecast, a historical weather series or danger advice. No-alert query is not safety. Seasonal anomalies, exposure, causal attribution, future predictions and management benefits are explicitly withheld without their necessary independent/comparable evidence. The engine now calculates descriptive calendar-window seasonal context from the recorded history when at least twelve distinct days across two earlier calendar years are available. It excludes the target year, handles leap-year calendar alignment and reports sample median/MAD/percentile. This is not detection accuracy, a probability or a causal explanation. Explicit user reference dates do not currently run a separate reference-period comparison.

`run_scenario(request,parent,config,output)` delegates to the coordinator's deterministic scenario module, validates its contract and renders metrics using the same artifact writer. The parent comes from validated owner/expiry-checked service state, not client-supplied evidence. Scenario manifests contain no extra `brief`, `area` or `evidence` keys; those artifacts derive from the scenario claims and parent. Thresholds, footprint overlaps and assumed cost/benefit comparisons remain conditional, not measured intervention effects or probabilities.

## Reproduce the checks

```sh
python3 -m unittest service.tests.test_observatory_engine service.tests.test_observatory_providers service.tests.test_observatory_sources -v
EARTHSIGNAL_LIVE_OBSERVATORY=1 python3 -m unittest service.tests.test_observatory_engine.LiveRoundtripTests -v
```

Default tests use authentic API-shaped fixtures and reject unsafe URLs/DNS/redirects, oversize responses, changed historical provenance, outside-AOI gauges, mismatched QA/calibration, unsupported sources, empty success, unresolved artifact content and unsupported predictions. A focused comparison wiring test deliberately gives a common-population difference unlike the difference of independent medians; private array objects must never reach JSON. The live test uses only public, credential-free endpoints and verifies an expected actual source for each domain, manifest validation, hashes and the exact manifest-listed artifacts. Source-specific live receipts and remaining native-runtime limitations are recorded in `source-registry.md`. These checks establish technical contract/provider behavior, not usability, independent pilot acceptance or validated environmental predictions.

## Analytical exports

Comparison GeoTIFFs preserve float64 native analytical values and the recorded grid. Excluded pixels use 0 common-valid, 1 invalid-before, 2 invalid-after, 3 invalid-both and 255 outside the exact geometry. Shared before/after display limits use pooled common-valid percentiles; differences are centered on zero. Only 420×420 RGBA display previews are reprojected with nearest-neighbor sampling. The worker independently checks every file hash, native grid, finite population, exclusion code count and pixelwise after-minus-before identity before publishing. Class-1 water indicator changes are distinct from total valid water-class area or fractional water area.

## Forecast research acceptance

`forecasts.py` is integrated as an explicitly experimental discharge-history evaluation. It requires 1460–2000 consecutive finite nonnegative daily readings: two years of warmup, disjoint model-selection and empirical-interval calibration folds within the next year, and a final 365-day test. At least thirty origins are required per fold. Selection hashes exclude the final test. Each 1/3/7-day horizon must improve MAE by at least 10% over the strongest persistence/seasonal baseline and achieve at least 80% evaluated coverage for its nominal 90% empirical band; 80% is a product eligibility gate, not calibrated 90% coverage. Final-test metrics remain visible when current forecasts are withheld for stale or missing data. Expired targets cannot be published, and issue time must equal the captured publication time. Final-test eligibility is not prospective validation; real frozen pilots and demonstrated decision usefulness remain gates.

### Independent export reconciliation

Download the assessment manifest and all four native GeoTIFFs for each measured quantity through the protected artifact links. With native GDAL and NumPy installed, run:

```sh
python3 scripts/reproduce-assessment.py /path/to/downloaded-assessment
```

This standalone checker imports no Earthsignal calculation modules. It verifies hashes, matching recorded grids, excluded-code populations, finite-value masks, common coverage, pixelwise differences and the reported median (or common class-1 mapped-area change). It reads no display previews and has no network or credential access. Source-file calibration and independent source-window/mask reproduction are separate checks; successful export reconciliation alone does not certify causation, classification accuracy or decision validity.

## Bounded histories and preference sensitivity

Up to eight source-bound series retain at most 2000 dated points. Histories report valid/missing counts, sample median and p05/p95, a twelve-bin distribution, and a 28-calendar-day rolling median with at least three finite readings. Raw and smoothed charts preserve missing-date breaks; smoothing does not fill missing observations. Endpoint differences are descriptive, not fitted trends or common-pixel changes. Publication replays derived history and evaluation against its raw inputs, checks units against referenced evidence and confines points to requested dates and observed support. Method versions and input hashes identify the calculations.

Landsat ancillary ST_QA uncertainty and ST_CDIST cloud distance use documented 0.01 K/km scaling when available. QA_RADSAT bit 11 excludes terrain occlusion; optical saturation bits are not inferred as thermal saturation. Missing ancillary assets remain explicit. These source uncertainty summaries are not confidence intervals for an area median, and no unvalidated uncertainty/cloud-distance threshold is added.

Option scenarios with explicit cost and benefit weights report 21 equally spaced preference settings using the fixed candidate set and min–max normalization. All tied winners are retained; candidates missing cost or benefit remain unknown. Winner counts are sensitivity to assumptions, not probabilities or measured intervention effects. Signed threshold margins retain the measured quantity’s units.

### Measured-threshold range sensitivity (v4)

A threshold scenario may additionally supply `inputs.thresholdRange: {minimum, maximum}`. The scalar `threshold` and strict `operator` remain required and preserve the original one-threshold result. The optional range tests exactly 21 evenly spaced thresholds including both endpoints against the same recorded metric. Decimal interpolation of round-trip input values precedes conversion to binary64, preserving zero and decimal-tenth grid boundaries. Bounds must be finite, increasing and distinguishable at numerical precision; nonfinite signed margins fail rather than publish. No automatic range, uncertainty band, official safety threshold or probability is inferred.

The result's `thresholdSweep` binds every case to the metric's ID, source units, evidence and original population. It reports exact equality boundary, whether that boundary falls in the requested range, signed margins and adjacent-setting condition changes. Equality satisfies neither strict above nor strict below. The exact boundary need not coincide with a tested setting. Original acquisition dates and coverage limitations remain applicable; an area median threshold does not measure the fraction of pixels exceeding it.

The protected `manifest.json` retains all 21 cases, assumptions and method version. `metrics.csv` includes the original two scalar outputs plus 21 condition and 21 margin rows (44 rows with a range). The worker replays the sweep against the verified owner-scoped parent and reconciles the CSV before atomic publication. Existing scalar scenarios retain five base artifacts and their previous result shape. Frontend table equivalents and ordinary links remain available; the scenario makes no provider requests.

## Season-matched station slopes and interval diagnostics

New assessments under `observatory-1.3.0` add optional `series.seasonalTrend` using `station-seasonal-sen-v1`. Approved finite nonnegative daily mean discharge values qualify in complete months with at least 80% approved days. Require three eligible years and six common qualifying months across every eligible year. The median of same-month interyear monthly-median slopes has original discharge units per year. Fixed-month leave-year-out ranges show sensitivity, never a confidence interval, probability, significance, causality or extrapolation. Backend publication replays the metric and linked claim against the recorded series. `scripts/reproduce-station-trend.py` independently reconciles exported arithmetic/support without importing service calculation modules.

`gauge-selection-calibration-holdout-v3` adds optional validation `intervalDiagnostics`: single 90% Winkler score, separately calibrated persistence/seasonal-naive scores, below/within/above counts, consecutive evaluated miss runs, calibration rank/count and negative hindcasts. The radius is the calibration residual at rank `ceil((n+1)*0.9)`. Chronological dependence prevents an exchangeability-based coverage guarantee. Negative hindcasts withhold forecasts; nonfinite intermediate calculations are withheld. Existing gates and stale/missing-data protections remain. Archived records without these optional extensions stay readable and are not rewritten.

Archived `observatory-1.2.0` assessments with `gauge-selection-calibration-holdout-v2` retain their original numerical implementation in `forecast_v2.py`. The frozen body matches commit `becffa7` with SHA256 `97bfc4b940edeb61085fe0abe70a58fb8510290990439e1940b336fa88363def`. Only the server's owned, unexpired, completed stored-parent path enables exact archived replay for scenarios and immutable snapshots. New publication keeps the strict current-version path. Unknown or mixed assessment/forecast versions and altered replay outputs are rejected. This verifies old records without rewriting their measurements, intervals, hashes or exported field shape.

Exact equations, engineering-gate limits, references, negative experiments, capacity receipt and promotion requirements are in [the scientific-insights update](research/science-engine-2026-10-10/INSIGHTS-UPDATE.md).
# Plain-language presentation rules

Compatible DSWx exports can add versioned [class-1 footprint transition accounting](water-footprint-transitions.md), with native categorical maps, gains/losses, net change, turnover and explicit unknown support. Original measurements remain unchanged. Current processing-1.1 discovery is conditional on a narrowly verified original-file/header/palette/grid/domain encoding gate; this does not establish field accuracy or NISAR transfer.

The versioned [plain-language result layer](plain-language-results.md) interprets recorded measurements deterministically without changing the scientific method, exported source values or archived manifest. It separates measured signals, possible relevance, limitations and useful next evidence. High-level labels such as deforestation, dangerous water retention, damage and human heat risk remain withheld unless appropriate evidence supports them. The optional result-adjacent Gemini explains approved public science; private result values and geometry remain local.


### Observation availability and revisions

New gauge assessments can preserve an owner-scoped local receipt archive. The
archive stores actual returned station-days, approval status, source qualifiers,
station time metadata and response hashes; absent dates stay unknown. Explicit
invalid revisions remain recorded instead of being silently replaced by older
valid values. Semantically unchanged refetches do not multiply observation
versions. A later correction never changes an already exported snapshot.

The optional `gaugeVintage` manifest records an inclusive as-of view and its
canonical hashes. Its timestamps establish **local receipt only**, not original
USGS publication or historical availability. Existing retrospective forecast
evaluations still use revised data; capturing vintages is preparation for a
separately frozen operational evaluation, not evidence of predictive skill.
An unavailable archive leaves measurements usable and records the reason.

The 32 MiB ledger fits within the service's shared 1 GiB storage ceiling and
3 GiB free-disk reserve. `EARTHSIGNAL_GAUGE_VINTAGES_ENABLED=false` disables new
captures without rewriting old snapshots. Processing obtains the owner from
the authenticated job row; clients cannot choose ledger scope. See
[gauge-vintages.md](gauge-vintages.md) and [gauge-time.md](gauge-time.md).
