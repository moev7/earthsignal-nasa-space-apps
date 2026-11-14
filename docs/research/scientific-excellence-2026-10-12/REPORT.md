# Earthsignal: a path to defensible scientific excellence

Research date: **12 October 2026**. Code audited: `076fb17a5c2b1bfc05a72823947b97e30e402b76`.

**Recommendation:** make Earthsignal exceptionally good at one complete scientific task: identifying, measuring and investigating open-water change with NISAR, then explaining its environmental significance using independent observations. Build a reusable validation and observation-history foundation underneath it. Expand into disturbance, heat and prediction only when each addition demonstrates an improvement on held-out cases.

The advantage would be a result a scientist can reproduce, challenge and use to decide where to investigate next. More models alone do not establish accuracy. We have not measured current field accuracy or demonstrated superiority over an operational product. This report is research and an implementation plan; no application or production changes were made.

The scope retains the user's **free now / no new spending** constraint. Public downloads can still require free Earthdata registration, bandwidth, disk space and processing time. A public repository is not automatically permission to redistribute its code or data. The recommended first experiments fit bounded crops and modest CPU processing; no paid API, GPU training or new cluster is assumed.

## 1. What changed since the previous research

The [10 October report](../science-engine-2026-10-10/REPORT.md) is a baseline, not a current defect list. The current implementation has fixed its single-year seasonal-baseline issue, undated persistence problem, unsupported valid-subset interpretation, forecast calibration/coverage defects and expired-target publication. Landsat ancillary QA is now used. `forecast_v2.py` is deliberately frozen archive replay; current forecasts use `forecasts.py`.

An independent code auditor ran 54 maintained in-memory numerical checks. The coordinator repeated those checks: **54 passed**. We also independently reproduced the counterexamples in [experiments.py](experiments.py), with exact output in [experiment-results.json](experiment-results.json). Synthetic examples establish behavior and limitations; they do not estimate field error rates.

| Current evidence | Why it matters | Recommended improvement |
|---|---|---|
| `service/observatory/engine.py:33` selects the group belonging to the latest compatible source/platform/grid record. An older usable pair plus a newer singleton produces only one crop. | Useful evidence can be overlooked even though compatible scenes exist. This fixture concerns the observatory optical crop selector, not the native radar comparison algorithm. | Evaluate bounded compatible groups; let users choose the actual comparison and show why a pair was selected. |
| `engine.py:75` removes intermediate arrays before successful endpoints are known. A failed first crop followed by three successes still loses the comparison. | Provider failure unnecessarily removes scientific evidence. | Preserve or reread the first and last successful endpoints within existing limits. Never solve this by mixing incompatible groups. |
| `service/processing.py:439` and `service/analysis.py:170` calculate and threshold radar log-ratio magnitude. | A dB threshold is an effect-size rule, not a probability that environmental change occurred. | Calibrate false alarms against independent quiet scenes and evaluate an explicit detector. |
| `service/observatory/providers.py:209` retrieves current gauge records; `forecasts.py:73` has no historical availability-time reconstruction. Equal-valued duplicate records retain the last record's approval status. | Revised observations can make a retrospective forecast look better than a forecast actually issued at the time. Ordering can change retained quality metadata. | Immutable observation vintages, deterministic duplicate-quality policy, and availability-aware replay. Provisional data need an explicit policy; they are not automatically unusable. |
| `methods.py:71` / `history.py:41` pool seasonal readings. One observation in one year plus twelve in another passes the two-year support gate. | Acquisition density can dominate the seasonal reference. | Per-year support charts and pooled-versus-year-balanced sensitivity, with minimum within-year support appropriate to the question. |
| `planetary.py:140` and `raster.py:167` now ingest thermal QA; `raster.py:194` describes processing-grid support. | Quality masks do not establish retrieval error, spatial independence or effective thermal resolution. | Benchmark residual error by quality stratum and distinguish grid spacing from measurement support. |
| `forecasts.py:142` defines targets from the latest observation. In a latency fixture, a labelled three-day forecast has only half a day remaining when issued. | Users need the actual forecast target interval and useful lead time. | Display observation cutoff, issue time, station-day timezone, target interval and issue-relative lead separately. |

