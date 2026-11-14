# Frozen offline benchmark foundation

This package implements bounded software infrastructure for the E2/E3/E6 protocols
in [BENCHMARKS.md](research/scientific-excellence-2026-10-12/BENCHMARKS.md), informed
by [REPORT.md](research/scientific-excellence-2026-10-12/REPORT.md). It is **not a
validated detector, a field benchmark, or evidence of scientist usefulness**.
No dataset is downloaded, no labels are inferred from NISAR or detector output,
and no training, network access, paid libraries, service integration or publishing
is implemented. NumPy is already a service dependency.

## Run a synthetic software check

From the repository root, using the existing environment:

```sh
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -m unittest service.tests.test_benchmarks -v
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -m service.benchmarks synthetic service/benchmarks/_synthetic_example
```

The second command creates a **new** directory and prints its manifest path and
SHA256. It refuses to overwrite an existing path. Copy the returned hash into
the command below; `<PINNED_HASH>` is a placeholder, not a literal argument:

```sh
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -m service.benchmarks evaluate service/benchmarks/_synthetic_example/manifest.json --manifest-sha256 <PINNED_HASH>
```

JSON is printed to stdout. Invalid inputs return exit code 2 and
`invalid_no_score` JSON on stderr. Exit code 0 means evaluation completed; it
**does not mean a scientific gate passed**. Inspect `eligibility`,
`task_budget_result`, `evidence_kind`, `field_validation`, and warnings.
Unresolved rights/timing/visibility/independence produce an ineligible result;
structural invalidity, changed hashes, mixed tracks and split leakage produce no
score. Synthetic results always have
`task_budget_result.status = not_applicable_synthetic_software_check`.

The fixture deliberately contains one reference-label unknown, one
reference-unobservable cell, one prediction abstention and one cell outside
common support. These are arithmetic checks, not downloaded or derived fake
NISAR labels. Its exact hand-calculated confusion matrix is:

| Reference / prediction | No detection | Gain | Loss | Persistent water | Abstention |
|---|---:|---:|---:|---:|---:|
| No detection | 1 | 1 | 1 | 0 | 0 |
| Gain | 0 | 1 | 0 | 0 | 1 |
| Loss | 0 | 1 | 0 | 0 | 0 |
| Persistent water | 0 | 0 | 0 | 1 | 0 |

There are 10 total, 9 common-observable, 7 reference-valid and 6
reference-valid/nonabstained cells. Cells are 4 m²: false-alert area is 12 m²,
common-observable area is 36 m² and reference-valid area is 28 m². False-alert
ratios are 1/3 and 3/7 respectively. Gain precision is 1/3; conditional recall
is 1 and inclusive recall is 1/2. Synthetic performance says nothing about real
environmental accuracy.

## Library

```python
from service.benchmarks import evaluate

result = evaluate("path/to/manifest.json", expected_manifest_sha256="...64 hex characters...")
```

The expected manifest hash is mandatory. For real evaluation it must come from
an independently retained **preregistration/freeze record**, fixed before viewing
final scores. Computing a fresh expected hash after changing labels, splits,
parameters or thresholds defeats freezing and is not a valid protocol. The
runner checks the supplied freeze, but cannot prove when it was registered.
Retain each manifest/result rather than rewriting an earlier benchmark after
product reprocessing. A superseded release needs a new version and evaluation.

Results record the exact manifest byte hash, canonical policy hash, NPZ byte
hash and dtype/shape/content hash of **every** array. Each case exports the full
manifest lineage. Same frozen bytes and implementation give identical
scientific JSON; no execution timestamp or runtime measurements are embedded.
Canonical JSON uses sorted keys, compact separators and disallows nonfinite
numbers. Array SHA256 covers canonical `{"dtype": dtype.str, "shape": [...]}`,
a newline, then C-order bytes. Archive byte hashes can differ when regenerating
a fixture; reproduction means rerunning the retained frozen inputs.

## Supported task and metrics

Only `open_water_transition` is supported. Each NPZ has exactly six 2D arrays
of identical grid shape:

