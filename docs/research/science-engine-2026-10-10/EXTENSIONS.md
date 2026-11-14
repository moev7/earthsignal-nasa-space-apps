# Additional method and data investigations

These extend the main report. They are conditional research paths, not enabled application capabilities.

## Hydrologic metrics and physical structure

MAE is interpretable in the target unit but insufficient for flood decisions. Add bias, peak magnitude/timing error, low-flow diagnostics and event precision/recall at explicit thresholds. Avoid MAPE near zero flow. NSE and KGE can be useful hydrologic diagnostics, but are not interchangeable with each other or a decision loss. [Knoben, Freer and Woods (2019)](https://hess.copernicus.org/articles/23/4323/2019/) explain that their benchmarks differ. Do not use a generic positive-score criterion for both.

Physics-informed models are worth investigating after the simpler baseline harness exists. [MC-LSTM (Hoedt et al., 2021)](https://proceedings.mlr.press/v139/hoedt21a.html) makes conservation part of a recurrent architecture. A conservation constraint can eliminate a class of impossible behavior, but the choice of conserved quantity, missing fluxes, boundaries and loss function still determine scientific applicability. An enforced balance with wrong precipitation, withdrawals or reservoir operations can be precisely wrong.

Data assimilation should be an explicit state/observation model. [Evensen (2003)](https://doi.org/10.1007/s10236-003-0036-9) provides an EnKF foundation; finite ensembles, inaccurate observation errors, non-Gaussian state distributions and covariance estimation can create artifacts. Feeding last observed discharge into a predictor may help skill, but it should not be presented as a verified substitute for a physical assimilation system.

Gauge uncertainty deserves its own model. [McMillan et al. (2010)](https://doi.org/10.1002/hyp.7587) investigate how uncertain river flow affects calibration and discharge prediction. The distinct [McMillan, Krueger and Freer (2012) review](https://doi.org/10.1002/hyp.9384) benchmarks rainfall, discharge and water-quality uncertainties. The preliminary research confused these citations; the registered metadata was checked. Their reported examples are not universal error bars that can be assigned to our stations.

## Climate projections are a separate inference problem

The app's current NEX research source is not an executed forecast module. [NASA NEX-GDDP-CMIP6](https://www.nasa.gov/nasa-earth-exchange-nex/gddp/downscaled-climate-projections-nex-gddp-cmip6/) supplies downscaled climate scenarios across emissions pathways. These are suitable for investigating changes in long-run distributions or conditional hazards; they do not predict weather on a specified future day. NASA describes important research-use and expert-consultation limits on its page.

A defensible climate module needs a fixed historical baseline, multiple models and scenario labels, variable units/calendar definitions, versioned downscaling, regional evaluation and uncertainty separation. Preserve the difference between internal variability, model disagreement and emissions assumptions. Shared model genealogy can limit apparent ensemble independence.

[Lange (2019), ISIMIP3BASD](https://gmd.copernicus.org/articles/12/3055/2019/) offers a trend-preserving bias-adjustment/downscaling method. Bias correction is not a guarantee of realistic extremes, spatial dependence, multivariate relationships or hydrologic conservation. Evaluate those explicitly. The [USGS study of downscaled climate projection consistency](https://www.usgs.gov/publications/examining-current-bias-and-future-projection-consistency-globally-downscaled-climate) provides a region-specific example of why baseline and downscaling choices matter.

A useful initial output would be a range of changes in seasonal precipitation or threshold-exceedance frequency under a named scenario and baseline. Withhold parcel-level predicted damage without validated hazard, exposure and vulnerability models.

## Better support data—and support-aware fusion

| Data family | Possible benefit | Required scientific care |
|---|---|---|
| Forecast precipitation/temperature, snow and catchment attributes | Forecast runoff and water stress beyond univariate extrapolation | Availability-vintage archive, basin aggregation, weather-ensemble uncertainty |
| SMAP soil moisture | Regional antecedent-wetness/context signal | Product is retrieval or assimilated state; grid posting differs from independent resolution |
| Historical optical/radar disturbance products | Baseline, independent algorithm comparison and disturbance persistence | Input overlap can defeat independent validation; exact version/maturity matters |
| Population/buildings/roads/critical facilities | Exposure screening and asset inventories | Epoch, completeness, resident/daytime population, boundary uncertainty and vulnerability |
| GNSS and displacement geometry | Independent ground-motion comparison | Reference epoch/frame, LOS projection, spatial support and covariance |
| Elevation, drainage networks and reservoir curves | Hydrologic connectivity, storage conversion and physical constraints | Datum, hydrologic conditioning, levees, curve date and missing fluxes |

The [NASA SMAP resolution assessment](https://ntrs.nasa.gov/citations/20180004003) illustrates the grid/support issue: its enhanced passive product is posted to 9 km while the discussed nominal resolution is 33 km. That study does not license treating any resampled 30 m soil-moisture layer as a direct measurement. A downscaled layer is a model product requiring a separate evaluation.

[ERA5-Land](https://doi.org/10.5194/essd-13-4349-2021) is useful contextual reanalysis. Preserve its native support and distinguish analysis from forecast. Use the actual archive available at an issue date for operational backtests; final reanalysis may contain information not yet available then.

For exposure, [GHSL population documentation](https://ghsl.jrc.ec.europa.eu/documents/GHSL_data_access.pdf) distinguishes modeled residential population products and target epochs. This is a documentation lead, not a recommendation to adopt the old release in that document. Inspect the current product/version and geography before implementation.

## Advanced methods worth keeping on the research backlog

- **Hierarchical spatiotemporal models:** borrow information across locations while representing dependence and measurement error. Start with an identifiable quantity and sparse decision-unit history; benchmark against independent simpler forecasts. Do not produce apparent precision by assuming all pixels are independent.
- **Bayesian change-point analysis:** estimate uncertainty in break timing and alternative segmentation. Priors, observation noise, missingness and temporal dependence need sensitivity checks. Bayesian output is conditional on the chosen model.
- **Active learning/reference sampling:** prioritize uncertain or scientifically important cases for expert labels while preserving a separate probability-based evaluation sample. A convenience sample of difficult cases can improve training but cannot directly estimate regional accuracy.
- **Multisensor evidence fusion:** retain source-specific likelihoods/support and dependence rather than averaging arbitrary “confidence scores.” SAR and optical agreement is supporting evidence; shared weather/season confounding or common input products can still correlate their errors.
- **Explainable ML:** feature attribution can help diagnose model behavior but does not establish causation. Evaluate whether explanations remain stable under realistic changes in inputs and model versions.
- **Open-world anomaly detection:** isolation forests, robust multivariate baselines or learned embeddings may find unusual observations. Anomaly detection is not hazard classification; assess false alerts on new seasons/sensors and expert-labeled cases.

These are useful only when tied to a measurable question, explicit assumptions and an independent falsifiable experiment. The main report's release policy should govern all of them.
