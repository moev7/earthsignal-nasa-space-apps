# Earthsignal: scientific engine research and development roadmap

Research date: 10 October 2026. Audited application baseline: commit 9ef5847; scientific implementation c2ecc594b8787f0f1d88ce34b11206214a212f80. This document proposes improvements; it does not activate new models, change production results, or certify environmental predictions.

## 1. The recommendation

Build an uncertainty-aware historical analysis and validation engine before expanding predictive model capacity. Earthsignal has valuable foundations: native raster calculations, common-valid comparisons, documented masks, bounded processing, source identity, and explicit withheld conclusions. The next step is to make every substantive answer carry its measurement support, seasonal context, uncertainty, applicability, and independent evaluation.

The scientific sequence should be:

1. Establish what was measured, where, when, and with what limitations.
2. Determine whether change exceeds expected measurement noise and ordinary seasonal variability.
3. Validate the interpretation with independent reference observations.
4. Produce locally evaluated forecasts with calibrated uncertainty and a clear valid time.
5. Evaluate whether those forecasts or scenarios improve a specified decision.
6. Add causal interpretation or more complex models only when their assumptions and data are defensible.

This ordering is an engineering synthesis of the sources cited below, not a claim that one published method solves all these problems. A good first product is an answer such as: “Water extent increased relative to the same-season baseline; these locations have independent supporting observations; these others remain ambiguous; this station forecast has this evaluation record.” It should be possible to inspect the calculation and reproduce the chart behind each sentence.

### Research scope and limits

The investigation covers radar amplitude and interferometry; optical reflectance, water, vegetation and temperature; hydrologic gauges and forecasting; fire, drought and exposure; statistical validation; uncertainty; causal and decision analysis; foundation models; and implementation tools. It combines primary papers, official product documentation, public books, live GitHub inspection, code audit, and synthetic counterexamples.

Publication metadata/abstracts and selected accessible sections were reviewed; this is not a claim to have read every cited book cover to cover. Some articles or endpoints were inaccessible. Repository metadata and selected source paths were inspected, not every repository fully executed. No regional field campaign, independent labeled environmental benchmark, production latency benchmark, or paid data access was performed. Recommendations therefore include the experiments needed to establish usefulness. The source inventory records access depth and the repository snapshot records failures, redirects and licensing evidence.

## 2. What the current engine does—and what the audit found

The audit inspected service/processing.py, service/analysis.py, service/observatory/{engine,forecasts,methods,providers,raster,scenarios,sources}.py, lib/water-history.ts and scientific documentation.

| Area | Current strength | Material next gap |
|---|---|---|
| Native radar | Verified gamma-zero power, compatible pairs, versioned exception masks, native crop, common-valid log ratio | No calibrated false-alarm model, temporal reference archive, or phase-derived deformation |
| Optical measurements | Quality masks, scaled reflectance/temperature, AOI masks, finite-value checks | Sparse date selection; no executed multiyear seasonal interpretation, retrieval uncertainty propagation, or classification validation |
| Gauge series | Station-specific units and chronology; modern USGS OGC v1 provider | As-of observation vintages, revisions, forcing inputs and target-specific physical constraints |
| Forecast evaluation | Frozen pretest selection, final unseen yearly cycle, persistence and seasonal-naive competitors | Selection/calibration separation, interval publication gate, issuance-time alignment, event utility |
| Decision scenarios | Explicitly conditional geometry and assumptions | Robust sensitivity, empirically estimated intervention effects, decision validation |
| Provenance | Source IDs, hashes, observation/retrieval distinction, preserved populations | Complete method/model/split lineage and independent evaluation artifacts |

### Reproducible counterexamples and execution boundaries

The included audit_experiments.py runs against the existing numerical modules. Its receipt is audit-experiments.json. These fixtures demonstrate code behavior, not the actual error rate of real environmental forecasts. The Python evaluate_gauge helper is an experimental candidate evaluator: the inspected assessment engine does not invoke it and explicitly withholds local predictions. The separate historical browser experiment already has its own empirical coverage gate; it remains retrospective. The findings below identify helper weaknesses to fix before operational integration, rather than proving that the live assessment publishes unreliable forecasts.

1. **Expired forecast object at issuance.** With the last daily observation on 8 October and issuance on 10 October at noon UTC, the helper's stale-data policy accepts the history and emits a one-day forecast valid through 9 October. Define observation cutoff, issue time and target time independently. Either nowcast the unobserved gap with its own validation, evaluate the longer effective lead, or withhold the expired horizon.
2. **MAE skill does not guarantee interval reliability.** A deterministic series with a linear selection period and small oscillations in the final test year produces forecast objects with 50–93% MAE improvement over the strongest naive competitor, but 0% interval coverage and zero-width intervals. The helper still emits them. Require uncertainty evaluation as an explicit gate before operational integration, and diagnose disagreement by season, magnitude and horizon.
3. **“Multiyear” needs distinct years, not only samples.** Twelve observations from one prior year satisfy the seasonal helper’s sample gate. Define minimum distinct comparable seasons and temporal support separately from observation count. The production assessment currently withholds a multiyear conclusion; retain that caution.
4. **Persistence needs elapsed time.** Three supplied observations separated by decades satisfy the descriptive persistence helper. Define maximum gap, acquisition cadence and distinct dates; do not label irregular observations as consecutive monitoring.
5. **Coverage is not representativeness.** The summary helper calls an 80%-valid selection a whole-area scope. In the constructed missingness pattern, reported selected p95 is zero while full-population p95 is 100. Both medians are zero in this example; the discrepancy is in a statistic actually reported by the helper. High coverage cannot by itself prove representative whole-area summaries. Report measured-support statistics and missingness patterns; use an explicitly justified estimator for whole-area inference.

Additional inspected limitations:

- The same selection residuals choose the winning model and determine its error-band radius. Use a separate calibration fold or nested chronological cross-fitting. This is model-selection optimism, distinct from the code’s otherwise useful final holdout.
- p05 and p95 are quantiles of pixel values, not a confidence interval for the area median, the amount of change, or the truth of a causal claim.
- A 10% MAE improvement is a product policy, not a statistical significance test or evidence of event usefulness.
- Final-test scores also determine which station/horizon outputs pass eligibility. Preserve all attempted outcomes; evaluating only the passing subset conditions performance on passing that test. Evaluate the entire release policy on a further untouched or prospective period.
- The Landsat provider uses temperature and QA_PIXEL; ST_QA, distance-to-cloud and relevant ancillary quality layers are not currently used.
- Scientific applicability and the existing “transfer” resource/bandwidth status should be separate concepts.
- Architecture documentation mentions FastAPI/uvicorn, whereas the inspected service uses Python’s HTTP server classes. Resolve this documentation drift before architecture changes.

## 3. The measurement contract every method needs

Create a shared scientific input contract containing quantity, unit, datum/reference frame, spatial support, temporal support, observation time, availability time, acquisition geometry, processing baseline, mask policy, quality indicators, uncertainty provenance and source version.

Spatial support means the actual measurement footprint or averaging population, not just a display grid. A daily gauge average, instantaneous overpass, multiday optical composite and modeled daily field are different observations. Track their aggregation explicitly. A 30 m output grid does not necessarily provide independent 30 m thermal information.

Uncertainty should have separate components:

| Component | Examples | Representation |
|---|---|---|
| Measurement/retrieval | Radiometric noise, temperature retrieval, gauge rating curve | Producer uncertainty or independently estimated error model |
| Sampling/support | Clouds, mixed shoreline pixels, incomplete AOI, irregular revisit | Support masks, effective sample size, sampling estimator |
| Model/structural | Hydrologic model mismatch, land-class confusion, nonstationarity | Competing models, residual diagnostics, applicability limits |
| Forecast | Weather forcing, lead-time growth, initial-state uncertainty | Evaluated predictive distribution or quantiles |
| Scenario | Assumed interventions, costs, preferences | Conditional ranges and sensitivity; no invented occurrence probability |