One revealing experiment used unchanged mean radar power with independent Gamma speckle. The fraction exceeding ±3 dB was **66.99%, 34.85% and 5.38%** at one, four and sixteen simulated looks respectively. This does **not** mean those are Earthsignal's real false-alarm rates: real spatial/temporal correlation, heterogeneous surfaces and processing differ. It demonstrates why a fixed magnitude threshold cannot carry a universal confidence label. NISAR's supplied `numberOfLooks` should not silently be equated with the independent Gamma-look parameter in this simulation.

## 2. Current NISAR facts that must influence the design

ASF currently identifies public L-band products as **PROVISIONAL**: calibrated, with validation at a limited set of sites. Its availability page reports release on 20 July 2026, acquisitions from 17 June onward, nominal Level 1–3 latency of 36–72 hours, and CRID P05023 for the initial provisional release. It also records a permanent instrument gap from 27 July to 10 August 2026 and a planned validated reprocessing campaign. A plan is not proof that reprocessing is complete. Mixing older BETA and provisional products can introduce processor changes into an apparent environmental signal. Store maturity and CRID and preserve old results when reprocessed inputs arrive. [ASF availability](https://nisar-docs.asf.alaska.edu/availability-overview/)

Known issues include residual RFI, high-latitude geometric/ionospheric effects, low-level ripples and some incomplete-data artifacts. Frequency B has a different calibration limitation; coherent polarimetric analysis has a documented phase correction. These are product-specific conditions, not instructions to apply a blanket correction to every amplitude layer. The current diagonal GCOV intensity workflow must not gain an unverified phase adjustment. Build a versioned known-issue registry with affected product/band/date conditions and links to the producer notice. Do not promise that the application can detect every artifact automatically. [ASF provisional issues](https://nisar-docs.asf.alaska.edu/provisional-known-issues/)

GCOV represents terrain-corrected gamma-zero power/covariance. Grid spacing depends on frequency and bandwidth; it is not universally 10 m. Its look-count and mask layers can help explain spatially varying support. Complex off-diagonal terms have additional polarimetric meaning and availability constraints. The current amplitude comparison cannot produce interferometric coherence, displacement or biomass simply by adding a chart. [ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/)

Mission calibration is distinct from validation of our environmental classifier. NASA's calibration/validation programme uses independent measurements; our application needs its own task-specific reference data and error accounting. [NASA calibration and validation](https://science.nasa.gov/mission/nisar/calibration-and-validation/)

**Immediate scientific implication:** a multi-year NISAR seasonal baseline is not available merely because we can retrieve a long Sentinel-1 history. Start with matched recent NISAR changes and label shorter baselines honestly. Use older C-band observations as separately identified context or a separately validated model, not as interchangeable L-band measurements.

## 3. The flagship scientific application

### Open-water change, followed by wetland monitoring

The first task should be: **“Which parts of this floodplain changed in open-water extent, how much of the area was actually observable, and which locations deserve field or image review?”**

The workflow should produce:

1. A before/after comparison using compatible acquisitions and a common valid footprint.
2. Candidate water gains/losses, persistent water, observable no-detection and unknown areas.
3. Area estimates, their support and validation evidence; separate mapped area from accuracy-adjusted area.
4. An observation timeline showing first/last detected presence and gaps. A hydroperiod estimate must represent interval censoring between acquisitions; do not turn sparse detections into exact daily inundation duration.
5. Alternative explanations: rainfall/flow context, wind-roughened water, vegetation, seasonal changes, geometry or instrument artifacts.
6. A ranked inspection list with a reason and the next observation that could resolve ambiguity.

Open water is the initial scope because it provides a concrete measurable quantity and existing reference workflows. It is still difficult near urban structures, rough water and vegetation. Flooded vegetation can brighten through double-bounce scattering; a dark-pixel detector is not a universal flood detector. A gauge measures water level or discharge at a point, not the flooded polygon. Use it for temporal/hydrological context unless a separately calibrated spatial mapping exists.

Study the [OPERA DSWx-SAR implementation](https://github.com/opera-adt/DSWX-SAR) for thresholding and refinement, and compare against its outputs as a **reference algorithm**, not automatically as independent truth. Establish NISAR-specific performance with matched independent labels. OPERA's [product catalogue](https://www.jpl.nasa.gov/go/opera/products/) distinguishes products and schedules; a scheduled release date that has passed does not verify accessible production coverage for our area.

**Practical benefit to demonstrate:** help an environmental scientist select a small set of inspection locations and document why. Measure missed relevant changes, false inspection priorities and time to a defensible brief against the existing viewer workflow. A formative user study is useful; it is not evidence that reservoir operations, evacuations or ecological outcomes improved.

### Other valuable applications, sequenced by evidence requirements

| Application | Useful output | Scientific boundary / prerequisite |
|---|---|---|
| Forest and vegetation disturbance | Persistent disturbance candidates, onset interval, recovery trajectory and inspection priority | Separate phenology, moisture and disturbance; use longer histories and independent disturbance labels. Avoid equating radar change with deforestation or biodiversity loss. |
| Wetland restoration monitoring | Observed water recurrence, vegetation response and seasonal comparison | Validate vegetated inundation separately. A treatment-effect claim needs a suitable control design and assumptions about confounding. |
| Surface heat | Time-matched land-surface temperature change, quality strata and persistent hotspots | Surface temperature is not air temperature, heat exposure or illness risk; account for emissivity/cloud effects and spatial support. |
| River monitoring | Daily discharge context and bounded experimental station forecasts | Point discharge is not flood extent, inundation depth or a watershed-wide forecast. |
| Post-fire recovery | Spectral and radar recovery trajectories with comparable-season observations | Burn severity and ecological recovery are different targets; delayed reference products cannot validate real-time lead. |
| Soil moisture / deformation | Potential later specialist workflows | Require suitable products, calibration and task-specific validation. GCOV amplitude alone does not establish either quantity. |

The flagship choice should reverse if no suitable NISAR/reference pairs are available, or interviews reveal a better-supported scientist task. In that case, use an explicitly Sentinel-1 pilot while developing the NISAR validation track; do not relabel it as validated NISAR science.

## 4. Engine improvements with the highest expected value

### A. Define a measurement contract and preserve observation vintages

Extend the existing evidence/manifests rather than replacing the working engine. Each observation should record quantity, units, spatial footprint/support, temporal aggregation, source product ID, sensor, polarization, track/direction, processing baseline/maturity, acquisition time, producer publication time when known, first-seen/ingest time, hashes, masks and resampling. Derived results also need algorithm/version/parameters, environment, upstream IDs and actual valid support. Forecasts need issue time, source availability cutoff, target interval and training/calibration/selection periods.

Publication time is not always available. **First-seen time is a conservative local availability bound, not proof of the original publication date.** A replay without historical vintages must say “retrospective using currently available/revised data.” Do not fabricate publication timestamps from acquisition dates. Snapshot new gauge observations now to build future operational evaluation evidence.

USGS explicitly describes provisional streamflow observations as subject to revision after review. Accordingly, value, quality and availability history belong in the evaluation input, rather than just the observation date. [USGS provisional-data statement](https://water.usgs.gov/data/provisional.html)

Use a small indexed manifest store and content-addressed crop/result files; retain manifests and benchmark inputs, while applying an explicit disk budget to regenerable caches. An unbounded append-only copy of every remote scene would violate the resource constraint. Reprocessing creates a new observation/version; it should not overwrite an archived conclusion. Use range/window access where supported and measured, bounded downloads otherwise; remote HDF5 layouts do not guarantee cheap arbitrary crops.

### B. Separate effect size, detection and interpretation

For positive calibrated power, the existing comparison is conceptually `10 log10(after / before)`. Keep it as a descriptive measurement.

Add candidate detectors in increasing complexity:

1. The current fixed dB threshold as an explicit baseline.
2. A matched quiet-reference detector using empirical change distributions by compatible geometry, land-cover/signal stratum and season.
3. A robust multitemporal anomaly detector where sufficient history exists; document the reference window and sampling support.
4. Object-level water candidates and persistence/refinement, evaluated as separate steps.

Thresholds, smoothing, minimum object size and temporal persistence must be tuned only within development folds. Every step can change the target: smoothing can erase small wetlands, persistence can miss short floods, and morphology can connect separate water bodies. Compare ablations, not only the final attractive map.

A reported “confidence” must name its meaning: calibrated event probability, empirical false-alarm frequency, interval coverage or reviewer agreement. These are not interchangeable. If no calibration supports a probability, display evidence quality and “unvalidated detector” rather than manufacturing a percentage.

### C. Treat geometric and sampling error as first-class failure modes

Even a subpixel shift can produce bright outlines around stable features. Add alignment diagnostics and injected-shift tests before interpreting edge changes; record resampling and avoid letting a display warp silently become a measurement transform. Use source geometry/quality indicators when available and fail closed when the comparison is unsupported.

Show the denominator: requested area, observed area at each date and common valid area. Compare results on a stable common support and report how the answer changes with coverage. Missingness can be environmentally informative—cloud and flood conditions are not unrelated. Never assume missing-at-random or introduce inverse-probability weighting without a defensible observation model and adequate overlap.

For seasonal summaries, expose counts by year and season. Compare observation-weighted and year-balanced statistics as different estimands. For the current synthetic example, the pooled median is 100 and the latest-value percentile 7.69; equal weighting of year summaries gives 50 and 50. Neither is universally correct. The scientific question must choose the weighting, and sparse years must remain visibly sparse.

### D. Model uncertainty without inventing precision

Distinguish instrument/retrieval error, co-registration error, sampling/reference error, classifier error and forecast uncertainty. A pixel distribution's p05/p95 is not a confidence interval for area change. Many pixels with shared errors do not supply many independent measurements.

The thermal counterexample adds a common +2 K retrieval offset to an unchanged stipulated physical field. The engine correctly computes a +2 K observed difference with 100% coverage; it cannot infer whether that difference is physical. QA strata and an independent reference study are needed. USGS documents [thermal QA](https://www.usgs.gov/landsat-missions/landsat-collection-2-quality-assessment-bands), [surface-temperature production](https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature), and [known issues](https://www.usgs.gov/landsat-missions/landsat-collection-2-known-issues). ST_QA summaries are not automatically a covariance model for area-level change.

Use probability-sampled reference labels and design-consistent estimators for accuracy-adjusted area and its uncertainty. Olofsson et al. explain why map pixel counts alone do not yield an unbiased change-area estimate. Preserve reference-label uncertainty and adjudication. [Good practices for estimating area and assessing accuracy of land change](https://nottingham-repository.worktribe.com/output/728216/good-practices-for-estimating-area-and-assessing-accuracy-of-land-change)

### E. Improve forecasts through evaluation before complexity

Current forecasts already separate selection, calibration and final evaluation, compare simple baselines, report interval diagnostics and withhold expired targets. Preserve that work.

Next:

1. Add as-of input vintages and explicit station-day target intervals.
2. Freeze the complete release policy, including eligibility and abstention thresholds, before another evaluation period.
3. Record **all** forecast attempts, withheld cases and failures. Report skill conditional on publication alongside the fraction and types of cases published.
4. Evaluate MAE/bias, interval coverage **and width/interval score**, peak timing and high-flow subsets where adequately supported. Do not infer high-flow reliability from average error on ordinary days.
5. Compare a small CPU-suitable candidate against persistence, seasonal naive and the current method on identical information sets. [StatsForecast](https://github.com/Nixtla/statsforecast) is a candidate library, not an automatic improvement.
6. Validate the entire chosen policy prospectively or on another untouched chronological block, without retuning against that block.

Rolling-origin evaluation is preferable to random train/test splits for forecasts. [Forecasting: Principles and Practice](https://otexts.com/fpp3/toolbox.html) supplies free methodological guidance. Empirical/conformal intervals do not automatically retain nominal coverage under serial dependence and environmental distribution shift. A wider band can improve coverage while becoming useless: score width and misses together.

A discharge forecast does not become a flood map by colouring nearby terrain. A hydrodynamic extension would require topography, connectivity, boundary conditions, forcings and separate calibration. Keep that outside the first free-now milestone.

### F. Fuse evidence through explicit relationships

Create a small dependency graph: which observations share raw acquisitions, processing, labels or model training data? An OPERA map derived from the same SAR scene is corroboration of processing interpretation, not an independent second sensor. Do not multiply confidence scores or count derivative layers as independent votes.

Keep observations, model inferences and forecasts distinct. Require explicit space/time matching when comparing optical, radar and station evidence. Show when the quantities cannot be directly combined. A generic “three sources agree” badge would hide the most important scientific differences.

Add **competing explanations and next-observation suggestions**. Example: a radar decrease near a floodplain could justify checking a temporally matched water reference, gauge context and geometry flags. The application should state which observation would discriminate among explanations. Rank review requests by ambiguity, affected area and an explicitly chosen user priority; do not call it formal value-of-information optimization without a decision-loss model.

## 5. Validation that would make improvement credible

Maintain **two separate benchmark tracks**:

* **Method-development track:** Sentinel-1 datasets test preprocessing, label handling, event generalization and detector comparisons.
* **NISAR application track:** actual compatible NISAR scenes with independent, time-matched reference evidence test the application being claimed. C-band performance cannot be transferred as an L-band accuracy number.

Use event, site and acquisition identifiers to prevent adjacent patches and the same flood appearing in different folds. Test generalization at the level being claimed: a new patch within a known event is easier than a new event, basin, season or sensor. Roberts et al. discuss validation for dependent data. A 2025 multi-dataset flood study specifically discusses overlapping events and spatial dependence across popular flood benchmarks. [Roberts et al.](https://www.wsl.ch/lud/biodiversity_events/papers/Roberts_et_al-2017-Ecography.pdf) · [Flood benchmark study](https://doi.org/10.1016/j.rse.2025.114882)

Report per-event results and pooled results, precision/recall/IoU for the relevant class, boundary error, area bias, false alert area per observed area, unknown fraction and abstention rate. Predeclare the denominator and temporal aggregation. Do not choose overall accuracy as the headline for rare events: a detector that always predicts no flood can look excellent on predominantly dry imagery.

Uncertainty resampling must respect the sampling design and dependency units. With very few independent events, an event bootstrap cannot create information; report the individual cases and the limited scope rather than a persuasive-looking narrow interval.

### Free/public benchmark shortlist

| Resource | Use | Access, independence and limits |
|---|---|---|
| [OPERA DSWx-S1 Cal/Val collection](https://podaac.jpl.nasa.gov/dataset/OPERA_DSWX-S1_CALVAL_V1) | Reference sampling/validation lead for water | Catalogue entry found; direct dataset retrieval was not verified in this session. Check matching dates, reference provenance and access before committing a milestone. |
| [KuroSiwo](https://github.com/Orion-AI-Lab/KuroSiwo) | Multi-event Sentinel-1 flood development/evaluation | Code API reports MIT; README identifies the dataset as CC BY without specifying a version in the inspected statement. Pin exact terms with the chosen asset. CEMS-derived labels and event overlap require explicit checks. Not NISAR validation. |
| [Sen1Floods11](https://github.com/cloudtostreet/Sen1Floods11) | Small manually labelled subset and weak-label comparison | Distinguish hand labels from weak labels and freeze event splits. Upstream API supplied no SPDX licence; a fork's licence does not resolve upstream redistribution rights. Full data are much larger than a bounded pilot. |
| [UrbanSARFloods](https://github.com/aliecen/UrbanSARFloods_Dataset) | Hard urban cases where open-water heuristics fail | Some methods use SLC/coherence features unavailable in our current amplitude pipeline. Upstream redistribution licence was not established; do not borrow another mirror's licence. |
| [WorldFloods v2](https://huggingface.co/datasets/isp-uv-es/WorldFloodsv2) | Optical/reference-label comparison and cross-dataset overlap audit | Dataset card identifies CC-BY-NC-4.0. It is not unrestricted for future commercial use; optical timing/visibility and shared CEMS references affect independence. |
| [OPERA DIST-S1 validation repository](https://github.com/OPERA-Cal-Val/dist-s1-validation) | Validation protocol/reference handling for disturbance | Apache-2.0 code; README maturity and product version must be checked. Do not describe unfinished validation material as completed accuracy evidence. |
| [MTBS](https://mtbs.gov/faqs) | Historical fire severity/perimeter context | Spectral burn severity is not field ecological impact or real-time incident truth. Check event dates, definitions and sensor-derived dependencies. |
| [NISAR corner reflectors](https://uavsar.jpl.nasa.gov/cgi-bin/calibration-nisar.pl) | Specialist geometric/radiometric diagnostic work | Check installation dates, reference frame and orientation. Point-target measurements do not validate our flood/vegetation classifier. |

Before any dataset download: record exact asset IDs/checksums, licence text/version, reference acquisition date, label-generation method, event IDs and split assignment. Download a bounded subset only. The [benchmark protocols](BENCHMARKS.md) define the first experiments and advancement gates.

## 6. GitHub projects: what to reuse and what to avoid

| Project | Concrete role | Adoption decision |
|---|---|---|
| [opera-adt/DSWX-SAR](https://github.com/opera-adt/DSWX-SAR) | Water-detection algorithm reference and comparable baseline | Study/adapt bounded pieces after validation; Apache-2.0. The full pipeline is not proven to fit our worker budget. |
| [opera-adt/dist-s1](https://github.com/opera-adt/dist-s1) | Disturbance processing, input preparation and temporal workflow | Apache-2.0; later, targeted experiment. Separate pipeline infrastructure from scientific algorithm. Some upstream checks depend on organization credentials. |
| [Remote-Sensing-of-Land-Resource-Lab/pyxccd](https://github.com/Remote-Sensing-of-Land-Resource-Lab/pyxccd) | COLD/S-CCD family for longer optical disturbance histories | Apache-2.0; current successor linked by `GERSL/pycold`, whose README says it is no longer maintained. Not a drop-in NISAR detector. |
| [deepcharles/ruptures](https://github.com/deepcharles/ruptures) | Small change-point experiments | Compare against seasonal/reference baselines. Irregular dates, gaps and seasonality require explicit handling; a detected break is not a causal event. |
| [Nixtla/statsforecast](https://github.com/Nixtla/statsforecast) | Efficient small forecasting candidates | Test only after the vintage-aware runner exists; retain current baselines. |
| [SMByC/AcATaMa](https://github.com/SMByC/AcATaMa) | Offline QGIS reference sampling and area/accuracy assessment | GPL-3.0; useful as an external validation workflow. Do not casually embed it in the web service. |
| [kipoju/udl4fl](https://github.com/kipoju/udl4fl) | Reproduce the published cross-benchmark flood evaluation | LGPL-3.0 code; dataset rights remain separate. Start with split/overlap methodology, not heavyweight training. |
| [BErukky/disasterWatch](https://github.com/BErukky/disasterWatch) | Inspect transects, probe interactions, time series and export ideas | Useful UX inspiration. Repository API did not identify a licence; copying code needs resolved permission. Its InSAR and GUARDIAN features do not establish scientific compatibility with GCOV amplitude or validate Earthsignal. README speed/test claims are not independent accuracy evidence. |

A push date, star count, licence badge or passing upstream test is not a scientific endorsement. Pin versions and inspect the actual algorithm/data path before adoption. `geemap` can help an Earth Engine workflow but is not itself an accuracy engine, and Earth Engine eligibility/authentication must not be assumed to be free, usable infrastructure for this deployment.

The [repository inventory](repositories.json) records the exact default-branch commit and API-reported licence for 13 repositories at research time. Code licensing and dataset rights remain separate checks.

## 7. Architecture and user experience

Keep the user's unified, modern workspace. Do not create a separate “real science” tab. The same map and filter workflow should reveal more detail progressively:

* **Measurement:** change magnitude/area, dates, units and valid footprint.
* **Evidence:** calibrated detector status, reference comparisons and an accessible confidence/uncertainty definition.
* **Explanation:** competing causes and corroborating versus dependent sources.
* **Action:** places to inspect, evidence still needed and exportable analysis record.

Charts should answer questions: water area through observed dates; coverage alongside change; year-by-year seasonal support; held-out detector trade-offs; forecast versus observations with issue/target times. Show breaks for unknown data. Label sample spread, sensitivity ranges and predictive intervals differently.

Underneath, prefer **versioned observations → bounded measurement jobs → task-specific inference → benchmark results → evidence brief**. Extend the current small server. Profile actual peak memory, decoder buffers, array copies and concurrent requests before setting new limits. Tiled operations need halo/boundary tests; crop size alone does not predict peak memory. Cache keys must include product version, band, geometry, grid, mask policy and algorithm parameters.

A distributed cube is justified later by measured workload, not by the desire to look sophisticated. Likewise, a foundation model becomes useful when a frozen benchmark identifies an error it can plausibly fix and local inference fits resources. Neither is a prerequisite for a strong scientific result.

## 8. Ordered implementation programme

These are proposed work packages, not completed features or guaranteed timelines.

| Order | Deliverable | Advancement evidence |
|---|---|---|
| 1 — Recover evidence | Fix compatible-pair selection and failed-endpoint recovery; deterministic duplicate-quality handling; explicit issue-relative lead | Reproduced fixtures pass without changing compatibility or hiding missingness; archived results remain reproducible. |
| 2 — Freeze observations and evaluation | Extend measurement manifest, bounded cache, reference-label manifest, event/site splits and benchmark runner | Frozen result can be rerun; late revisions cannot change an earlier as-of forecast; known unsupported comparisons remain unknown. |
| 3 — Calibrated water pilot | Fixed-threshold baseline versus quiet-reference and OPERA-inspired candidates; separate NISAR and C-band tracks | Better performance on a preregistered task metric at the same support, with acceptable false-alert cost; all failures and abstentions included. |
| 4 — Explain and prioritize | Water-change timeline, source-dependency view, alternative explanations and inspection brief | Scientists complete the defined inspection task faster or with better prioritization in a counterbalanced pilot; no unsupported causal claims. |
| 5 — Forecast and disturbance extension | Vintage-aware forecast scorecard and one longer-history disturbance candidate | Untouched-period release-policy evaluation and event/site holdout results justify expansion. |

Set numeric acceptance thresholds **before** viewing the final evaluation, based on the task's cost of misses versus false alerts and achievable reference support. Do not borrow an arbitrary “85% accurate” requirement from an adviser or another product. A failed candidate is a useful result if its failure is reproducible and prevents a misleading release.

For the competition demonstration, show one representative environmental-change case, one difficult case and one abstention case. Let a reviewer trace the headline area or chart to actual products and see the validation result. This is a credible differentiation strategy; judging outcomes and superiority over other teams have not been established by this research.

## 9. Free reading that directly informs the work

| Resource | Read for | Immediate application |
|---|---|---|
| [NASA/SERVIR SAR Handbook](https://ntrs.nasa.gov/citations/20190002563) | Radar scattering, preprocessing, forest applications and measurement limitations | Define which environmental claims each product can support. |
| [USGS Statistical Methods in Water Resources](https://www.usgs.gov/publications/statistical-methods-water-resources) | Censoring, seasonal/nonparametric analysis, serial dependence and hydrological inference | Improve support/uncertainty interpretation without adding unjustified significance claims. |
| [Forecasting: Principles and Practice](https://otexts.com/fpp3/toolbox.html) | Baselines, rolling-origin evaluation and forecast distributions | Build the vintage-aware scorecard. |
| [Olofsson et al., 2014](https://doi.org/10.1016/j.rse.2014.02.015) | Probability sampling and area/accuracy estimation | Replace unsupported pixel-count certainty with a defensible reference design. |
| [Roberts et al., 2017](https://epub.uni-regensburg.de/39299/) | Validation for dependent spatial/temporal data | Align the split with the claimed generalization. |
| [Understanding flood detection across modalities and benchmarks, 2025](https://doi.org/10.1016/j.rse.2025.114882) | Dataset overlap and cross-modality evaluation | Prevent inflated results from shared events or adjacent patches. |
| [CEOS NRB product specification v5](https://ceos.org/ard/files/PFS/NRB/v5.0/CARD4L-PFS_Normalised_Radar_Backscatter-v5.0.pdf) | Analysis-ready radar metadata and quality principles | Improve lineage and measurement contracts; cited version is not claimed to be the latest standard or proof of compliance. |
| [Scikit-learn threshold tuning guidance](https://scikit-learn.org/stable/auto_examples/model_selection/plot_tuned_decision_threshold.html) | Separating fitting, threshold tuning and evaluation | Use custom event/time splits; do not inherit default random/stratified splits for EO. |

Publication records, documentation, selected articles and repository materials were inspected; this is not a claim to have read every page of these books or every line of these projects. Access and methodological limitations remain explicit in [REVIEW.md](REVIEW.md).
