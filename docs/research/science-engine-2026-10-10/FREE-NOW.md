# Active scope: available now, no additional spending

User constraint, 10 October 2026: use resources available now and for free. This document narrows the broader research roadmap and takes precedence for near-term priorities. The original report remains supporting research.

“Free” means no new data/API subscription, paid model, GPU service or hosting upgrade. Work uses the existing server and native numerical/raster runtime; existing hosting still has its ordinary cost. Public services have access and rate limits. Free data does not make an unimplemented adapter ready.

## Data we can build on

| Existing route | Useful scientific output | Current boundary |
| --- | --- | --- |
| Public Sentinel-2 C1 through Earth Search | NDVI/NDMI maps, common-pixel differences, greenness and spectral moisture-index histories | Adapter currently selects at most four scenes; a complete history needs bounded ingestion work. Indices are not direct biodiversity or soil-moisture measurements. |
| Landsat C2 through Planetary Computer | Surface-temperature maps, spatial distributions and compatible-date comparisons | Existing cropped reads work; thermal support is coarser than the output grid. Use the public signing route rather than requester-pays alternatives. |
| USGS modern daily API | Same-station discharge charts, historical context and forecast evaluation | Current adapter uses one in-area station and at most 2,000 records; provisional values and gaps remain visible. |
| NASA FIRMS public CSV and current NIFC vectors | Dated thermal-detection charts and reported perimeter context | Rolling detections are not distinct fires or burned-area measurements; US perimeter reporting is not a global history. |
| NWS public API | Current US weather and alert context alongside observations | Weather context is separate from an app-trained local forecast or historical satellite acquisition. |
| Retained radar results and pinned water archives | Radar-change distributions; retrospective water-level trends | Use available compatible pairs. Historical archives do not establish current conditions, deformation or reservoir volume. |

Public access references: [Earth Search collection](https://earth-search.aws.element84.com/v1/collections/sentinel-2-c1-l2a), [Planetary Computer anonymous signing](https://planetarycomputer.microsoft.com/docs/concepts/sas/), [USGS API access](https://api.waterdata.usgs.gov/docs/ogcapi/), [FIRMS downloads](https://firms.modaps.eosdis.nasa.gov/active_fire), [NWS free API](https://www.weather.gov/documentation/services-web-api). Source-specific semantics and limits are recorded in `service/observatory/sources.py`.

OPERA/HLS protected pixels remain an optional extension where free Earthdata credentials are already configured. They do not block the credential-free path; this scope check does not inspect credentials or certify current account access.

## Implementation order using the existing CPU setup

1. **Correct interpretation and support gates.** Separate spatial spread from estimation uncertainty; label valid-pixel statistics by their actual population. Check distinct baseline years, sampling cadence and gaps before claiming seasonal anomalies or persistence. Audit targets: `service/observatory/methods.py`, `forecasts.py`, `engine.py` and `lib/water-history.ts`.
2. **Build bounded, versioned histories.** Store acquisition time, source identity, units, quality, valid coverage and method version with each point. Start with existing gauge/archive series, then add incremental optical crops without removing transfer, pixel or worker limits. Publish gaps and truncation.
3. **Explain change through charts.** Show a timeline, matched seasonal percentile where enough independent years exist, rolling median, change distribution and a concise evidence-backed explanation in the existing workspace. Distinguish observed change from a cause. Short series receive descriptive comparisons instead of a fabricated seasonal baseline.
4. **Strengthen available raster quality.** Evaluate Landsat ancillary quality assets such as ST_QA, ST_CDIST and QA_RADSAT, verify scaling/alignment, and record their effect on coverage. Compare dates on common valid pixels. For radar, first evaluate quiet-reference change distributions before adopting a new detection threshold.
5. **Evaluate small forecasts before exposing them.** Compare persistence, seasonal-naive and simple local-trend candidates on eligible gauge histories. Separate selection, interval calibration and final evaluation; report error, interval coverage, width and failures. Check issue time and freshness. The Python helper is now integrated as an experimental evaluation in the assessment; eligibility requires independent folds, retrospective skill and interval-coverage gates. A failed evaluation keeps predictions withheld. [Rolling-origin evaluation](https://otexts.com/fpp3/tscv.html).
6. **Make scenarios informative.** Sweep explicit cost, threshold and weighting assumptions with bounded deterministic calculations; show ranking reversals and which options remain preferred across assumptions. These are sensitivity results, not measured intervention effects or invented probabilities.

These increments require engineering and verification, but no purchased datasets, paid inference or new compute platform. Start with existing numerical dependencies; add libraries only for a concrete checked need. Each increment retains provenance and checks the relevant numerical edge cases before activation.

Heavy neural training, full raw InSAR processing, climate-model pipelines, new infrastructure and access-gated services are outside the active scope. The scope update itself did not change production. The subsequently authorized implementation adds bounded histories and charts, stronger support/quality gates, experimental gauge evaluation and explicit preference sensitivity on existing infrastructure. This remains an incremental release: quiet-reference radar threshold evaluation, complete optical acquisition histories, incident recovery modelling and independent prospective pilots are future work.

Continuation implements optional explicit threshold-range sensitivity on fixed recorded measurements, with 21 endpoint-inclusive settings, strict equality semantics and protected exports. This is assumption sensitivity, not future prediction or a spatial exceedance-area estimate.
