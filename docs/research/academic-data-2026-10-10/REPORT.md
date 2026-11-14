# Earthsignal: useful research, evidence and experiments

Date: 10 October 2026. Scope: water, fire, ecology, urban planning, uncertainty and accessible scientific interpretation. Recommendations below are coordinator judgments; proposed experiments have not been executed.

## What this investigation established

The requested Kimi Academic Data / Scholar Search attempt stopped at a capacity/subscription gate; the inherited screenshot was inspected during continuation. No plugin execution or scholarly output is established. The inherited draft attributed advice to Perplexity, browser DeepSeek and Claude, but contained no answer receipts. Relevant DeepSeek/Claude conversations were found; the shared T3 browser disconnected before their answers could be inspected. Those new consultation claims remain unverified and are not used as evidence. Earlier, separately recorded consultations are retained with their original scope. Primary sources and current code were checked independently. This is a targeted literature and implementation review, not an exhaustive systematic review or a retraction audit. See [consultation receipts](consultations.json).

The current engine already preserves native-grid radar differences, masks and provenance, descriptive optical measurements, chronological experimental gauge evaluation, scenarios with explicit assumptions, and evidence-linked plain-language briefs. Reimplementing those under new names would add little. The consequential opportunities are **longer comparable histories, independently validated classifications, better conditional uncertainty, and useful context that retains source identity**. Repository inspection was independently performed by a read-only Codex worker and checked by the coordinator against the existing methods and research package.

The useful result of a new model should be an answer such as “the change persisted in several comparable observations, with this false-alarm record and this remaining ambiguity.” A more elaborate map or a more confident paragraph does not establish that answer.

## Priorities and resource fit

These are proposed admission decisions, not measured compatibility. “Current” means an experiment constrained by the existing 384 MiB science service, half CPU, one worker, 512 MiB transfer/job, twenty-minute runtime, 1 GiB service storage and free-disk reserve. The planned 4 vCPU / 8 GB host is a future CPU machine; no GPU or purchase is assumed.

“Free now” means no new paid API, GPU, server, dataset or subscription. Existing hosting is not free infrastructure. Freely readable papers do not necessarily supply reusable code or accessible data. Small reference-design and forecast-calibration experiments can start with existing tools and retained histories; actual inference improvements still require independent observations. Published DIST-HLS ingestion requires working Earthdata access. TESSERA can begin with a tiny public precomputed window only after its store/year and dependency memory pass admission. Flood training requires permitted labels. CLVAE and unreleased checkpoints are research leads, not immediately usable dependencies.

| Priority | Opportunity | Useful new output | Proposed resource route | Main gate |
| --- | --- | --- | --- | --- |
| 1 | Published OPERA DIST-HLS, then DIST-S1 | Dated disturbance evidence, recurrence and cross-sensor checks | Current: cropped product ingestion, never the complete production pipeline | Actual collection/assets, release-specific masks, transfer budget and local validation |
| 1 | Independent reference sampling | Estimated affected area with defensible uncertainty | Current: compact reference tables and incremental map summaries | A probability sampling design, independent labels and sufficient precision |
| 2 | Classical SAR/optical flood benchmark | A validated water classification and known failure cases | Small CPU pilot; training/adaptation preferably on upgraded host | Event/region holdouts, product compatibility and original dataset terms |
| 2 | Precomputed TESSERA embeddings | Similar-landscape retrieval and label-efficient classification | Current: tiny window experiment; upgraded host: larger cropped downstream training | Available year/version, leakage checks, streaming implementation and independent labels |
| 2 | SPCI interval-calibration experiment | More informative gauge prediction intervals | Small scalar-history CPU experiment | Chronological vintages, extreme-event tests and proper scores against baselines |
| 3 | MTBS fire effects + repeated optical observations | Historical burn/recovery evidence | Current: cropped published products | Independent reference checks and clear distinction from active incident information |
| 3 | Local Climate Zones | Fairer urban comparisons across comparable urban forms | Current: cropped historical context | Nominal vintage, coarse support and current morphology checks |
| Research | CLVAE / distilled flood students / TESSERA v2 students | Compare learned temporal or compact representations | Upgraded host: bounded profiling first | Checkpoints, terms, CPU backend, histories and held-out benefit |

## Methods and datasets worth using