| Array | Meaning / valid values |
|---|---|
| `reference_before`, `reference_after` | Independent reference labels: −1 unknown, 0 non-water, 1 open water |
| `prediction_before`, `prediction_after` | Frozen algorithm classifications: −1 unknown/abstain, 0 non-water, 1 open water |
| `common_observable` | Explicit common before/after measurement footprint: 0/1 |
| `reference_observable` | Reference interpretable at both dates: 0/1; must be a subset of common observable |

Transitions are 0→0 no detection, 0→1 gain, 1→0 loss, and 1→1 persistent
water. An unknown at either date makes that transition unknown. "No detection"
means no open water at the two sampled dates; it does not establish that no
environmental event occurred between them. This task does not detect flooded
vegetation, ecological impact, displacement or causality.

Reference-valid support is the common mask AND reference-observable mask AND
both reference labels known. **Every reference-valid cell remains in the
inclusive denominator, including prediction abstentions.** The confusion
matrix has four reference rows and five prediction columns. Conditional
scores exclude the abstention column; inclusive recall, IoU and omission
count abstentions as missed reference classes. Precision and commission use
class predictions and are identical under these two conventions. Undefined
ratios are JSON `null`, never perfect scores or silently coerced zeros.

For each case and separately for each fold, the runner reports:

- Class precision/recall/IoU, omission (1−recall), commission (1−precision), and
  conditional/inclusive denominators.
- Mapped gains/losses/persistent/no-detection/prediction-unknown counts and m²
  on the common footprint; outside-common unknown counts and m² separately.
  Total mapped unknown area is these two unknown areas summed.
- Reference unknown union counts, label-unknown counts and unobservable counts.
  The latter two can overlap and must not be summed as distinct cells.
- Reference-valid and common-observable fractions, prediction abstention rate
  on reference-valid support, and prediction unknown rate on common support.
- Class-specific false-alert area (gain/loss predictions with a different
  reference class) divided by common-observable area and by reference-valid
  area. A reversed gain/loss is a false class alert and a missed reference
  change. Also report quiet false-alert area / quiet-reference area, where quiet
  is reference no-detection or persistent water.
- Mapped versus reference class area and signed/relative bias on the **same
  reference-valid support**. Abstentions contribute no known mapped class
  area but retain their reference area. Full-common mapped area is exported
  separately and is not compared with a smaller reference footprint.
- Inclusive change recall: correctly oriented gain/loss cells / all
  reference-valid gain/loss cells, including abstentions.

Unknown-reference alerts cannot be declared true or false. The common-area
false-alert ratio therefore has a numerator confined to reference-valid
support and is not a claim of complete-footprint false-alert prevalence.
Do not hide it when reference coverage is sparse. Per-fold aggregation pools
pixel confusion counts and sums each case's mapped m²; it is explicitly not
an event-weighted independent-sample estimator. Per-case/event IDs remain
visible. Repeated patches from one event do not create independent evidence.
No pooling across development, calibration and final folds occurs.

**Withheld:** accuracy-adjusted/design-unbiased regional area (no probability
sampling metadata/estimator implemented, even if extra fields are supplied),
confidence intervals, boundary-distance metrics, object counts/clustering and
alerts per unit time. Adding these requires their own frozen protocol and
meaningful checks. Constant cell area is supported; variable-area/geographic
degree grids require a separately checked conversion before export.

## Manifest contract

The synthetic generator provides a runnable example of every required field.
Replace it only with legitimately obtained inputs and independently reviewed
metadata; do not relabel synthetic arrays as field evidence.

Top level requires `schema_version: 1`, task, evidence kind
(`synthetic_software_check` or `field_reference`), track, policy and 1–32 cases.
Exactly one track is allowed: `nisar_l_band` (NISAR/L), `sentinel1_c_band`
(Sentinel-1/C), or `synthetic` (SYNTHETIC/NONE). NISAR/C-band cases and scores
must stay in separate manifests. Synthetic and field declarations cannot be
mixed.

