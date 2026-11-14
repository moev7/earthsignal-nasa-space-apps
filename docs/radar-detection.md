# Offline radar detection and calibration

`service.benchmarks.radar` supplies bounded native-array research software for the
E2 comparison in [BENCHMARKS.md](research/scientific-excellence-2026-10-12/BENCHMARKS.md).
It does not establish field calibration, reference truth, sensor accuracy, water
extent/change, scientist usefulness, or completion of E2/E3/E4. Tests are synthetic
software checks. An independently reviewed real calibration/change corpus and
untouched field evaluation are still required. Nothing is automatically activated
in the engine, viewer or service.

## Methods and output

All arrays remain unchanged. No resampling, reprojection, clipping, epsilon fill,
ratio calculation or fallback is performed. Inputs are positive compatible linear
powers on an asserted metre grid, with explicit Boolean producer masks. Numeric
nonpositive/nonfinite values or false masks yield unknown. Float64 calculations
use `10 * (log10(after) - log10(before))`, avoiding overflow of `after / before`.

| `Spec.method` | Reference and thresholds |
| --- | --- |
| `fixed_pair` | Before/target log-power difference; strict fixed −3/+3 dB baseline. No calibration candidates. |
| `empirical_pair` | Same pair score; independently reviewed target-stable calibration crops select separate frozen lower/upper candidates. |
| `empirical_temporal` | Target departure from a causal **linear-power** median, with its own calibration and frozen history policy. Its estimand differs from pair change. |

A temporal even-count median uses `(lo + hi) / 2` when the largest endpoint is
at most half the float64 maximum, and `lo + (hi - lo) / 2` for larger endpoints.
This avoids sum overflow and premature rounding of unequal subnormal endpoints.
Results retain normal float64 rounding; this is not arbitrary-precision arithmetic.
Histories are ordered, have unique source IDs,
asset hashes, acquisition IDs and acquisition instants, and share the target's
exact grid and product. Each history must be strictly older than target time
minus the frozen `history_cutoff_seconds`. Optional maximum age and gap policies
reject the entire case if violated; no silently filtered history or pair fallback.
An insufficient per-cell valid-history count yields unknown, even if a pair exists.

`apply` returns `Detection(receipt, scores, flags, valid)`: a finite serializable
JSON receipt separately from arrays. Unknown scores are NaN. Flags are signed
`−1 = signal_decrease`, `0 = no_alert`, `+1 = signal_increase`, `2 = unknown`.
Only `D < lower` or `D > upper` alerts; ties do not. These are signal flags,
**never open-water gain/loss classes**. A no-valid-support case has
`status = withheld_no_valid_support` and all-unknown flags.

## Small typed contract

The public dataclasses are `Grid`, `Product`, `Profile`, `Source`, `Frame`,
`Reference`, optional `Footprint`, `Case`, and `Spec`. They are frozen containers;
array contents are checked against hashes because frozen dataclasses do not make
NumPy arrays immutable. `array_sha256` from the existing evaluator includes dtype,
shape and C-order values. Caller-owned source arrays should not be mutated during
a call; there is no concurrent mutation lock.

* `Grid`: ID, asserted CRS, native shape, six GDAL affine coefficients, `metre`
  linear units and explicit area evidence. Nondegenerate affine cell area is
  nominal projected area, not geodesic or accuracy-adjusted area. A profile names
  a lattice; crops may differ in shape and have integer pixel offsets (alignment
  tolerance `1e-9` cells). A before/target pair or target/history must have the
  exact same shape and affine. Rotation is permitted when the affine is valid.
  CRS/metre assertions are not independently certified or analytically converted.
* `Product`: isolated `nisar_l_band` (`NISAR`, `L`, `HH`),
  `sentinel1_c_band` (`Sentinel-1`, `C`) or `synthetic` (`SYNTHETIC`, `NONE`)
  track; polarization, product type, `LINEAR_POWER` units, release, CRID,
  maturity, explicit known-issues list and geometry/track/frame/orbit definition.
  All these fields must match the profile. Unknown release/maturity/CRID/issues
  evidence is refused. An empty issues list asserts none known; it does not
  certify absence. Sentinel-1 results cannot establish NISAR accuracy.
