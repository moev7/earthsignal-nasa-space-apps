# Scientific insights, interactive exploration and capacity — 10 October 2026

Earthsignal should generate inspectable new evidence: comparable observations, a robust description of change, tests of competing explanations, calibrated predictions when supported, and conditional comparisons of decisions. Those steps require different validation. A newer model cannot supply all of them by itself.

This update follows the earlier [research report](REPORT.md), [extensions](EXTENSIONS.md) and [free-now scope](FREE-NOW.md). It adds current primary research, two implemented statistical improvements, a concrete navigation audit, and measured capacity. References distinguish peer-reviewed work, books and preprints. Research methods below are candidates unless explicitly marked implemented. Exact competition/challenge requirements remain unconfirmed; no award or operational accuracy is promised.

## Research that changes the implementation

| Primary source and reading depth | Finding relevant to Earthsignal | Decision |
|---|---|---|
| Helsel, Hirsch, Ryberg, Archfield & Gilroy, *Statistical Methods in Water Resources* (USGS, 2020), [book](https://pubs.usgs.gov/tm/04/a03/tm4a3.pdf); seasonal-method chapter evidence | Season, nonnormal distributions and changing observations complicate simple trend interpretations. | **Implemented:** comparable calendar-month summaries and descriptive seasonal slopes. Report support and sensitivity. Do not equate endpoint change, slope and a cause. |
| Gamot, Thibeau–Sutre & Van Dooren, [Mann–Kendall critical-transition robustness](https://arxiv.org/abs/2604.15230), 16 April 2026 **preprint**; abstract and methodological framing | Correlated early-warning indicators can produce misleading trend-test significance in their studied settings. | Keep early-warning/regime indicators experimental. This finding does not invalidate all descriptive seasonal slopes or establish a universally safe alternative test. |
| Oliveira, Orenstein, Ramos & Romano, [Split Conformal Prediction and Non-Exchangeable Data](https://jmlr.org/papers/v25/23-1553.html), JMLR 2024; dependence/block-method sections | Coverage results for dependent observations require assumptions and error bounds. | **Implemented:** explicitly empirical chronological bands with frozen selection/calibration; no exchangeability guarantee. Block methods need their own validated assumptions. |
| Zhai, Cheng & Wu, [Conformal Coverage of Time Series: Validity and Inference](https://arxiv.org/abs/2609.33868), 27 September 2026 **preprint**; introduction/theory framing | Marginal coverage and uncertainty about realized test coverage are different. Strong dependence changes inference. | **Implemented:** report miss direction, consecutive evaluated misses and width-sensitive score. These are diagnostics, not the paper's block-based uncertainty estimator. |
| Hyndman & Athanasopoulos, [Forecasting: Principles and Practice, distributional accuracy](https://otexts.com/fpp3/distaccuracy.html), textbook; scoring definitions | Coverage alone rewards arbitrarily wide intervals; scoring must penalize width and misses. | **Implemented:** single 90% Winkler interval score against equally calibrated baselines on identical final targets. |
| Lu, Kluger, Bates & Wang, [Regression coefficient estimation from remote sensing maps](https://arxiv.org/abs/2407.13659), version 7, 3 July 2025 **preprint**; current metadata/abstract | Reference observations can correct aggregate analyses that treat predicted maps as error-free. | Research track: independent probability/reference sampling before claims about validated area or effects. A prediction map remains different from an unbiased area estimate. |
| Valle and colleagues, [class-conditional conformal land-cover uncertainty](https://doi.org/10.1016/j.jag.2024.104288), 2024 peer-reviewed; abstract and author manuscript evidence | Local classification uncertainty can be spatially mapped and class-specific. | Research track: independent spatial calibration and set-valued labels, including ambiguity/abstention. Do not borrow another study's coverage as local reliability. |
| Yu, Han, Myers-Dean, Wolters & Bastani, [OPTIMUS](https://arxiv.org/html/2506.13902v1), June 2025 **preprint**; abstract/introduction | Persistent anomalies are a different task from isolated visual differences; demonstrated persistence does not classify cause. | Prioritize persistent-change experiments over a two-date hazard classifier. Compare robust simpler rules first, using separate seasons/regions and false-alarm counts. |
| Brown and colleagues, [AlphaEarth Foundations](https://arxiv.org/abs/2507.22291), version 2, September 2025 **preprint**; release/abstract evidence | Annual embeddings can support sparse-label land-pattern analysis. | Evaluate cropped, cached annual embeddings for context and classification. Annual vintage cannot establish current incident conditions. |
| Szwarcman and colleagues, [Prithvi-EO-2.0](https://arxiv.org/abs/2412.02732), version 3, March 2026 **preprint**; model/data/benchmark abstract | 300M/600M geospatial models learn from broad HLS histories; reported benchmark improvements need task-specific transfer checks. | Separate research worker on stronger hardware after checkpoint profiling; preserve native measurements, documented masks and simpler baselines. |
| Marsocci and colleagues, [PANGAEA](https://arxiv.org/abs/2412.04204), benchmark paper; abstract | Foundation models do not consistently beat supervised baselines across diverse geospatial tasks. | Select by independent task/region performance, calibration and cost, rather than model novelty. |
| Adorni and colleagues, [capabilities-based foundation-model benchmarking](https://openaccess.thecvf.com/content/CVPR2025W/MORSE/html/Adorni_Towards_Efficient_Benchmarking_of_Foundation_Models_in_Remote_Sensing_A_CVPRW_2025_paper.html), CVPR workshop 2025; abstract | Different models have different strengths; no universally best model in evaluated settings. | Store a method's supported tasks, sensor, resolution, history, validation and measured resources. |
| Dong and colleagues, [PeftCD](https://arxiv.org/abs/2509.09572), September 2025 **preprint**; abstract/model framing | Efficient adaptation can reduce trainable parameters. | Benchmark adaptation when useful; freezing a backbone does not remove its inference memory. |
| Rouet-Leduc & Hulbert, [temporal inpainting anomaly detection](https://arxiv.org/html/2512.23986v1), December 2025 **preprint**; methods/discussion | Four-frame reconstruction can expose surprising patterns; fixed temporal context, empirical thresholds and stable-change blind spots remain. Reported short inference uses a GPU. | Research track only. Do not copy its normalization, exclusions or runtime into Earthsignal's product calibration, masks or CPU promises. |

No manuscript-level conclusions are drawn from an inaccessible title or search snippet. The earlier bibliography remains available; a related 2026 review that returned an access failure was not treated as fully read. “Latest” here means verified relevant sources through this date, not an exhaustive literature census.

## Implemented insight 1: season-matched station change

Method `station-seasonal-sen-v1` operates on one source-bound USGS daily-mean discharge series in ft³/s, at most 2,000 consecutive calendar slots. Unobserved slots remain missing. Approved finite nonnegative values qualify; provisional and unknown approval values remain in the original history and are excluded from this new calculation.

For each complete calendar month, require at least 80% approved calendar days. Let `M(y,m)` be its approved-day median. Eligible years each contain six qualifying months; require at least three eligible years and six months common to **every eligible year**. For those fixed months:

```
S(a,b,m) = [M(b,m) - M(a,m)] / (b - a), b > a
descriptive slope = median of all S(a,b,m)
```

Every retained month/year-pair has equal weight. Units are original discharge units per calendar year, not annual volume. The month medians reduce sensitivity to isolated readings; they cannot recover missing peaks or make rating-curve changes irrelevant. Three years and 80% support are initial engineering gates, not proof of statistical adequacy or representative missingness.

Repeat the calculation omitting each year, holding the original common months fixed. Show that range and whether the sign changes. The range is **leave-year-out sensitivity**, not a confidence interval, a probability, a significance test, an extrapolation or an imminent hazard indicator. Correlated month/year pairs are not independent samples.

The backend replays the exact source series, support rows, metric and claim before publication. Input hashing includes source IDs, units, quality and dates. UI exposes monthly approval/exclusion counts, longest excluded runs, month slopes, sensitivity, exact table equivalents and method notes. Low support withholds numerical trend conclusions while preserving the observations.

Reproduce an exported assessment offline without importing Earthsignal calculation code:

```sh
python3 scripts/reproduce-station-trend.py /path/to/manifest.json
```

This independently reconciles recorded arithmetic and support. It does not validate source measurements, environmental attribution or decision consequences. Synthetic counterexamples include pure seasonal cycles, zero flow, an isolated extreme, changing missing months, provisional data and one anomalous year whose omission reverses the slope.

## Implemented insight 2: prediction bands that can be challenged

`gauge-selection-calibration-holdout-v3` retains separate chronological model selection, residual calibration and final-year evaluation, 1/3/7-day horizons, baseline comparisons, stale/missing-data withholding and the existing release gates. It changes the calibration radius to residual order statistic `ceil((n+1) × 0.9)`; temporal dependence still prevents an exchangeability-based 90% guarantee.

For one central 90% interval `[l,u]`, actual observation `y`, the implemented Winkler score is:

```
(u - l) + 20 × max(l - y, 0) + 20 × max(y - u, 0)
```

Average this over the identical final evaluation targets. Lower is preferable for the same quantity, units and horizon. This is a **single interval score**, not multi-interval WIS or CRPS. Both persistence and seasonal-naive baseline bands use the same prior calibration dates. Final-year outcomes never select the model or tune its radius.

The export/UI add below/within/above counts, longest consecutive evaluated miss run, baseline interval scores, calibration count/rank and negative hindcast count. A miss run counts evaluated targets, not calendar days or independent events. A `1e-10` boundary tolerance preserves the existing coverage definition; scoring uses the actual miss distance. Negative discharge hindcasts withhold that horizon. Finite-intermediate checks withhold unsupported numerical ranges; scaled nonnegative averaging prevents large finite scores overflowing only during reduction.

All attempted horizons, including failures, remain visible. Existing forecast readers accept archived records without the new optional diagnostics. Stored-parent verification replays their frozen original method, never upgrades or rewrites their measurements. New publication permits only the current assessment/forecast pair; archived v2 replay is enabled after server-side ownership, expiry and completion checks. The frozen body matches the original `becffa7` source, and an actual stored v2 result passes replay with its database hash unchanged. These diagnostics improve auditability, not demonstrated future accuracy. The strongest-baseline 10% MAE improvement and 80% coverage product gates remain documented initial gates; prospective station/region pilots and dependent-coverage inference are still needed.

## Navigation and interaction

The [fresh three-step audit](NAVIGATION-AUDIT.md) found a working but ambiguous launch label, disappearing result navigation after scrolling, and an edited-draft warning that scrolls away from old results. The increment changes the submission label to **Run this investigation**, adds persistent recorded question/dates and draft mismatch, and links Area, Brief, Values, Layers, History, Options and Sources/exports. Restore uses the recorded selection. Snapshots explain layer expiry and how to open the original result for a new scenario.

Date selection links the timeline and every source history, draws a chart inspection line and exposes the exact value, source units and quality. Missing dates remain explicitly selectable. Selection/playback changes inspection, never observations or inferred conditions. Charts retain tables and existing distributions, forecasts, masks and analysis. The charcoal/lime scientific-workspace style remains shared.

Browser checks establish particular interactions and reflow; they do not replace the planned twelve-person comprehension study or certify WCAG. The pilot criterion remains users identifying quantity/date/support, distinguishing claim types, finding evidence, comparing an assumption and exporting the brief.

## Capacity: measured first, upgraded selectively

The [receipt](capacity-2026-10-10.json) comes from `scripts/benchmark-science.py` on the existing one-CPU, approximately 950 MiB host. Each case ran in a fresh process under a 256 MiB memory cap, no swap and 50% CPU quota. The synthetic radar workload uses the actual comparison function and a known +3.0103 dB power ratio with excluded pixels.

| Workload | Core wall time | Peak process RSS | Process time including startup/imports |
|---|---:|---:|---:|
| 10,000 radar pixels | 0.0051 s | 45.1 MiB | 0.247 s |
| 62,500 radar pixels | 0.0063 s | 47.2 MiB | 0.268 s |
| 250,000 radar pixels | 0.0167 s | 54.8 MiB | 0.232 s |
| 1,000,000 radar pixels | 0.0971 s | 90.5 MiB | 0.370 s |
| 2,000 daily station slots, 20 repeats | 0.0032 s median | 23.6 MiB | 0.216 s |

These are calculation timings, **not** acquisition/download/decode/export, operational throughput or model-accuracy measurements. They exclude web/API/worker/OS memory. A single radar run is not a distribution of latency. The evidence suggests data access and workflow overhead deserve profiling before optimizing the arithmetic; their relative cost has not been established by this benchmark.

A practical **proposed**, unpurchased next host is 4 vCPU, 8–16 GiB RAM and 80–100 GiB SSD for bounded optical histories, chunked stacks, more cache and isolated experiments. Keep one worker initially. Do not raise the current host's caps: it has about 1 GiB total RAM. Measure end-to-end p50/p95 job times, peak group memory, disk growth, cancelled-read latency and simultaneous web/worker load before enabling larger crops or concurrent work. Start with a declared pilot service target such as a 30-acquisition bounded crop within five minutes; this is an experiment acceptance target, not a current or upgraded-host promise.

Only add a separate GPU worker after profiling the exact checkpoint and input shape. Prithvi's 300M/600M float16 weights alone are approximately 572 MiB/1.12 GiB, excluding activations and framework overhead, so neither fits the current 384 MiB science group. A 16–24 GiB GPU is a candidate to test, not a measured requirement or guaranteed speed. Annual 64-dimensional float32 embeddings use roughly 244 MiB per million pixels before other arrays; window/cache them and retain vintage. Efficient fine-tuning does not erase backbone inference cost. No hardware purchase, paid inference, quota bypass or automatic model fallback occurs in this release.

## Next insight experiments, with falsifiable acceptance

1. **Persistent disturbance and recovery.** Freeze masked optical histories for Paradise, Sacramento landscapes and one transfer region. Compare season-adjusted robust summaries, documented persistence rules and temporal segmentation before OPTIMUS/inpainting/foundation methods. Keep controls with seasonal changes and no disturbance. Report false alarms, missed changes, time-to-detection, changing coverage and independent reference labels. Cross-sensor/release changes cannot masquerade as events. Proposed intervention benefits remain separate.
2. **Map-assisted validated summaries.** Pair annual embeddings or simple indices with independent, documented reference sampling. Compare pixel classification, mapped footprint and sampling-aware area/aggregate estimates separately. Evaluate spatially separated sites and class-specific calibration/abstention. Store sample design, weights, source vintages, model version and negative outcomes; do not label prediction-powered correction as ground truth or causality.
3. **Forecast usefulness.** Freeze model/calibration policy, then run prospective stations and a held-out region. Assess MAE, interval score, coverage uncertainty under appropriate dependence assumptions, miss runs and stale-data abstention at each horizon. Compare against relevant authoritative forecasts as well as simple baselines. Select decisions/lead time with users before evaluating utility; do not optimize a warning threshold repeatedly on the final test.
4. **Decision robustness.** Extend the existing explicit threshold/preference sweeps with measured source uncertainty where defensible. Keep sampling uncertainty, predictive uncertainty, user weights and scenario assumptions separately switchable. Report Pareto alternatives, conditions for revisiting a choice and missing costs/effects. An option that wins under many chosen weights has no probability of success implied by that count.
5. **Regime indicators.** Test long records, stationary/seasonal controls, intervention/measurement changes and known transitions before publishing an early-warning claim. Account for overlapping windows, multiple searches and dependence. Keep signals descriptive until prospective false-alarm/miss rates and useful lead time have been assessed.

Each experiment needs immutable source IDs, geometry, masks, releases, hashes, temporal/spatial splits, baseline rules, resource receipts and failed cases. Promotion to a decision-facing method requires independent reproduction and comprehension evidence. Gemini can synthesize approved public explanation blocks; it does not create numerical evidence or causal/forecast authority.

## Independent checks and limits

Perplexity Free provided one public research consultation, [receipt](https://www.perplexity.ai/search/211cd946-bf7b-447f-938c-857fdfba972d); model identity was not visible. A wrong citation was corrected against arXiv. Its resource implications were rejected without measurements. Gemini 3.8 Flash Medium reconnaissance timed out without a deliverable. Gemini 3.1 Pro High design advice received qualified acceptance after rejecting arbitrary gates; its later code review's two proposed production defects were rejected because existing uniqueness/source-unit boundaries already exclude both counterexamples. It also wrote four scratch files despite its read-only contract; they were excluded from the repository. Sol gpt-6.1-sol independently checked the forecast math, chronology and exports; its direct-helper overflow finding was reproduced and fixed. A separate Gemini Pro archive review timed out without a verdict. A narrower Sol review correctly found the v3 assessment-version pairing gap; the coordinator reproduced it, bound the versions and tested genuine-v3 mixed/unknown-version rejection. Successful substantive reviews have explicit qualified coordinator verdicts persisted in the bridge; timeouts have no invented acceptance.

Native 200 tests pass with one explicit optional live-data skip; 78 web tests, TypeScript, scoped lint and the standalone build pass at this checkpoint. The final native suite's peak RSS is about 176.8 MiB under its 256 MiB check cap. These checks establish software behavior and boundaries. Activation/live source, retained-hash and desktop/mobile receipts are recorded in [the project checkpoint](../../decision-observatory.md). Human comprehension, prospective forecast reliability, non-US transfer and advanced-model field accuracy remain unperformed acceptance work.