Policy freezes an ISO timestamp with timezone, the exact class definition,
support policy and aggregation strings from the example, algorithm
name/version/parameters/dependency IDs, and task budget. The budget requires a
reason, maximum false-alert area / reference-valid area, maximum prediction
abstention rate on reference-valid support (strictly below 1), minimum inclusive
change recall **or explicit null** for a quiet-only task, and minimum final
cases/events. Numeric thresholds lie in [0,1]; unit minima are positive integers
up to 32. Set them for the task before final evaluation; example values are
not release recommendations. With no change reference, a non-null recall
gate remains unknown. Absence of final support or adequate held-out units
remains unknown. `met_on_supplied_reference` describes only the frozen task
budget on supplied labels, never completion of E2/E3/E6 or field validation.

Each case freezes:

- Unique case ID, fold (`development`, `calibration`, `final`), whole event ID,
  site ID and acquisition IDs. No event/site/acquisition may appear in more
  than one fold; before/after source IDs must be included in acquisition IDs.
- Grid ID, shape, CRS, explicit `transform_convention: GDAL`, six affine coefficients in GDAL order
  `[x_origin, x_step, x_rotation, y_origin, y_rotation, y_step]`,
  `linear_units: metre`, constant `pixel_area_m2`,
  `area_method: constant_equal_area_m2` or `constant_projected_grid_m2`, and area evidence. The absolute affine
  determinant must equal cell area. This checks consistency, not whether the
  asserted CRS is genuinely equal-area; review that evidence externally. Native
  UTM radar inputs use the projected-grid basis unless a separate justified
  area procedure exists. Their cell footprints retain projection distortion;
  they are not geodesic or sampling-adjusted areas. Evaluator1.1 exports this
  basis explicitly and rejects pooling mixed bases in one manifest. Existing
  equal-area fixtures remain supported; radar inputs are never resampled merely
  to fit the evaluator.
- Geometry ID, exact textual definition and its UTF-8 SHA256; common-mask ID,
  definition and array hash. Geometry semantics are supplied metadata, not
  inferred by rasterization in this runner.
- Local relative NPZ path, file hash, and all six per-array hashes. Absolute
  paths, URLs, traversal and symlink escapes from the manifest directory fail.
- Two ordered sources with product ID/release, maturity, CRID, sensor/band,
  acquisition ID/time, grid/geometry/mask IDs, source-content hash and explicit
  known-issues list. Source acquisition times cannot follow policy freeze.
  The source pair must share release/maturity/CRID and declared grid/geometry/mask.
  Do not fabricate a CRID; for a producer with no CRID, record an explicit
  documented `not_applicable` identifier. Unresolved product lineage is
  ineligible. Source content hashes pin provenance assertions; original
  source assets are not read or fetched by this evaluator.
- Reference ID/provenance/label method, before/after times, label-freeze time,
  temporal-match status, visibility status/evidence, licence
status/terms/evidence/evaluation permission, and independence
  status/evidence/dependency IDs. Label freeze cannot follow policy freeze;
  reference acquisition cannot follow label freeze. Unresolved rights,
  independence, timing or visibility make the case ineligible; overlapping
  reference dependency IDs with detector inputs/algorithm dependencies also
  make it ineligible. Record transitive dependencies, not only immediate names.

These are metadata assertions, not permission certificates or proof of
independence. External evidence must establish actual licence terms, label
visibility/timing, common-mask correctness, geometry, acquisition compatibility,
and the full dependency graph. If evidence is absent, mark it unresolved;
never turn a guessed value into `resolved`.

## Bounded execution and outstanding gates

The runner validates manifests (≤1 MiB) and fold gates before loading arrays.
It caps each NPZ's compressed and summed uncompressed ZIP sizes at 64 MiB,
allows only six named NPY members, rejects duplicates/encryption/unsupported
compression, and inspects every NPY header before allocation. Headers are
bounded at 16 KiB; shape is 2D with at most 1,000,000 cells per case, numeric
dtype at most 8 bytes, no object/structured/complex dtype. NPY payload sizes
must agree with headers. Loading uses `allow_pickle=False`; invalid classes,
nonfinite values or non-binary masks fail. Each case is processed sequentially
in O(pixel count) work; no regional array stack is retained. A bounded archive
snapshot avoids hash/decode races. Snapshot, decompression, arrays and masks
still require actual memory measurement on the intended deployment, including
concurrent workloads; the caps are not a measured deployment guarantee.