* `Profile`: product, lattice, stratum fixed before fitting, producer-mask
  definition, target-stable reference definition, and optional footprint
  definition. Unmatched profiles are refused. Use separate fits for different
  strata and products.
* `Source`: ordered source ID, acquisition ID/time with timezone, asserted source
  asset SHA256, native power/mask hashes, product, producer-mask definition and
  metadata evidence. Crop hashes are recomputed. Source asset correctness,
  source metadata, product suitability and documented mask semantics require
  external verification. Supply the existing verified producer mask; no mandatory
  NESZ/RFI/layover/shadow masks or uncited physical thresholds are invented here.
  Pair acquisitions require distinct source asset hashes as well as different
  acquisition/source IDs. A single multi-acquisition asset is not supported by
  this contract; its distinct acquisition assets must be separately identified.
* `Reference`: labels `−1 = unknown`, `0 = not target-stable`, `1 = target-stable`;
  Boolean visibility; definition, reviewer/evidence, explicit independent review,
  independence from detector and temporal-match assertions, freeze time and both
  array hashes. Unknown visibility must be false. Review assertions alone are
  not certified truth. Optical SCL is not accepted as automatic reviewed truth.
* `Case`: IDs for case/event/site, stratum, target, **either** pair before or
  temporal histories, optional reference and footprint. Calibration needs the
  reference; application never reads final reference labels or scores accuracy.
* `Spec`: method/profile, policy freeze time, sorted finite bounded negative
  lower and positive upper candidates, separate tail budgets, task-specific
  minimum cells/independent units, and history count/cutoff/age/gap rules.
  `task_parameter_evidence` is required. Defaults are API conveniences, not
  universal scientific thresholds; callers must preregister their task choices.

The whole spec, reference definitions, array/mask hashes, all attempts and fitted
thresholds are sealed. Canonical JSON hashing uses sorted keys and rejects
nonfinite JSON values. Source/acquisition history order remains significant.
Freeze times are externally asserted chronology, not tamper-proof wall-clock
attestation. Acquisition identity is normalized to UTC when grouping split units.

## Fitting without pixel-pool dominance

Call `freeze(spec, calibration_cases, heldout=final_cases)`. Invalid global specs
raise `RadarError`. Case failures produce a serializable **withheld** receipt with
`thresholds = null`; every supplied calibration and held-out attempt remains,
including failed assertions and bottlenecks. No outlier crop is dropped.
Held-out registration checks metadata/hashes/history but calculates no final
scores and reads no final reference arrays. Empty held-out registration permits
exploratory work; it cannot subsequently admit a `stage="final"` case.

For each calibration crop, support is the intersection of valid signal,
visibility, known target-stable labels and any declared footprint. Reported
unknown/invisible/nonstable reference cells stay unscored and counted. Invalid
signal within visible target-stable reference is also counted separately. The
conditional denominator is the scored target-stable cells (or their constant
nominal affine area), not all cells and not a giant pooled pixel target.

For every declared lower candidate `l`, calculate `count(D < l) / n` per crop;
for every upper candidate `u`, calculate `count(D > u) / n`. Select the **largest
lower** and **smallest upper** whose respective rate satisfies its declared tail
budget on **every admitted crop**. Receipts retain each crop's denominator and
candidate rates, all candidate maximum rates and bottleneck case IDs, and selected
lower/upper/summed nuisance-alert fractions. Infeasible candidates, unsupported
profiles, unreviewed references, absent/minimum support or insufficient declared
independent units withhold the entire fit.

Target class stability does not imply constant mean radar power. The quantity is
named **target-stable nuisance-alert fraction**, not water gain/loss, stationarity
probability or a universal false-alarm guarantee. There are no p-values,
population confidence intervals or change-sensitivity measurements here.

Cases sharing event, site, source ID, asset hash, acquisition ID or acquisition
instant are joined into **transitive connected components**, including every
history acquisition. These groups determine independent-unit counts. Every
calibration case, including failed-reference cases, contributes parseable split
lineage. Any shared component with held-out final units withholds the fit.
Counts of held-out groups are exported separately. Independence beyond declared
lineage still requires external review.