The [BIPM uncertainty guides](https://www.bipm.org/en/web/guest/publications/guides) supply the foundation for measurement-model propagation and Monte Carlo treatment. A producer accuracy target is not a measured uncertainty for every pixel. If no defensible error model exists, mark that component unknown rather than constructing a precise-looking interval.

For a normalized difference I=(a-b)/(a+b), the first-order derivatives are 2b/(a+b)^2 and -2a/(a+b)^2. Propagate the covariance of a and b through those derivatives. Shared atmospheric errors can correlate the bands; omitting covariance can misstate uncertainty. Near an unstable denominator, reject the index or use a validated nonlinear propagation method.

For D=after-before, Var(D)=Var(after)+Var(before)-2Cov(after,before). For an area mean, variance also depends on covariance between locations. Millions of correlated pixels do not supply millions of independent environmental observations. Use spatial blocks, a fitted covariance model, or a design-based reference sample as appropriate; distinguish a sampling interval from model uncertainty.

## 4. Radar amplitude: make change detection statistically meaningful

### 4.1 Product-aware ingestion

The [ASF GCOV guide](https://nisar-docs.asf.alaska.edu/gcov/) describes calibrated terrain-corrected power and variable acquisition-dependent layers, including numberOfLooks. Extend our validated product adapter to inspect ancillary looks, geometry and noise information when available. Preserve exact schema versions, polarizations, track, bandwidth and producer processing lineage. Number of contributing looks is useful metadata but needs empirical checking before it is treated as the effective number of independent looks.

The existing intensity difference is:

    ΔdB = 10 log10(Iafter / Ibefore)

Retain this interpretable effect size. A ±3 dB threshold expresses an intensity-ratio magnitude; it is not automatically a significance threshold or evidence of flooding, damage or land-cover conversion.

### 4.2 Calibrated noise and change tests

Under a simplified homogeneous fully developed-speckle model, let Iafter follow Gamma(shape=La, scale=μ/La), and Ibefore follow Gamma(shape=Lb, scale=μ/Lb). With independent observations and the same null mean μ, R=Iafter/Ibefore follows F(2La,2Lb). A candidate two-sided equal-tail rule uses 2×min(CDF(R), survival(R)), bounded by one. Define tail policy before evaluation. This is a candidate null test, not a universal pixel classifier. Radiometric normalization means the documented product convention; dividing each epoch by its observed scene mean could erase real scene-wide change.

Validate the assumptions on stable reference areas stratified by land cover, season, track, geometry and signal level. Texture, temporal correlation, processing-induced correlation and low signal-to-noise can invalidate the simple null. Estimate effective looks from independent homogeneous targets and producer metadata; propagate estimation uncertainty and check the null after the actual multilooking/filtering pipeline. ENL matching alone does not establish Gamma marginals. A local mean-squared/variance estimate mixes texture and speckle in heterogeneous neighborhoods. Do not install a universal 5×5 ENL estimator and call the resulting probabilities calibrated.

For multichannel covariance testing, [Conradsen et al.’s Wishart method](https://doi.org/10.1109/TGRS.2002.808066) requires the appropriate covariance observations and statistical conditions. Our current HHHH-only path does not provide a full polarimetric covariance test. The [Earth Engine statistical SAR tutorial](https://developers.google.com/earth-engine/tutorials/community/detecting-changes-in-sentinel-1-imagery-pt-1) is an accessible derivation and implementation reference, not a reason to ignore product compatibility.

Treat an image-wide alert map as a multiple-testing problem. Ordinary Benjamini–Hochberg control requires appropriate dependence conditions. [Benjamini and Yekutieli](https://doi.org/10.1214/aos/1013699998) address dependence explicitly. Compare conservative dependent-test procedures and spatially structured empirical nulls; report event/cluster-level false alarms as well as pixel discoveries. Permutation tests also require a defensible exchangeability scheme.

### 4.3 Filtering and terrain

Benchmark adaptive spatial and multitemporal despeckling against unfiltered measurements. Keep both outputs and the filter’s support/version: filtering can suppress real short-lived changes or move edges. Never smooth across invalid pixels, coastlines or different acquisition geometries without accounting for it. [Quegan and Yu](https://doi.org/10.1109/36.964973) motivate multichannel filtering; [Small’s RTC paper](https://doi.org/10.1109/TGRS.2011.2120616) explains terrain normalization.

Add explicit layover/shadow/geometry screening where a verified product or validated geometric calculation supports it. The current subswath/exception masks do not establish radar visibility. RTC cannot restore information from an unobserved or ambiguous geometry.

### First radar experiment

Freeze a small set of compatible real pairs and quiet reference periods. Compare ±3 dB, a validated intensity-ratio null, and a robust multitemporal anomaly baseline. Evaluate false alarms on independent stable locations, sensitivity to known changes, shoreline boundary error, cluster persistence and mask sensitivity. Use cloud-screened optical observations or field evidence as independent references, recognizing their own errors and temporal mismatch. DSWx derived from the same radar input is not fully independent ground truth.

**Useful outcome:** a change layer with effect size, local baseline percentile, tested alert confidence, support mask and ambiguity reasons.

## 5. Water and flooding: extent, mechanism, exposure and forecast are different

A dark radar return can indicate open water; wind-roughened water and inundated vegetation/buildings can return bright signals. Fuse compatible radar, optical classification, historical water occurrence, topography and hydrologic timing. Do not assume any backscatter increase or decrease is a flood.

The [OPERA water product suite](https://www.jpl.nasa.gov/go/opera/products/dswx-product-suite/) and its algorithm implementations are better scientific starting points than a hand-picked universal index threshold. Verify product version, coverage, quality classes and validation report before ingesting a layer. Partial-water classifications and shoreline mixtures need explicit interpretation.

Distinguish:

- Observed surface-water extent and persistence.
- Water extent unusual for this season.
- Inundation attributable to an event.
- Flood depth or hazard intensity.
- Assets intersecting an observed extent.
- Expected losses or future exceedance probability.

The last three require additional data and validation. HAND or DEM height can support a flood model, but DEM height alone is not water depth. Drainage connectivity, levees, river stage and reference datum matter. A HAND tile derived for another stream network can be systematically wrong for the target application.

### Area and accuracy

Pixel area totals describe a mapped class. For an estimate of true changed or flooded area, use an independent probability sample and a confusion matrix aligned with the sampling design. An illustrative error-adjusted estimator is:

    estimated area(class j) = total area × Σh Wh × (nhj / nh)

Here h indexes sampling strata, Wh is the stratum area fraction, and nhj/nh is the reference-class proportion within a stratum. Its uncertainty must follow the actual design; spatial dependence and imperfect reference labels also matter. [Olofsson et al. (2014)](https://doi.org/10.1016/j.rse.2014.02.015) provide the relevant practice.

Do not equate IoU, overall accuracy and unbiased area estimation. They answer different questions. Rare flood classes need omission/commission analysis and event-level validation, not an impressive overall score dominated by dry land.

### Reservoir volume

Lake level, area, storage and river discharge cannot be substituted for one another. To infer reservoir storage from level, obtain a dated elevation–area–capacity relationship and a consistent vertical datum. A water-balance model may use:

    S(t+Δt) = S(t) + (Qin-Qout)Δt + (P-E)AΔt + other fluxes

The equation is schematic: precipitation/evaporation units, variable surface area, seepage, withdrawals, inflow routing and operating rules must be handled consistently. Use physical constraints supported by metadata; do not merely clip impossible forecasts after the fact and leave their probability calibration unchanged.

**Useful outcome:** water-area histories, seasonal departures, uncertain storage trajectories where conversion data exists, and station-specific risk estimates with verified lead times.

## 6. Vegetation, drought and disturbance: replace two-date stories with histories

Current optical measurements are useful snapshots. They do not yet establish a seasonal anomaly or the cause of stress. Build a quality-screened, comparable acquisition history with enough distinct seasons for the target ecosystem and sensor.

Use a robust same-season reference distribution first: median, dispersion, empirical percentile and valid-observation support. Model calendar effects carefully, including leap days, irregular revisit, sensor changes, agricultural rotation and long-term drift. A fixed day-of-year window needs independent evaluation; more correlated observations in one season do not replace more years.

| Method | Suitable question | Key requirement / failure mode |
|---|---|---|
| Seasonal percentiles / robust anomalies | Is this observation unusual locally? | Comparable historical seasons; distinguish trend from anomaly |
| Harmonic regression or GAM | How does a variable depart from a seasonal pattern? | Sufficient valid history, residual diagnostics, irregular-time handling |
| BFAST | Are trend/seasonal components changing? | Adequate cadence/history; missingness and break assumptions |
| CCDC / COLD / S-CCD | Is there a persistent spectral break? | Dense multiband histories, validated preprocessing and local calibration |
| LandTrendr | What multi-year disturbance/recovery trajectory occurred? | Suitable annual composites; not a short-term forecast |
| Bayesian change-point models | What is uncertainty about a structural break? | Explicit priors, dependence model and calibration; probability is model-dependent |

[BFAST (Verbesselt et al., 2010)](https://doi.org/10.1016/j.rse.2009.08.014) and [CCDC (Zhu and Woodcock, 2014)](https://doi.org/10.1016/j.rse.2014.01.011) support the move to time-series analysis. Evaluate methods at the cadence and support of our actual inputs; published results on dense archives do not validate a two-date application.

[HLS algorithms](https://hls.gsfc.nasa.gov/algorithms/) provide a harmonized reflectance foundation. Preserve their product and QA versions; further arbitrary “harmonization” can undo producer corrections. Index names also need explicit bands: the vegetation-water NDWI of [Gao (1996)](https://doi.org/10.1016/S0034-4257(96)00067-3) and open-water NDWI are different quantities despite sharing a name.

For drought, combine vegetation departure with precipitation, evaporative demand, soil moisture and hydrologic response. [CHIRPS](https://doi.org/10.1038/sdata.2015.66), [ERA5-Land](https://doi.org/10.5194/essd-13-4349-2021) and the [SPEI developer guidance](https://climatedataguide.ucar.edu/climate-data/standardized-precipitation-evapotranspiration-index-spei) are useful inputs and methods. A 2026 CHIRPS v3 publication was found; pin versions and evaluate v2/v3 discontinuities rather than silently mixing histories. Reanalysis is a modeled historical estimate, not a substitute for independent local validation.

[FAO-56](https://www.fao.org/4/x0490e/x0490e00.htm) provides the crop evapotranspiration foundation. A field irrigation recommendation additionally needs crop type/stage, soil/storage, management and measured weather; NDVI alone cannot determine an optimal water allocation.

The [OPERA DIST suite](https://www.jpl.nasa.gov/go/opera/products/dist-product-suite/) offers a valuable disturbance adapter and algorithm reference. Check the distinction between optical and SAR products, alert versus annual summary, and validation maturity. Disturbance detection does not automatically classify its cause.

**Useful outcome:** seasonal anomaly charts, break-date ranges, persistence and recovery curves, supported drought indicators, and an evidence-ranked list of possible explanations rather than a forced diagnosis.

## 7. Temperature, fire and exposure

### Surface temperature and heat

Retain Landsat surface temperature as a surface measurement. Add relevant ST_QA and distance-to-cloud screening, retrieval provenance and product-specific ancillary checks. [USGS known issues](https://www.usgs.gov/landsat-missions/landsat-collection-2-known-issues) describe missing emissivity inputs, blockiness and vegetation-adjustment artifacts. A measurement change near a newly irrigated field can involve the retrieval’s emissivity assumptions as well as real cooling.

LST is not air temperature or human heat stress. An exposure module should distinguish surface-temperature exposure from air-temperature or physiological indices. [ECMWF’s UTCI documentation](https://confluence.ecmwf.int/spaces/CKB/pages/340759409/UTCI%2B-%2BUser%2BGuide) uses air temperature, humidity, wind and radiant conditions. Coarse atmospheric data resampled onto a fine map do not establish street-level thermal comfort.

Match overpass time, season, land cover and surface conditions; compare against local stations or appropriate independent references. Population layers need epoch, spatial support and residential/daytime interpretation. Asset intersection describes possible exposure, not health impacts or expected economic loss.

### Fire and burn severity

FIRMS detects thermal anomalies with sensor-specific confidence and sampling. Repeated overpasses can observe the same event; record count is not fire count. Detection footprints are not burned-area polygons, and lack of detections is not evidence of safety. NASA’s [FIRMS guidance](https://appliedsciences.nasa.gov/sites/default/files/2025-05/Part%203%20FIRMS%202025%20Q%26A%20Session.docx.pdf) addresses this distinction.

Burned area and burn severity require separate methods. NBR/dNBR and related metrics need matched pre/post observations and locally appropriate reference labels; spectral severity is not universally equivalent to ecological mortality, soil heating or losses. [MTBS](https://pubs.usgs.gov/publication/70156000) is a useful historical reference with geographic and event-inclusion limits. Use product documentation and a field/reference response design when evaluating severity.

Near-term fire-spread prediction is a much larger project: fuel condition, topography, weather, ignition/perimeter history and uncertainty in suppression/behavior are needed. A hotspot map should not acquire a prediction label through a model fitted to a handful of detections.

**Useful outcome:** active-detection timelines, separately validated burned-area/severity histories, recovery monitoring, and exposure screening with uncertainty.

## 8. Deformation: a valuable distinct scientific pipeline

Amplitude GCOV cannot be converted into displacement. Add a separate phase/displacement product adapter while retaining one integrated user workflow. Start with suitable verified processed products rather than reconstructing a full raw-SAR chain on the web server.

The [ASF GUNW guide](https://nisar-docs.asf.alaska.edu/gunw/) describes phase, coherence, connected components, ionospheric estimates and external correction information on potentially different grids. It explicitly notes corrections that are not applied by default. Never infer correction status from a filename or apply an already applied correction twice.

The [OPERA DISP suite](https://www.jpl.nasa.gov/go/opera/products/disp-product-suite/) supplies a promising processed-data route; the inspected page lists DISP-S1 access and DISP-NI as coming soon. Preserve that availability distinction instead of promising a currently available NISAR displacement stream.

Phase-derived range change involves wavelength/(4π) times phase, with a sign determined by the product convention. Obtain wavelength, reference direction and phase convention from metadata. LOS displacement is a projection: one viewing direction cannot uniquely determine a three-dimensional vector, and LOS is not automatically vertical motion.

A defensible adapter needs:

- Exact product schema, reference/secondary times and reference area/epoch.
- Phase units/sign, coherence, components, geometry and mask definitions.
- Unwrapping/network consistency checks and connected-component treatment.
- Atmospheric, ionospheric, tide and orbit correction provenance.
- Multi-epoch analysis before velocity/acceleration claims.
- Independent GNSS comparison after projection into the same LOS convention and temporal/reference support.

Use [MintPy’s foundational method](https://doi.org/10.1016/j.cageo.2019.104331), ARIA-tools and producer documentation. A universal coherence cutoff or empirical phase–elevation correction is not sufficient: correction may remove real elevation-correlated deformation. Crop-based atmospheric inputs or offline precomputation remain viable alternatives; the small web-worker limit does not prove that weather-model corrections are impossible.

Ground motion can support subsidence or infrastructure monitoring. Earthquake prediction or landslide-failure timing requires a separate, independently validated scientific claim; retrospective deformation is not such a forecast.

## 9. Forecasting: define targets before choosing models

For each forecast specify quantity, unit, station/catchment, observation cutoff, issuance time, valid time, lead time, aggregation, baseline, forcing availability and evaluation population. Preserve exact historical availability: final revised observations and reanalysis weather must not masquerade as information available to a forecaster at an earlier issue time.

The USGS provider already uses OGC v1. Keep it: [USGS migration documentation](https://api.waterdata.usgs.gov/docs/ogcapi/migration/) and the [2027 WaterServices retirement notice](https://waterdata.usgs.gov/blog/api-waterservices-decom/) make a return to legacy NWIS endpoints a poor recommendation. [USGS provisional-data guidance](https://www.usgs.gov/faqs/why-might-usgs-streamflow-data-be-revised) supports recording revisions and approval status.

### Model ladder

| Family | Why evaluate it | What must accompany it |
|---|---|---|
| Persistence, seasonal naive, climatology | Strong transparent reference behavior | Always retain and report negative results |
| Local/damped trend, ETS, SARIMA, harmonic/GAM | Low-cost temporal and seasonal structure | Rolling evaluation; irregularities and parameter sensitivity |
| State-space / Kalman-type | Separate observations from evolving states | Identifiable transition model, observation error, physical constraints |
| RF / boosted trees / quantile regression | Nonlinear lag/forcing interactions | As-of forcing, held-out basins, extrapolation and tail diagnostics |
| Conceptual or process hydrology | Water balance and runoff mechanisms | Catchment topology, parameters, forcings, initial states and calibration |
| Regional LSTM / NeuralHydrology | Learn across many catchments and sequences | Large aligned dataset, site/region holdouts, forcing uncertainty, compute benchmark |
| Hybrid / constrained models | Combine process knowledge and data-driven residuals | Verify conservation and identifiability; constraints alone do not validate skill |

Do not replace the baselines merely because a more elaborate model is available. [Forecasting: Principles and Practice](https://otexts.com/fpp3/tscv.html) supplies chronological evaluation. [Kratzert et al.](https://hess.copernicus.org/articles/23/5089/2019/) support investigating regional neural hydrology; [CAMELS](https://hess.copernicus.org/articles/21/5293/2017/) supplies an established large-sample research basis. These results do not certify a model trained on our small station set.

Tree models can have poor out-of-range behavior; standard regression trees predict leaf averages. Avoid the stronger blanket claim that every XGBoost configuration is bounded by the historical maximum—boosting, objectives and feature regimes complicate that assertion. LSTM memory is not proof of hydrologic storage or conservation.

### Official guidance before rebuilding a forecasting center

Evaluate [NOAA NWPS/NWM and HEFS](https://water.noaa.gov/about/api) as upstream sources of forecast guidance and potential benchmarks. Match a station to the actual modeled reach; retain upstream issue time, horizon, ensemble/version and local error evaluation. Provider identity alone does not make a comparison an independent validation. Official model guidance complements rather than automatically replaces official river forecasts.

The live API is not a multiyear forecast-vintage archive. The inspected NOAA documentation describes only crest/low-water history in the ordinary application API, a ten-day HEFS serving window, and short rolling NWM windows. Experimental API availability/support also needs explicit handling. Before choosing a pilot, verify station/reach/product coverage and a separately documented historical archive, or begin prospective immutable receipt collection. Archived reforecasts must preserve their differences from operational issuances. Withhold a claimed multi-year as-of backtest if those vintages are unavailable.

For longer leads or catchment runoff, weather forecasts, snow and state information become consequential. Obtain bounded station/basin subsets and archived forecast vintages. NOAA’s [CNRFC verification methodology](https://www.cnrfc.noaa.gov/documentation/WRverification_help.php) is a useful real example of hindcasts, varying seasonal skill and reliability assessment. Do not prescribe a guessed 10 GB/day download or specific GPU training duration without measuring the selected workflow.

### Forecast uncertainty

Evaluate both the predictive center and its distribution. [Gneiting and Raftery](https://doi.org/10.1198/016214506000001437) explain proper scores; [Bracher et al.](https://doi.org/10.1371/journal.pcbi.1008618) provide interval-score evaluation.

For a central (1-α) interval [l,u], the interval score is:

    ISα = (u-l) + (2/α)(l-y)1[y<l] + (2/α)(y-u)1[y>u]

It penalizes excessive width and missed observations. Evaluate multiple quantiles/intervals for WIS; use CRPS for suitable full distributions or ensembles. With only one interval and a point forecast, do not pretend to have evaluated the whole predictive distribution.

Conformal approaches are candidates, not automatic scientific guarantees. Ordinary split conformal needs exchangeability and a correctly separated calibration set. Time series are dependent. Adaptive methods can control particular long-run coverage objectives without guaranteeing every horizon, subgroup, extreme event or individual conditional probability. State the assumptions of [ACI](https://proceedings.neurips.cc/paper_files/paper/2021/hash/0d441de75945e5acbc865406fc9a2559-Abstract.html) and evaluate the chosen time-series wrapper directly. A software package does not remove these conditions.

Use magnitude/season-aware residual or quantile models where supported. Retain evaluation of average coverage, width, tail misses, peak timing and drift; a wide interval can have high coverage and little decision value.

## 10. Validation and release policy

Randomly shuffling neighboring pixels or future time points can inflate apparent skill. [Roberts et al.](https://doi.org/10.1111/ecog.02881) address structured cross-validation; [Ploton et al.](https://www.nature.com/articles/s41467-020-18321-y) show the practical importance of spatial validation; [Meyer and Pebesma](https://doi.org/10.1111/2041-210X.13650) motivate explicit applicability assessment.

### Required evaluation design

1. Freeze the question, quantity, decision unit, horizon, baseline and error definition.
2. Create chronological training, selection, calibration and final-test roles. Preprocessing and tuning fit only on permitted past data.
3. For transfer claims, hold out entire sites/events/catchments/regions. Separate an already-observed basin forecast from ungauged regional generalization.
4. Version independent reference observations, label rules, sampling design and acquisition-time tolerance.
5. Report uncertainty in metrics using an appropriate temporal/spatial/event block procedure or reference-sampling design. Independence is not established by sample count.
6. Score the relevant quantities and decisions: error, bias, coverage, width, event detection, boundary/area error, lead time, false alarms and misses.
7. Run a prospective shadow period with archived issuances before an operational label.

### Gates proposed for implementation

| Gate | Acceptance evidence |
|---|---|
| Input validity | Units/datum/geometry/versions supported, masks and observed support preserved |
| Time validity | Target is genuinely future relative to issuance; no inaccessible future inputs |
| Measurement interpretation | An uncertainty model/reference evaluation exists, or unknown is explicit |
| Change/anomaly | Independent quiet/event evaluation and seasonal/geometry sensitivity |
| Forecast skill | Beats appropriate baselines on a frozen test with uncertainty in the score difference |
| Distribution reliability | Predeclared coverage tolerance and interval-score performance by horizon and relevant strata |
| Applicability | Only supported sites, inputs, seasons and ranges; transfer assumptions disclosed |
| Decision usefulness | Specified actions and consequences improve under independent or prospective evaluation |

Set numeric tolerances according to the use case and evaluation power before looking at final results. “At least 30 origins” is an operational minimum, not a proof of reliable rare-event probabilities. A small number of independent floods cannot justify a finely calibrated extreme-flood forecast.

Monitor drift in acquisition/product baselines, missingness, residuals, calibration, forcing distributions and user-defined thresholds. Changes should produce a reviewable model/version change, not silent retraining.

## 11. Causal claims and robust decisions

An observed difference is not a counterfactual effect. To estimate an intervention, define the treatment, affected unit, outcome, time window, comparison, confounders and assumptions. Before/after-control-impact, difference-in-differences or synthetic controls may be useful depending on the design; each requires identification assumptions and diagnostic checks. Spatial spillovers and simultaneous changes can invalidate simple treated/control comparisons.

[Hernán and Robins’ open book](https://miguelhernan.org/whatifbook) is a methodological reference. An intervention tool should not produce causal language from predictive feature importance, a map overlap, or a mechanistic narrative alone.

Extend the scenario module first with sensitivity and robustness:

- Show outcomes across explicitly bounded parameter and cost assumptions.
- Identify dominated options and where rankings reverse.
- Report worst-case or minimax-regret choices when assumptions lack probabilities.
- Use Monte Carlo only when input distributions and correlations are defensible; label elicited distributions as assumptions.
- Use variance-based sensitivity when its sampling assumptions fit. Correlated inputs require an adapted analysis; plain independent-input Sobol indices are not universal.

[Pianosi et al.’s sensitivity workflow](https://doi.org/10.1016/j.envsoft.2016.02.008) and SALib provide useful implementation foundations. A Pareto frontier shows tradeoffs, not a proven best intervention.

For a simplified binary cost–loss decision, act when forecast probability exceeds C/L, provided acting costs C and avoids loss L and the decision assumptions hold. Real interventions may have incomplete efficacy, capacity limits or unequal consequences. Estimate utility against a practical baseline, retain the assumptions, and evaluate false alerts, missed events and lead time.

**Useful outcome:** “These choices remain favorable across these assumptions; this input most affects the decision; these effect estimates are still unmeasured.”

## 12. Foundation models: a bounded experiment, not the scientific foundation

[Prithvi-EO-2.0](https://arxiv.org/abs/2412.02732), TorchGeo and TerraTorch are valuable candidates for learned representations and segmentation. HLS-compatible pretrained models may reduce labeled-data requirements for a particular task. They do not by themselves infer causes, calibrate uncertainty, conserve water or forecast a local gauge.

Before adoption, verify input bands, scaling, temporal sequence, geographic pretraining overlap, fine-tuning labels, checkpoint license and domain limits. Hold out regions/events and compare against a simple index/classifier and a suitable established product. Pretraining contamination and spatial overlap can make benchmark transfer appear easier than it is.

Prefer a frozen downstream-task pilot or embeddings plus a small classifier before full fine-tuning. Foundation-model parameter storage alone is material: 300 million float32 parameters occupy about 1.2 GB before activations, runtime and optimizer memory. This arithmetic is not a measured runtime benchmark, but it rules out casually placing such a model in the current 384 MiB worker.

Evaluate on separate worker resources; persist compact inference products for the UI. No new GPU purchase, cloud account or paid API is required by this research.

## 13. disasterWatch: useful ideas, unsuitable as unquestioned scientific authority

Inspected public paths include README, backend/src/services/{displacement,guardian,usgs}.js, backend/src/server-native.js and shared/site-schema.ts. These findings are limited to those paths and the retrieved snapshot.

- The [displacement service](https://github.com/BErukky/disasterWatch/blob/main/backend/src/services/displacement.js) returns configured displacement values and tile URLs. Its comments describe future ASF querying; the inspected function does not calculate displacement from an ingested interferogram.
- The README’s Myanmar March 2025 example attributes displacement to NISAR. [NASA records NISAR’s launch on 30 July 2025](https://science.nasa.gov/mission/nisar/mission-overview/). That attribution cannot represent an actual pre/post NISAR acquisition pair around the March event. Later observations or simulations would need different labels.
- The [GUARDIAN service](https://github.com/BErukky/disasterWatch/blob/main/backend/src/services/guardian.js) returns a hard-coded summarized payload for Myanmar, including a significance figure and short series. It is not an executable derivation of those statistics from raw TEC in that function.
- Reported cached API latency and test counts do not establish the accuracy of a geophysical interpretation.
- The checked repository metadata did not expose a recognized license. Public visibility is not a substitute for checking reuse permissions.

The case-study workflow, transects, explanatory cards, moment-tensor metadata, provenance distinctions and GIS exports are useful design ideas. Rebuild the quantitative paths from verified products and equations, with reproducible input/output evidence. NASA’s [GUARDIAN description](https://guardian.jpl.nasa.gov/about.html) treats automated detections as research signals, not guaranteed warnings. Do not promote TEC associations into earthquake prediction.

## 14. Repository selection and integration

repositories.json contains a dated public GitHub snapshot, including canonical redirects, metadata licenses, archived status, push timestamps, inspected README URLs and failed candidate names. A push timestamp is neither a release date nor a scientific quality score. Pin a reviewed commit/release and inspect full license/dependency/data terms before adoption.

| Tool / repository | Role in Earthsignal | Adoption judgment |
|---|---|---|
| [ISCE3](https://github.com/isce-framework/isce3) | Producer schemas and raw SAR/InSAR processing | Read/reference now; heavy processing worker later. LICENSE explicitly Apache-2.0 with additional notices |
| [MintPy](https://github.com/insarlab/MintPy) | InSAR time-series and corrections | Separate validated pipeline; checked LICENSE GPL-3.0-or-later |
| [ARIA-tools](https://github.com/aria-tools/ARIA-tools) | GUNW preparation and corrections | Useful where supported products match; Apache-2.0 metadata |
| [ASF HyP3](https://github.com/ASFHyP3/hyp3) | SAR processing service ecosystem | Evaluate supported service/job paths and access; BSD-3-Clause metadata |
| [pyroSAR](https://github.com/johntruckenbrodt/pyroSAR) | SAR preprocessing automation | Optional upstream worker, not all necessary for already processed GCOV; MIT |
| [DSWX-SAR](https://github.com/opera-adt/DSWX-SAR) | SAR water algorithm | Better reference than arbitrary threshold; version/product-specific validation |
| [PROTEUS](https://github.com/nasa/PROTEUS) | Optical water processing | Canonical redirect from opera-adt; separate from DSWX-SAR |
| [OPERA applications](https://github.com/OPERA-Cal-Val/OPERA_Applications) | Product inspection examples | Reuse verified patterns and test fixtures; notebook is not production validation |
| [DSWx verification](https://github.com/OPERA-Cal-Val/DSWx-Requirement-Verification) | Validation design/reference data | Match exact product and validation version |
| [DIST-S1](https://github.com/opera-adt/dist-s1) | Temporal radar disturbance workflow | Study product-derived baseline/change design; stage independently |
| [HLS resources](https://github.com/nasa/HLS-Data-Resources) | Official access and QA examples | Near-term provider support |
| [pyxccd](https://github.com/Remote-Sensing-of-Land-Resource-Lab/pyxccd) | Break-aware optical histories | Evaluate after historical ingestion; Apache-2.0 |
| [pycold](https://github.com/GERSL/pycold) | Older change-detection implementation | README says no longer maintained; prefer evaluating successor pyxccd |
| [BFAST](https://github.com/bfast2/bfast) | Seasonal/trend breaks | Optional R/offline pilot; GPL-2.0 metadata |
| [LandTrendr GEE](https://github.com/eMapR/LT-GEE) | Annual disturbance/recovery | Useful reference; requires Earth Engine access and task-appropriate composites |
| [statsmodels](https://github.com/statsmodels/statsmodels) | Statistical/state-space baselines | Strong near-term candidate; keep subset dependency footprint |
| [sktime](https://github.com/sktime/sktime) | Forecast comparison/pipelines | Useful evaluation tooling; avoid importing an entire platform unnecessarily |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn) | Simple classifiers/regressors | Establish reproducible baselines before deep models |
| [MAPIE](https://github.com/scikit-learn-contrib/MAPIE) | Prediction-interval experiments | Check exact wrapper assumptions; no arbitrary-shift guarantee |
| [NeuralHydrology](https://github.com/neuralhydrology/neuralhydrology) | Regional hydrologic experiments | Later bounded pilot with forcings and independent sites |
| [HydroMT](https://github.com/Deltares/hydromt) | Hydrologic model/data preparation | Useful for a process-model worker and catchment workflows |
| [SALib](https://github.com/SALib/SALib) | Scenario sensitivity | Near-term research candidate; distinguish independent/correlated inputs |
| [HYSWAP](https://github.com/DOI-USGS/hyswap) | Water statistics and historical percentiles | Useful official statistical reference; inspect full license terms |
| [Global streamflow paper resources](https://github.com/google-research-datasets/global_streamflow_model_paper) | Research datasets/evaluation associated with global forecasting | Snapshot marks it archived; useful benchmark context, not a maintained turnkey operational service |
| [xarray](https://github.com/pydata/xarray) / [rioxarray](https://github.com/corteva/rioxarray) | Labeled time/space arrays | Strong archive foundation; preserve units, CRS, nodata and chunk bounds |
| [Rasterio](https://github.com/rasterio/rasterio) | Windowed raster access | Already-compatible processing ecosystem; retain mask/interpolation discipline |
| [odc-stac](https://github.com/opendatacube/odc-stac) / [stackstac](https://github.com/gjoseph92/stackstac) | STAC-to-array loading | Benchmark one rather than integrating both automatically |
| [pystac-client](https://github.com/stac-utils/pystac-client) | Catalog search | Standardize metadata/provider adapters; client does not validate measurements |
| [xskillscore](https://github.com/xarray-contrib/xskillscore) | Labeled forecast verification | Useful for reproducible ensemble/metric harness |
| [pyproj](https://github.com/pyproj4/pyproj) / [SciPy](https://github.com/scipy/scipy) | Coordinate/statistical primitives | Build upon tested implementations and explicit conventions |
| [TorchGeo](https://github.com/torchgeo/torchgeo) | Geospatial data/ML sampling | Optional isolated ML worker; dataset terms vary |
| [TerraTorch](https://github.com/torchgeo/terratorch) | Foundation-model fine-tuning/inference | IBM path redirects; code license does not license all checkpoints |
| [Prithvi-EO-2.0](https://github.com/NASA-IMPACT/Prithvi-EO-2.0) | Pretrained optical representations | Task-specific frozen experiment; checkpoint terms checked separately |
| [GEO-Bench](https://github.com/ServiceNow/geo-bench) | EO model comparison | Broad benchmark complement, not local field validation |

Avoid guessed package names: opera-adt/DSWx-S1 and DSWX-HLS returned 404 in the snapshot; the inspected algorithm repositories are DSWX-SAR and nasa/PROTEUS. Likewise a guessed google-research/flood_forecasting path failed; the verified public paper-resource repository is listed above.

## 15. Architecture that supports the science

Keep the interactive API light; use explicit scientific job profiles with independent budgets. The inspected application’s current limits include one bounded worker, 384 MiB processing memory, native crop limits and transfer/wall-time bounds. Do not put full scene stacks, training or raw InSAR processing into request handlers.

Recommended components:

1. **Provider adapters:** product-aware discovery and subset retrieval with immutable receipts.
2. **Historical store:** windowed COGs or chunked arrays plus observation/availability metadata; cache keys include source revision, AOI, support and method.
3. **Method registry:** quantity requirements, supported inputs, parameters, assumptions, output schema and tested applicability.
4. **Evaluation harness:** frozen dataset/split manifest, baselines, per-case predictions, diagnostics, scores and uncertainty.
5. **Worker profiles:** lightweight measurement, time-series evaluation, processed deformation, optional heavy ML/raw processing.
6. **Evidence graph:** input artifact → transformation → method/model → evaluation → claim/chart; failures and withheld claims remain first-class outputs.

[OGC STAC](https://www.ogc.org/standards/stac/) supports discoverable geospatial asset metadata. [W3C PROV](https://www.w3.org/TR/prov-primer/) provides a useful provenance model. Full RDF deployment is optional; the underlying lineage is the requirement.

Record code/config/model hash, product baseline, unit conversion, mask/support hash, random seed, input vintage, calibration/test splits, corrections, worker environment and generation time. Hashes prove identity, not correctness; preserve both numerical checks and scientific validation.

Expose uncertainty and evaluation through a shared result contract. A chart should know whether its band means temporal variability, spatial quantiles, estimator confidence or forecast uncertainty. An explanation generator can summarize these structured records, but numerical calculations and claim eligibility remain deterministic/validated method outputs.

Add dependencies incrementally. xarray/Dask-style lazy computation is helpful only when chunks, intermediate materialization, network requests and memory are bounded and benchmarked. Arithmetic showing that a few arrays fit in RAM is not a peak-process memory measurement.

## 16. Books and sustained study

These are selected foundations, not claims of complete reading during this task.

| Book / guide | Why it matters | Access examined |
|---|---|---|
| [Hyndman & Athanasopoulos, Forecasting: Principles and Practice, 3rd ed.](https://otexts.com/fpp3/) | Baselines, decomposition, forecast accuracy and rolling-origin design | Open online sections |
| [Beven, Rainfall–Runoff Modelling: The Primer, 2nd ed. (2012)](https://onlinelibrary.wiley.com/doi/book/10.1002/9781119951001) | Hydrologic mechanisms, model uncertainty and equifinality | Publisher description and chapter summaries |
| [Lee & Pottier, Polarimetric Radar Imaging (2009)](https://www.routledge.com/Polarimetric-Radar-Imaging-From-Basics-toApplications/Lee-Pottier/p/book/9781420054972) | Speckle and covariance/polarimetric foundations | Publisher preview/description |
| [Cressie, Statistics for Spatial Data (1993)](https://onlinelibrary.wiley.com/doi/book/10.1002/9781119115151) | Spatial dependence and support-aware statistical inference | Publisher metadata/description |
| [Hernán & Robins, Causal Inference: What If](https://miguelhernan.org/whatifbook) | Identification assumptions and counterfactual thinking | Author-hosted open book/materials |
| [JCGM 100/101 uncertainty guides](https://www.bipm.org/en/web/guest/publications/guides) | Measurement covariance and Monte Carlo propagation | Official open guides/index |
| [Allen et al., FAO Irrigation and Drainage Paper 56 (1998)](https://www.fao.org/4/x0490e/x0490e00.htm) | Evapotranspiration and water-requirement calculations | Official open text |

These pair with the primary papers already cited: statistical accuracy assessment, structured validation, proper forecast scoring, time-series change, InSAR corrections and sensitivity analysis. Together they are more useful to this app than collecting unrelated state-of-the-art model names.

## 17. Implementation order and falsifiable pilots

The following are effort sequences, not delivery promises or calibrated duration estimates.

### Phase A: repair interpretation and evaluation gates

- Fix issue/observation/target-time semantics and expired publication.
- Separate selection from interval calibration; gate unreliable bands using a predeclared evaluation policy.
- Distinguish percentiles, confidence intervals and predictive intervals.
- Replace whole-area scope inference from coverage alone.
- Enforce distinct-year support and elapsed-time persistence where those helpers are used.
- Add product-specific QA/correction provenance and resolve documentation drift.

Acceptance: the supplied counterexamples cease to produce misleading eligibility; real-data outputs preserve provenance and negative results; no unsupported scientific claim becomes enabled.

### Phase B: a reproducible historical/anomaly engine

Pilot one manageable region with a real optical/radar archive and a few supported monitoring stations. Version scenes, masks, processing changes and acquisition geometry. Produce same-season percentile/anomaly charts and quality histories before complex change-point models.

Acceptance: held-out years/events show controlled false alerts, useful detection timing and sensitivity to missingness. Results remain reproducible from frozen inputs. A two-date comparison still has a different claim class from a seasonal conclusion.

### Phase C: one calibrated forecast pilot

Choose a quantity and decision—such as daily discharge exceedance at a specified station. Compare current candidates, statistical/state-space baselines and compatible official guidance. Obtain forcing vintages only if the target benefits from them. Select, calibrate, freeze and evaluate on chronological and site/event holdouts appropriate to the claim.

Acceptance: meaningful baseline improvement with metric uncertainty; acceptable interval scores and coverage by horizon/season/magnitude; correct issue/valid times; prospective shadow issuances; physical and unit checks. If it fails, report the useful observed analysis and withhold forecasting.

### Phase D: one domain product with independent references

Choose either flood extent, vegetation disturbance, or deformation—not all at once. Freeze reference sampling and event definitions, compare the established product/method to our candidate, then test a model improvement.

Acceptance: improvement in the relevant omission/commission, area/boundary or GNSS residual metrics with uncertainty; supported applicability; no same-source reference leakage.

### Phase E: robust decision and optional ML extension

Add sensitivity and ranking reversals to scenarios. If labels, historical coverage and compute permit, evaluate a small neural or foundation-model downstream experiment. Keep evaluation identical to simpler competitors.

Acceptance: demonstrable decision benefit or scientific measurement improvement under a frozen protocol. If the complex model loses, retain the simpler implementation and the negative evaluation.

## 18. Outstanding evidence needed

The next implementation brief should identify target regions/users and obtain representative real product samples, a multi-year comparable archive, independent event/field/GNSS labels, datum and catchment metadata, archived forecast issue vintages, and decision consequences.

Repository inspection cannot establish regional accuracy. Producer validation does not guarantee performance in every AOI. Published neural-model results do not validate our inputs. As-of forecasting is not retrospectively guaranteed by running a chronological loop on revised data.

The most useful investment is a durable scientific evaluation corpus and artifact trail. It lets us add methods confidently, detect regressions, compare models fairly and say precisely when the app’s answer is supported.