### 1. OPERA disturbance products: useful evidence before another giant model

NASA lists DIST-HLS in production and DIST-S1 with a March 2026 schedule/record start. The DIST page distinguishes optical alert and annual summaries, and describes January 2025 radar wildfire samples as preliminary prototypes. The official DIST-S1 implementation uses RTC-S1 histories and sequential confirmation; it exposes a CPU mode. Those facts do not prove an operational collection exists for every requested place/date, or that its full pipeline fits our host. [NASA products](https://www.jpl.nasa.gov/go/opera/products/), [DIST documentation](https://www.jpl.nasa.gov/go/opera/products/dist-product-suite/), [algorithm repository](https://github.com/opera-adt/dist-s1)

**Proposed use:** discover a published collection, verify its science/status/quality layers, read a bounded crop, and retain the provider's detection timing and meaning. Add an optical/radar evidence comparison that identifies shared upstream inputs. A temporally confirmed generic disturbance must remain “disturbance detected by this algorithm”; identifying logging, fire or another cause needs additional evidence. Existing native NISAR HH calculations remain unchanged. Sentinel-1-derived 30 m products receive their own method, grid and provenance.

**First experiment:** one public retained pilot with stable comparison areas, a known disturbance and missing observations. Reconcile provider states with the documented status codes; distinguish onset, first observation, confirmation and retrieval. Test crop reads and cancellation before any activation. Reject full-tile localization when budgets cannot be enforced. Importing a published product is the initial opportunity; reproducing the production model is a separate project.

**Actual discovery check, 10 October:** an anonymous NASA CMR query returned DIST-ALERT-HLS v1 collection `C2746980408-LPCLOUD` and granule `G4353905990-LPCLOUD`, including vegetation status, anomaly and history asset URLs. Those URLs point to protected LP DAAC storage. The [metadata receipt](dist-discovery.json) proves catalogued assets, not authenticated crop access, pixel validity or scientific performance. No DIST-S1 asset was verified; this limited query is not proof that none exists.

### 2. TESSERA: foundation-model benefit through embeddings already computed

The original TESSERA work has an accepted CVPR 2026 open-access paper. It combines Sentinel-1/2 temporal information into annual 10 m embeddings. The author repository declares MIT software and CC0 embeddings/weights; its ethical guidelines are advisory. Current precomputed representations include 128-dimensional int8 data with scales, with year/region coverage requiring inspection. [Accepted paper](https://openaccess.thecvf.com/content/CVPR2026/papers/Feng_TESSERA_Temporal_Embeddings_of_Surface_Spectra_for_Earth_Representation_and_CVPR_2026_paper.pdf), [repository and terms](https://github.com/ucam-eo/tessera), [ethical guidelines](https://github.com/ucam-eo/tessera/blob/master/aup.md)

GeoTessera documents patch and strip access through a streaming store, dataset/version tags and missing-value handling. A small requested dimension prefix does not necessarily reduce network bytes proportionally: store chunk layout matters. This is an unusually relevant fit for our windowed architecture. [Access library](https://github.com/ucam-eo/geotessera)

**Proposed use:** “show landscapes resembling this labeled reference,” a small supervised habitat/land-cover classifier, or selection of comparable monitoring/control locations. Similarity is a feature-space relationship; it is not proof of equal ecology, biodiversity, hazard or causal comparability.

**Resource arithmetic, not a benchmark:** one million pixels × 128 int8 dimensions is 128,000,000 bytes before scales/masks. Float32 reconstruction is 512,000,000 bytes before overhead, already exceeding 384 MiB. A 100,000-pixel window reduces those payloads to 12.8 MB and 51.2 MB. The access backend must prove bounded reads and account for scales, temporary copies, classifier memory, dependencies and transport. Do not create a full-region float32 array.

**First experiment:** freeze an available dataset/version/year and crop; compare a small classifier using embeddings against original-index/land-cover baselines on independent regions. Test nodata, quantization decoding and cross-year comparability. An annual embedding can contain observations after a within-year event: it cannot be used as a pre-event predictor or “current conditions” representation without temporal availability checks. Training labels, feature pretraining, feature vintage and evaluation years all need a leakage ledger.

TESSERA v2's July/August 2026 preprint describes distilled students and nested dimensional prefixes. Its reported benchmark retention is a research result, not guaranteed performance on our pilots; v2 coverage is still rolling out. Prefer an actually available frozen product for the first experiment. Generating complete annual embeddings remains outside both current limits and a casual 8 GB deployment. [v2 preprint](https://arxiv.org/abs/2607.03949)

### 3. Classical flood mapping: a serious baseline, not an inferior fallback

Iselborn and colleagues' 2023 preprint compares five classical classifiers across 23 feature spaces on Sen1Floods11 and highlights geographic imbalance. Their repository declares MIT software. The source inspected still identifies the manuscript as submitted to Remote Sensing of Environment; journal acceptance was not verified. [Paper](https://arxiv.org/abs/2303.00691), [code](https://github.com/DFKI-Earth-And-Space-Applications/Flood_Mapping_Feature_Space_Importance)

**Proposed use:** benchmark thresholding, a small interpretable tree model and gradient boosting before a temporal neural model. Keep precision/recall and error by event, region, permanent water, flooded land and difficult land cover. A pooled score can hide a failed event. Compare methods using the same available features and labels, or explicitly describe privileged optical context. Include bright urban/double-bounce water, shadows, layover, snow and seasonal wet soils as failure cases.

Sen1Floods11 supplies georeferenced SAR/optical chips and labels, with roughly 14 GB for the full distribution. Its original repository documents VV/VH dB radar and Sentinel-2 Level-1C inputs. These are not current NISAR L-band HH or HLS surface-reflectance inputs. An explicit redistribution license for the original dataset was not verified; a mirror's license cannot resolve that. [Original dataset](https://github.com/cloudtostreet/Sen1Floods11)

**First experiment:** use a small permitted subset of independently hand-labeled chips, freeze the labeling protocol and hold out whole events/regions. Do not score a model against weak labels generated from its own inputs as if those were independent truth. Validate any conversion, harmonization and cloud masks under a separate contract. Passing this benchmark would justify a product-specific pilot, not automatic NISAR transfer.

### 4. CLVAE and distilled students: promising experiments with concrete limits

Yadav, Nascetti, Azizpour and Ban's **Unsupervised flood detection on SAR time series using variational autoencoder** is a February 2024 journal article, DOI **10.1016/j.jag.2023.103635**. Its temporal VAE has a reported 576,395 parameters and is evaluated on multiple floods. Indexed publisher metadata supports these details; direct publisher retrieval failed. The inspected author repository contains a README only and says implementation will follow. Implementation/checkpoint availability and usable licensing therefore remain unresolved. [Publisher](https://www.sciencedirect.com/science/article/pii/S1569843223004594), [author repository](https://github.com/RituYadav92/CLVAE-Unsupervised_Change_Detection_TimeSeriesSAR)

**Proposed use:** a temporal candidate after comparable flood histories and simpler baselines exist. Small weight count does not bound input-stack memory, training memory, runtime or false alarms. Establish quiet-period controls, baseline construction that excludes event information, and independent event-level evaluation. Train and profile outside production; stop at unresolved code/checkpoint terms.

A September 2026 preprint by Schmalstieg, Mueller and Samek distils an optical Prithvi teacher into a 0.7-million-parameter flood student. Its headline deployment uses INT8 TensorRT on Jetson Xavier NX, so its reported speed is not evidence of CPU speed on our VPS. It also reports competitive simple index thresholding on clean external benchmarks. Peer review and usable CPU checkpoints were not verified. [Preprint](https://arxiv.org/abs/2609.20441)

**Proposed use:** a later CPU-export profiling experiment if code/checkpoints/terms become verifiable. Distillation is a useful direction; teacher training and a GPU-specific result are not a current-server deployment plan. Preserve modality: an optical flood model does not become a SAR detector by changing its label.

### 5. SPCI: test uncertainty separately from the forecast itself

Xu and Xie's **Sequential Predictive Conformal Inference for Time Series**, ICML 2023, adapts prediction intervals using conditional residual quantiles. Its theoretical discussion imposes conditions on dependence, estimator weights and conditional distributions. It does not give unconditional finite-sample reliability for arbitrary nonstationary environmental records. [Paper and proceedings](https://proceedings.mlr.press/v202/xu23r.html), [assumptions and implementation link](https://proceedings.mlr.press/v202/xu23r/xu23r.pdf)

**Proposed use:** compare an SPCI-style calibrator to the existing frozen empirical forecast bands while holding the point predictor fixed. This distinguishes interval improvement from a change in forecasting model. Use only residuals whose outcomes were available at issue time; overlapping horizons can leak future outcomes into calibration if maturity is ignored.

**First experiment:** one retained gauge with a frozen training/selection/calibration/final-test timeline and actual source vintages. Evaluate 1/3/7-day horizons, seasonal/extreme-flow subsets, interval width, coverage, Winkler score and point errors against equally calibrated baselines. Add discontinuities, delayed observations and regime-shift tests. Withhold outside declared support. Improved marginal coverage can still conceal unreliable intervals during the events users care about. Code license and dependency/profile checks remain prerequisites.

### 6. Reference labels and prediction-powered inference: turn maps into defensible quantities

Reinosch and colleagues' independent forest-map validation used over 11,000 reference points and showed why high overall accuracy can coexist with materially weaker disturbance detection: most reference area was undisturbed. The work appeared online in 2024 and in the 2025 Forestry issue, DOI **10.1093/forestry/cpae038**. German forest performance is not local validation for Sacramento or another biome. [Author/institute full paper](https://literatur.thuenen.de/digbib_extern/dn068487.pdf)

Angelopoulos and colleagues' **Prediction-powered inference**, Science 2023, DOI **10.1126/science.adi6000**, combines many predictions with fewer gold-standard labels to estimate population quantities. The author package is MIT. Its statistical guarantees still require the applicable sampling/distribution assumptions; a collection of convenient nearby pixels is not an independent representative reference sample. [Author manuscript](https://arxiv.org/abs/2301.09633), [published paper copy](https://www.stat.ubc.ca/~john/papers/AngelopoulosScience2023.pdf), [package](https://github.com/aangelopoulos/ppi_py)

**Proposed use:** make a reference-sampling workbench before publishing “X hectares truly affected.” Existing Olofsson-style design-based estimation remains the initial area-estimation foundation. PPI is a complementary candidate where its target and assumptions match the design, not a shortcut around independent labels.

For an appropriate population/sampling setting, the mean correction has the intuitive form

`estimated mean = mean prediction on the target population + mean(reference − prediction) on independent labeled samples`.

For unequal-probability spatial designs, weights, inclusion probabilities and design-consistent variance must be handled explicitly; do not paste an unweighted i.i.d. confidence-interval routine into a raster workflow. Reference labels also need a timestamp, spatial support, blind labeling where possible, adjudication and uncertainty. Train/calibrate/validate labels must stay separate.

There are different applicable settings: the main PPI treatment assumes i.i.d. inference samples and a prediction rule independent of those data; Appendix B treats a fixed finite population with uniformly sampled reference units. In that latter setting population pixels need not themselves be independent. Freeze the predictor independently of inference labels and choose the uncertainty calculation for the actual design. [Selected assumptions and finite-population extension](https://arxiv.org/html/2301.09633v4)

**First experiment:** predeclare the population and precision goal, design strata and inclusion probabilities, label independently, then compare map-count, conventional design-based and eligible model-assisted estimates. Reject a method that gives narrow intervals but systematically misses the target in simulation or held-out independent audits. Publish mapped footprint and estimated true area as separate quantities.

### 7. MTBS: historical fire effects and recovery, with the correct meaning

MTBS documents NBR, dNBR and RdNBR products and burn-severity mapping. Not all fires are field validated. USGS describes initial assessments obtained after containment, potentially weeks to months later; this is not a live burning-footprint service. [Product definitions/FAQ](https://www.mtbs.gov/faqs), [USGS collection](https://burnseverity.cr.usgs.gov/products/mtbs)

**Proposed use:** retain a dated Camp Fire case and show observed postfire spectral effects alongside repeated quality-masked vegetation measurements, official boundaries and missing coverage. Recovery of greenness is not restoration of the previous ecosystem, and a spectral severity class does not establish injuries, destroyed buildings or individual-tree mortality.

**First experiment:** reconcile masks and area/count denominators. Compare like season and land cover. MTBS classifications derived from the same imagery/indices are useful product comparisons, but are not independent validation of our calculation; independent field/reference observations are needed for ecological interpretation. Check catalog release/vintage and metadata terms before copying reference assets.

### 8. Local Climate Zones: make neighborhood comparisons more meaningful

Demuzere and colleagues' 2022 Earth System Science Data paper supplies approximately 100 m global urban-form classes representing nominal 2018. The paper is CC BY 4.0; separate dataset-record terms were not verified because the linked archive fetch failed. Classification probability is a product statistic, not a probability of harmful heat. [Paper, methods and data description](https://essd.copernicus.org/articles/14/3835/2022/)

**Proposed use:** compare surface-temperature measurements within similar urban-form categories, identify where comparison neighborhoods differ, and explain why a downtown block and an open rural field need different context. Preserve historical vintage and inspect recent redevelopment before using it as present morphology.

**First experiment:** Phoenix surface-temperature summaries with consistent acquisition/masks; compare candidate reference definitions and urban-form strata. Report sensitivity to cloud coverage, morphology vintage and rural reference choice. Surface temperature remains surface temperature; air-temperature/health consequences require additional suitable measurements. Neither LCZ class nor a canopy association supplies a causal estimate of an intervention's benefit.

## Statistical changes that matter across workflows

1. **Define the question before splitting data.** Interpolation among monitored locations, transfer to a new region and prediction of a new date are different validation targets. Watson, Reid, Jerrett and Telesca's *Prediction and model evaluation for space–time data* explicitly discusses the interpolation target in its abstract. Its correct DOI is **10.1080/02664763.2023.2252208**; the initially supplied title/authors/DOI combination was wrong. Region/event holdouts and chronological tests must follow our intended use rather than a universal cross-validation recipe. [Registered abstract and identity](https://pubmed.ncbi.nlm.nih.gov/39071250/). The inherited thesis PDF could not be retrieved during continuation; no full-method reading of that work is claimed.
2. **Keep descriptive spread separate from estimator uncertainty.** Pixel percentiles, leave-year-out sensitivity, prediction intervals and confidence intervals answer different questions. Spatial or temporal block resampling requires enough blocks, an appropriate dependence model and block-size sensitivity. It cannot repair an unrepresentative mask or absent reference labels.
3. **Test matched stable controls before labeling a radar change unusual.** The current `10 log10(after/before)` quantity survives intact. Compare product-compatible histories, seasons, acquisition geometry and masks. Estimate quiet-period/event false alarms under declared conditions; do not adopt an arbitrary ±3 dB threshold as a scientifically validated classifier. Current HH-only inputs do not supply the full covariance matrices needed by a polarimetric Wishart detector.
4. **Control the family of tests users actually see.** Repeated dates, pixels and interactive threshold searches create selection effects. Predeclare target regions/events and report sensitivity/multiplicity where applicable. False-discovery control does not convert a classified map into an accuracy-adjusted area estimate or prove cause.
5. **Keep the denominator visible.** Coverage and validity can change with clouds, missing acquisitions, snow or geometry. Run both common-support comparisons and separately disclosed date-specific summaries. Current assessment validation permits Observed/Derived claims below 80% spatial common coverage when applicability limits are explicit; the descriptive comparison itself has no universal 80% admission threshold. The forecast engine separately uses at least 80% retrospective interval-hit coverage for nominal 90% bands, with a different denominator. Neither rule proves whole-area representativeness or future reliability. Coordinator code-boundary checks reproduced a median difference on 10% spatial support and verified calibration outcomes stay before final-test boundaries; these are synthetic software checks, not field validation.
6. **Do not manufacture independence through fusion.** A map, classifier and published product can all derive from the same optical scene. Keep an upstream dependency graph. Validate any improvement on independent data rather than counting agreeing layers as separate witnesses.

## Richer interaction and “in simple terms” without unsupported conclusions

The promising interface is a guided question over one shared evidence ledger. Maintain scientific tools and add the following views; these are proposed UI work, not changes made by this research.

- **Evidence timeline:** acquisition, gaps, publication, retrieval and confirmation shown separately. Scrubbing a date reveals what evidence was actually available then, including annual-feature lookahead restrictions.
- **Comparable-place explorer:** select a reference class/landscape, inspect why locations are similar, and see excluded/unsupported places. Clicking a match must not silently run a causal comparison.
- **Claim → explanation → discriminator:** each plain-language statement links to its measurement/method, competing explanations and the observation that would distinguish them. Causes may remain unresolved even when a measurement is precise.
- **Threshold/option sensitivity:** change assumptions and see which areas or rankings change, with fixed evidence and persistent scenario labels. Report a directly estimated contrast when comparing quantities; overlapping intervals alone are not a valid difference test.
- **Reference-sampling view:** distinguish mapped pixels, reference labels, estimated area and unobserved coverage. Explain why a few independent, well-chosen labels can be more informative than millions of correlated pixels.

Example templates below are hypothetical and contain no new Earthsignal findings:

> **Observed:** “The satellite detected a persistent change in this patch across comparable dates.” **Possible explanation:** “Vegetation disturbance is one possibility; seasonal moisture and acquisition effects remain alternatives.” **Next useful evidence:** “Check independent optical/field observations before calling this deforestation.”

> **Derived:** “This map classifies the shaded land as water under this product's rules.” **Unknown:** “It does not measure how deep that water is or whether storage is dangerous.” **Option to examine:** “Compare dated gauges, terrain and asset elevations before assessing potential consequences.”

> **Observed:** “The measured surface was hotter at satellite overpass.” **Unknown:** “This does not establish the air temperature or individual heat exposure.” **Next useful evidence:** “Compare suitable weather/station and population/context observations.”

Gemini can explain reviewed public scientific concepts using approved evidence IDs. Authoritative records supply all quantities, labels, citations and scenario assumptions. Private result questions stay local unless a separate authorized sharing design exists. The assistant must not promote “possible explanation” into cause, invent a reference, use dated embeddings as live evidence or assign scenario probabilities. Test those exact adversarial examples.

## A bounded sequence of experiments

**A. Evidence ingestion:** prove cropped reads, masks, timestamps, provenance, cancellation and budgets for one published disturbance product. Verify actual science assets before advertising a supported source. Keep the existing studies reproducible and compare exported counts independently.

**B. Measurement and reference design:** retain quiet-control and known-change cases; freeze source IDs, geometry, releases, hashes and reference protocol. Use an initial small design to estimate labeling effort/precision, then justify sample size. A single illustrative event cannot establish general reliability.

**C. Classification benchmark:** event/region-held-out threshold and tree-model baselines, then CLVAE or compact embeddings only if terms and data permit. Keep thresholds/model selection outside final tests. Publish class/event metrics, confusion/error cases and negative results. Add one declared non-US transfer check; label transfer separately from local validation.

**D. Forecast uncertainty:** test the same point forecast with empirical and sequential calibrators, outcome-maturity checks, proper scores and withholding. Retain existing acceptance gates; review any stronger statistical claim separately.

**E. Understanding and operations:** test whether users can identify quantity/date/place/coverage, distinguish observation/explanation/forecast/scenario, find counterevidence and export a brief. Use the planned formative sessions. Resource-test on the actual host before promotion: peak resident/group memory, network bytes, disk, cold/warm runtime, cancellation, concurrency, incomplete writes and recovery. Numerical synthetic checks and a published benchmark are necessary evidence, but neither alone validates a decision workflow.

Do not publish guessed “seconds per crop,” borrowed IoU, universal confidence percentages or a claim that 8 GB automatically makes all these models practical. Every promotion needs a recorded applicability domain and a rollback-tested, independently checked release.

## Research corrections and remaining limits

- CLVAE's correct journal DOI ends **103635**, not the suggested **103592**; its publication year is 2024, although the DOI contains 2023.
- The space–time evaluation work is by **Watson, Reid, Jerrett and Telesca**, with the Journal of Applied Statistics DOI above, rather than the supplied Meyer/Pebesma/JRSS citation.
- “CPU mode,” small weights, frozen backbones and GPU/edge timings do not establish our memory/runtime feasibility. Input preparation can dominate the budget.
- Citation identities, abstract/selected methods, official product documentation and repository access were checked. No full literature/retraction search, numerical replication, checkpoint execution, complete license audit or production readiness validation was completed.
- Promising papers with unverified terms/checkpoints remain research leads. No new cause classification, predictive capability or scientific-performance claim has been activated.

The user's confirmed competition is NASA Space Apps **Dancing with the SARs**. The [competition-fit assessment](COMPETITION.md) makes NISAR relevance, independent evidence, presentation and submission eligibility the immediate priorities. Generic model breadth alone is not a competition strategy.