The tests cover exact arithmetic, unchanged reference, reverse gain/loss,
reference unknown, all-abstain predictions, each split-leakage unit, hash
tampering, track/release and rights/independence gates, invalid classes/shapes,
nonfinite inputs, count limits, pickle arrays and oversized ZIP/NPY headers.

Original writer receipt before integration corrections (12 October 2026): the focused command above ran **24
tests, all passed** (0.097 s). An actual subprocess CLI synthetic-generation
and evaluation smoke check exited 0; a second evaluation of the same frozen
files produced byte-identical stdout. The 10-cell fixture occupied 6,624 bytes;
evaluation emitted 18,200 JSON bytes. `/usr/bin/time -l` measured 0.08 s wall
time, 30,064,640 bytes maximum RSS and 21,611,776 bytes peak memory footprint.
These measurements include interpreter/NumPy startup and describe only this
tiny software fixture. Network traffic was not instrumented; evaluator code
contains no network operation. Maximum-size/concurrent deployment peak
memory, disk, decoder behavior and network use remain unmeasured.

Outstanding E2: independent quiet and true-change field labels, real matched
acquisitions, baseline/candidate outputs, preregistered costs/support, artifact
injections, independent held-out units and measured task trade-off. Outstanding
E3: licensed independent timed/visible reference labels, actual NISAR
availability and maturity/CRID evidence, untouched cases, sampling design if
claiming adjusted area, and boundary/error protocol. Outstanding E6: actual
clear/ambiguous/abstention environmental demonstrations, scientist pilot,
lineage review and measured deployment peak memory/network/disk. Synthetic
tests do not satisfy these gates.

Smallest next integration: obtain and review one **bounded, legitimately
licensed** before/after reference case; export frozen classifier arrays/common
and reference masks plus lineage into this contract; independently retain the
manifest/policy hash; run this CLI and review its case support/unknowns. Keep
method development and final evaluation disjoint. No UI/API/store/deployment
change is needed to begin this check.

## Integration corrections and independent review

Coordinator corrected the draft's affine convention to actual GDAL order and
added explicit convention, translated-origin and rotated-cell tests. Current
contract uses `transform_convention: GDAL`; old draft examples must be regenerated,
not silently reinterpreted or given a new hash to reuse a previous freeze.

DeepSeek Harness independently reproduced the hand-calculated confusion and
area/abstention results and ran the corrected 26-test suite. Its review also
demonstrated two weaknesses: total abstention could meet a quiet-only false-alert
budget, and source-product/content reuse could bypass split barriers through
renamed acquisition IDs. Both are addressed: budgets now require an explicit
maximum `prediction_abstention_rate_reference_valid_max` below 1, and source
product IDs and original-content hashes may not cross folds. This latter rule is
conservative: separate sites sampled from one shared raw acquisition remain in
one fold. Do not substitute a hash of generic classification values for the
source-asset identity; original source evidence must establish what was hashed.

When sensitivity is omitted explicitly (`min_inclusive_change_recall: null`),
the budget result identifies its scope as quiet false-alert/abstention only. An
all-dry detector on quiet labels says nothing about detecting real changes;
its change sensitivity must be tested separately before E2/E3 promotion.

Current focused suite: **28 tests, all passed**. The earlier resource receipt
above concerns the original tiny fixture only; it is not a maximum-size or
concurrent deployment measurement. Field references and all scientific
advancement gates remain outstanding.


## Separate design-based area experiments

[Stratified area estimation](stratified-area.md) adds a distinct experimental
method for a declared equal-area-cell SRS-without-replacement frame. It weights
reference-defined categories by stratum population and reports sampling covariance
with finite-population correction. Unknown outcomes withhold estimates;
non-census singletons withhold uncertainty. This does not change this benchmark
runner's raster-local counts, add confidence intervals or retroactively make its
areas sampling-adjusted. Existing E2/E3/E6 gates remain in force.

## Real Sentinel-1 readiness case

The [GEOID development case](geoid-development.md) adds pinned direct-file
acquisition and a driver-free frozen-crop reproduction check. It preserves a
negative readiness result:7935/65536 common cells, only the provider background
class, unknown acquisition-geometry compatibility. Per-date descriptive summaries
are available; temporal differences and flood scoring remain withheld. No NISAR
calibration or untouched field evaluation is established.