## Explicit application and support comparison

Persist/pin `spec_sha256` before fitting decisions and the returned
`receipt_sha256` before final comparison. Keep these pins outside mutable policy
objects; hashing is reproducibility/integrity checking, not a digital signature.

```python
from service.benchmarks.radar import apply, freeze, support_comparison

# spec/profile/reference masks/candidates/splits/history policy already frozen.
policy = freeze(spec, calibration_cases, heldout=final_cases)
# Persist policy JSON and external pins. A withheld policy has no thresholds.
result = apply(policy, final_case,
               expected_receipt_sha256=externally_persisted_receipt_hash,
               stage="final")
```

`apply` recomputes the complete receipt hash and requires the external pin. It
validates source/array/mask/profile integrity and final-case registration; changed
lineage and leakage fail closed. JSON round-trips are supported. `calibration`
requires an admitted frozen calibration case; `exploratory` permits a new compatible
case and explicitly labels it exploratory. No stage means automatic activation.
The numerical-only `pair_scores` and `temporal_scores` helpers do not inspect
metadata or time; field callers must use the validated policy API.

Use `support_comparison([baseline_result, pair_result, temporal_result])` before
comparison. It requires the exact same target/grid/footprint, exports each
method's valid/unknown coverage and mask digest, and reports whether support is
identical and the intersection count/hash. If it differs, coverage is explicitly
disclosed; the helper does not pretend to have scored accuracy on the intersection.
Final sensitivity, E3 water classes, boundaries/objects/time metrics and field
usefulness remain coordinator/corpus integration work.

Without a supplied `Footprint`, `valid_window_fraction` describes the rectangular
native window. It cannot imply missing data inside a requested geographic AOI:
projected-window padding can lie outside its pixel-centre footprint. If available,
supply the externally established Boolean AOI mask, definition and hash, matching
`Profile.target_footprint_definition`. Receipts then export target-footprint,
outside-footprint and invalid-within-footprint counts and
`valid_target_footprint_fraction` (null for empty footprints). Outside-footprint
cells are unknown and excluded from reference scoring; no AOI is inferred.

## Bounds and verification

Limits are **computational**, not scientific requirements: 1,000,000 cells per
2D native array; at most 32 cases combined across calibration/final registration;
at most 12 histories; temporal scratch chunks at most 65,536 cells; at most 256
candidates per tail. Tails are evaluated separately, never via an unbounded lower
× upper product. No regional temporal stack is allocated internally. Caller-held
arrays and receipts consume additional memory. Pair work is linear in crop size;
temporal sorting is per chunk and calibration work scales with cells × candidate
count. This is not an O(1) memory claim.

Run from repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -B -m unittest service.tests.test_radar_detection -v
```

The tests cover equal/doubled/reversed powers, ratio extremes, subnormal/overflow
safe medians, unknowns/count reconciliation, strict ties, worst small-crop versus
giant-pool dominance, infeasible budgets, frozen mutation/pins, transitive and
history leakage, incompatible strata/products/releases/grids, unreviewed/unknown
references, causal cutoff/age/gaps/duplicates, insufficient history, input
immutability, final registration and explicit footprint denominators. They supply
no real field reference or change-sensitivity evidence.

Recorded local verification on 2026-10-12: **35 tests passed** in 0.079 seconds.
A separate maximum-size numerical-only check used a 1000×1000 target, 12 distinct
float64 histories (powers 1 through 12), target power 6.5 and one shared all-valid
Boolean mask. All 1,000,000 outputs were zero with no unknown/insufficient-history
cells. Kernel elapsed time was 0.249775 seconds; `tracemalloc` peak after inputs
were allocated was 26,267,035 bytes. Supplied arrays occupied 105,000,000 bytes.
macOS `/usr/bin/time -l` measured whole-process maximum RSS 164,446,208 bytes and
peak memory footprint 155,501,888 bytes. These are one local synthetic kernel run,
not deployment limits, a real-source end-to-end resource measurement or a model
benchmark. Separate masks, caller retention, fitting and receipt exports add cost.
