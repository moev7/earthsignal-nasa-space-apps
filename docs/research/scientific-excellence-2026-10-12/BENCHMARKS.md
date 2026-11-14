# First experiments and decision gates

Companion to [REPORT.md](REPORT.md). Proposed protocols, not completed field studies. Keep data, development decisions and final evaluations separate. Every experiment records code/product versions, acquisition and availability times, geometry, masks, reference provenance, split IDs, parameter search and all attempted cases.

## E1 — Evidence recovery and temporal semantics

**Hypothesis:** more valid comparisons can be recovered without relaxing scientific compatibility.

Use the existing synthetic fixtures: a latest singleton with an older compatible pair; failed first endpoint with later successful endpoints; equal-value duplicate records in both quality orders; forecasts issued after observation latency. Add failure of the final endpoint and multiple incompatible groups during implementation.

**Gate:** select a genuinely compatible successful pair with its actual dates/common mask; preserve deterministic quality metadata under record permutations; publish explicit target intervals and issue-relative lead. No substituted values, inter-sensor mixing or changed archived results. The current fixture failures are reproduced in `experiment-results.json`.

## E2 — Quiet-scene radar false alarms

**Hypothesis:** matched empirical calibration reduces false detections relative to a fixed dB threshold while retaining useful change sensitivity.

Choose stable reference areas with independent evidence, spanning water/land boundaries, terrain, signal levels and acquisition conditions. “Quiet” labels require review; they cannot be defined by the detector's own output. Hold out entire sites/acquisitions. Develop thresholds and preprocessing only on development groups. Pin product maturity/CRID and keep NISAR and Sentinel-1 results separate.

Compare: fixed ±3 dB baseline; empirical quiet-reference thresholds; robust temporal reference where support permits. Use identical valid footprints. Evaluate false-detected area per observed area, false objects per unit observed area/time, their spatial clustering, and sensitivity on separately labelled true changes. Define aggregation explicitly. Report results by stratum and event, not only one global rate.

**Gate:** candidate meets a preregistered task-specific false-alert budget and improves a chosen sensitivity/precision trade-off on held-out units. Fix the budget before evaluation; insufficient independent units means insufficient evidence, not automatic success. Inject 0.25/0.5/1-pixel shifts, edge nodata, low signal, product-version changes and tile boundaries to reveal failure modes. These injections test robustness, not the prevalence of artifacts in real data.

## E3 — Open-water extent and change area

**Hypothesis:** the detector measures water change usefully for inspection prioritization.

First select a small development corpus and an untouched event/site evaluation corpus. Confirm actual NISAR acquisition availability, reference timing and licences before naming a demonstration site. Maintain a separate C-band method-development corpus. Track reference source, timestamp, visibility, class definition, reviewer disagreement and whether it shares inputs with the detector. Do not pool weak labels and manually reviewed labels as equivalent truth.

Use a probability-sampling design when estimating accuracy-adjusted area. Stratify if rare changes need representation, preserving inclusion probabilities and appropriate weights. Blind reference interpreters to predicted labels where practical; record ambiguous and unobservable labels explicitly. If only convenience labels exist, report local benchmark metrics and do not claim design-unbiased regional area.

**Metrics:** class precision/recall/IoU, omission/commission errors, boundary distance with a defined tolerance, mapped versus reference/adjusted area, valid-support fraction, unknown and abstention rates. Report each event and the aggregation rule. A gauge may help explain timing; it is not spatial extent truth.

**Gate:** demonstrate the preregistered error/cost trade-off on untouched cases and disclose where it fails. No transfer of Sentinel-1 accuracy to NISAR. Label mismatches in time/visibility that cannot be resolved remain unscored/unknown with counts, not silently removed.

## E4 — Seasonal sampling and hydroperiod sensitivity

**Hypothesis:** conclusions are robust to plausible sampling differences rather than driven by acquisition density.

Compare pooled observations, year-balanced summaries and stable-season subsets on the same series. Perturb acquisition density within a year while retaining values, remove realistic cloud/gap blocks and change common support. Report counts per year, measurement dates and support. Preserve the meaning of each estimand.

For water recurrence, report detections among observable acquisitions and interval-censored transitions. Separate “water on 6 of 10 observed dates” from “wet for 60% of all days.” Test whether gap patterns change the interpretation.

**Gate:** sampling-sensitive results are visibly flagged and do not acquire a definitive ecological trend label. No p-value or causal conclusion is added merely because a robust slope was calculated.

## E5 — Operational forecast policy

**Hypothesis:** a frozen forecasting-and-publication policy improves a defined station task under information actually available at issue time.

Persist observations as received with quality and revision lineage. For older data without vintages, mark retrospective revised-data results separately. Define station timezone, daily-mean target start/end, issue schedule and effective lead. Partition chronologically into model/parameter development, calibration, policy selection and a genuinely untouched policy-evaluation period, or run prospective evaluation. Apply the complete selection/abstention procedure within each replay.

Score persistence, seasonal naive, current engine and one candidate on identical targets and information sets. Track every attempt, withheld result, provider failure and coverage change. Evaluate MAE, bias, interval score/width/coverage and high-flow/peak timing where sample size supports them. Include publication rate and skill conditional on publication. A classifier of “publishable” cases is part of the system being evaluated.

**Gate:** late corrections do not change historical issued outputs; no future data select/calibrate the issued method; frozen policy meets the task's preregistered utility/error requirement on another period. Correlated targets must not be counted as independent evidence for narrow confidence bounds. No automatic nominal conformal guarantee.

## E6 — Scientist usefulness and reproducibility

**Hypothesis:** a scientist reaches a defensible inspection decision with less effort and no increase in unsupported conclusions.

Use a counterbalanced formative pilot comparing the existing viewer workflow with the evidence brief on equivalent cases. Define the task in advance: select and justify inspection sites, identify unknown areas and locate underlying measurements. Capture completion time, missed relevant sites, false priorities, correction rate and ability to reproduce the result. Small pilot results are descriptive; no unsupported population-level significance claim.

Include one clear change, one ambiguous case and one abstention. Rerun a frozen case from its manifest; compare outputs within a declared numerical tolerance, preserve lineage, and measure actual peak memory/network/disk. Submit an oversized job and verify an explicit bounded failure. Inject a superseded product and ensure the original result is unchanged.

**Gate:** no displayed area/forecast lacks traceable support; the brief communicates unknowns correctly; the user-task benefit is documented; resource use fits measured deployment limits. Expert preference alone is not environmental accuracy.

## Release decision record

For every candidate preserve: hypothesis; intended population/task; exact baseline; allowed tuning budget; reference/split manifest; licence/access evidence; primary metric and tolerance fixed before evaluation; all results including failures; limitations; accepted/rejected verdict; rollback/reversal conditions. New evidence can justify a new version and evaluation, not rewriting an old scorecard.
