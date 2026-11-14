# Experimental frozen daily-discharge policy

`service.observatory.forecast_policy` adds standalone `freeze_policy`,
`issue_policy`, and `score_issue` functions. This advances the availability-aware
policy portion of [E5](research/scientific-excellence-2026-10-12/BENCHMARKS.md).
**E5 remains incomplete.** Synthetic contract tests establish neither real
forecast skill nor scientist usefulness. This module changes no existing engine,
evaluator, archived assessment, manifest, UI or deployment.

```python
from service.observatory.forecast_policy import freeze_policy, issue_policy, score_issue

policy = freeze_policy(freeze_snapshot,
    expected_snapshot_hash=trusted_freeze_snapshot_pin, freeze_time=freeze_instant)
issued = issue_policy(policy, issue_snapshot,
    expected_policy_hash=trusted_policy_pin,
    expected_snapshot_hash=trusted_issue_snapshot_pin, issue_time=issue_instant)
score = score_issue(policy, issued, later_outcome_snapshot,
    expected_policy_hash=trusted_policy_pin, expected_issue_hash=trusted_issue_pin,
    expected_snapshot_hash=trusted_outcome_snapshot_pin, score_time=score_instant)
```

Each input snapshot uses the strict [local-receipt vintage](gauge-vintages.md)
schema. Its canonical issue instant must equal the corresponding phase instant.
Each external pin is mandatory and must come from independent trusted capture or
storage. Do not obtain a supposedly trusted pin by reading or rehashing untrusted
input. Internal self-hashes establish integrity, not authentic timestamps,
historical station configuration or upstream availability completeness. The
supplied freeze/issue times are analytic cutoffs; they do not prove that an
artifact or policy existed then. Offline replay of an old snapshot does not
establish preregistration or real issued availability. E5 needs independent
recorded policy and issuance custody before evaluation. The functions perform no
database or network access; station timing uses the existing
local pinned registry. Returned nested data are detached from inputs and other
calls. Invalid structural inputs raise `ValueError("Invalid forecast policy input")`
without forwarding input values, paths or primitive diagnostics.

The method is `daily-discharge-policy-v1`. Constants, approved literals, the
archived numerical kernel, predictor version, station rule and gates are fixed
in code and exported in the policy; callers cannot tune them. Only USGS parameter
`00060`, statistic `00003`, unit `ft^3/s`, with the exact same station and series,
are supported. The only accepted quality strings are **literal `Approved` or
`approved`**, with **no qualifiers**. `Provisional`, `provisional`, `APPROVED`,
unknown strings and qualifier-bearing records are unsupported. This whitelist is
a conservative experimental decision, not a complete provider-quality ontology.
The same decision applies to development observations, required predictors and
outcomes. Each such record must also have `receivedAt` at or after its actual
station-day interval end (`completed-at-receipt-v1`). An intraday daily mean never
becomes accepted solely because the clock advances: `incomplete_when_received`
remains explicit until an eligible later revision is received. The existing
ledger does not refresh `receivedAt` for identical content: an unchanged recapture
of a formerly partial value remains conservatively withheld. This API does not
add separate completion-attestation receipts. No interpolation, imputation or clipping occurs.

## Freeze

Freeze requires 1460–2000 completed, consecutive, supported daily records. Missing
or null days inside that run cannot disappear into a training array. Incomplete
records and unknown calendar days outside the completed run remain explicit in
`forecastInformation` counts and the source snapshot. Mixed retained station
metadata, insufficient history, unsupported quality, discontinuity or numerical
range produce a hashed `status="withheld"` artifact with a stable reason and no
fitted development receipt.

For supported history, freeze alone invokes the unchanged archived
`forecast_v3` kernel (`076fb17`, selection version
`gauge-selection-calibration-holdout-v3`). Its chronological warmup, selection,
calibration and final-year origin schedules are retained in `selectionReceipt`,
`selectionHash` and `sourceInputHash`. For each horizon 1, 3 and 7, the policy
records the selected model, candidate radius, **separate persistence and seasonal
naive radii from the same calibration origins**, MAE, baseline MAE, empirical
coverage, negative prediction and nonzero-error counts, and development gates.

All final-year metrics and release decisions are **POLICY-DEVELOPMENT**. They are
not untouched, prospective or as-received historical policy scores. The fixed
candidate gates require at least 10% MAE improvement over the stronger baseline,
at least 80% empirical coverage, no negative development predictions, and no
zero band with nonzero errors. Nominal band coverage is 0.9; the boundary tolerance
is `1e-10` and improvement tolerance `1e-12`. Dependence prevents a coverage
guarantee. Timing/staleness decisions in the old evaluator's forecast output are
ignored during freeze; they cannot poison selection just because freeze occurs
long after the training dates. Issue applies its own timing rules.

The policy embeds its full bounded source snapshot and compact regenerated
`forecastInformation` report. Validation checks exact schemas, types, canonical
hashes, identity, constants, counts, folds/selection receipt and gate equations.
It does not rerun development fitting. A trusted policy pin attests to the stored
development artifact; validation alone cannot prove that someone supplied truthful
statistics. Runtime replay assumes the archived kernel, pinned registry and
numerical environment remain available.

## Issue

Issue must occur strictly after freeze. It requires exact identity and stored
station-time properties, with the same rule/registry join. A revision received
before issue may legitimately change the predictors. It never changes the frozen
model or radii. All three methods share the **same issue snapshot, information
hash, completed observation anchor and target interval**.

Issue exports exactly nine attempts: candidate, persistence and seasonal naive
at each horizon 1, 3 and 7. Targets are the latest actual completed nonnull
observation date plus that calendar horizon. They never auto-advance. Whole
target start must be strictly after issue, and observation lag must be 0–48 hours.
A target beginning exactly at issue is withheld. In this completed-daily-day
convention, horizon 1 necessarily begins at or before issue and is withheld; it is
retained in the denominator. DST targets retain their actual 23/25-hour intervals.
Unresolved timing, the 2026 review ceiling and expired/stale targets are explicit.

Required support is method-specific: persistence uses the latest observation;
seasonal naive uses the exact target date minus **365 calendar days** in this same
snapshot; local/damped trend uses the exact last 28 consecutive calendar days.
Missing support, unsupported required quality, invalid/overflowing predictions,
negative points or negative lower bands withhold that method. Baselines still
attempt publication if the candidate development gate failed. Each published
band uses its method's frozen residual radius. Withheld distributions are null.
No evaluator or calibration function is called by issue or score.
For local/damped trend, the frozen algorithm recomputes its rolling slope and
intercept from those 28 available observations. The family, window, damping,
residual radii and gates remain fixed; the rolling coefficients are not frozen.
This is a declared past-only update, distinct from reselecting the model or
recalibrating its uncertainty against later outcomes.

Each attempt includes its method/model/horizon, status, stable reasons,
distribution or null, complete timing (cutoff, target, lag and effective leads),
required input version hashes, radius and `predictorHash`. Top-level fields include
`policyHash`, `freezeTime`, `issueTime`, `snapshotHash`, embedded `sourceSnapshot`,
`forecastInformation`, identity, counts and limitations. The `issueHash` seals all
fields other than itself. Publication rate is published attempts divided by nine,
not divided by those with eventual outcomes. `countScope` labels this as
`all-method-horizon-attempts`, rather than candidate-policy skill. `methodCounts`
also records attempted (always 3), published, withheld and publication rate for
each method, so baseline publication cannot conceal candidate abstention. Under
this timing convention each method can publish at most 2/3 of its attempts.

## Score

Score is a new artifact; it never modifies or reissues the issued artifact. It
requires a later score instant and an independently pinned later outcome snapshot
for the exact series/properties. It checks the issued pin, then **regenerates the
nine original attempts from the embedded issue snapshot** and compares every
field and JSON type. This detects inconsistent rehashed internal targets,
counts, distributions, gates and predictor hashes without fitting.

A target must be complete at score. Its outcome must be an actual nonnull,
resolved, quality-supported record received strictly after issue. Missing,
withdrawn, unresolved, incomplete, quality-unsupported or prematurely received
outcomes have explicit reasons and no score. Every original attempt is retained,
including withheld attempts. Outcome availability and publication status are
separate: outcome availability cannot change the original publication denominator.

Only originally published attempts with usable outcomes receive `absoluteError`
(the per-case MAE component), `signedBias` (prediction minus observed), `bandHit`,
`bandWidth` and 90% `winkler`. Winkler is width plus 20 times the distance outside
the band. Overflow is an explicit non-scoreable reason. Candidate/baseline
comparisons report only matched, same-target scored cases and error/Winkler
differences; unmatched pairs have zero matched cases and null differences.
No significance, independent-target assumption or E5 verdict is produced.
Counts retain all nine attempts, original published/withheld counts and publication
rate, available outcome attempts, scoreable published and unscoreable published.
The same equations and outcome/score counters are also exported separately in
`methodCounts` for candidate, persistence and seasonal naive; missing truth cannot
alter any method's original denominator of three.
A later revised truth produces a different outcome pin and `scoreHash`; the old
policy and issued artifact remain byte-identical.

## Bounds, privacy and outstanding evidence

Snapshots retain the existing 2000-calendar-day, 8192-byte-record and
`2000 * 8192 + 8192`-byte snapshot ceilings. Policy/issue artifacts allow that
snapshot ceiling plus 64 KiB for metadata; defensive pre-hash traversal limits
nesting to 12, dictionaries to 40 entries, lists to 2000 entries, strings to 1024
characters and total traversed values to 160000. Traversal also enforces the
aggregate exact canonical serialized-byte budget before hashing or copying,
including escaping, keys, punctuation and numeric encoding. Strict phase schemas narrow
these further, reject unknown keys and reject booleans masquerading as numbers.
Every raw external snapshot and each of its records undergo this byte admission
before shared vintage validation can hash them; eventual rejection after hashing
is insufficient. The offline parser also rejects exponent overflow such as
`1e400`, including inside nested objects and lists.
Policy and issue embed a station snapshot with private receipt/source lineage.
Score retains the outcome information hash and per-attempt outcome version hash;
keep the separately pinned outcome snapshot to reproduce a score. Do not publish
these artifacts without appropriate destination-specific authority.

Run the synthetic checks with the existing environment:

```sh
PYTHONDONTWRITEBYTECODE=1 service/.venv/bin/python -m unittest \
  service.tests.test_forecast_policy service.tests.test_forecast_information \
  service.tests.test_forecast_archives
```

Remaining E5 work includes independently accepted real replay/prospective evidence,
a genuinely untouched policy-evaluation period, the current-engine comparison,
preregistered station-task utility/error acceptance, publication-conditioned skill
across enough cases, high-flow/peak checks where support permits, and handling
correlated targets. The fixed gates are development decisions, not measured
operational usefulness. This additive API supplies no issue scheduler, persistence
service, authentication, UI integration or production activation.

## Offline runner

Use `service/.venv/bin/python -m service.benchmarks.forecast_policy --help`.
Supply direct snapshot JSON objects and independently trusted pins from capture
or accepted storage. The example variables below represent those known pins and
the exact snapshot cutoff instants; the runner never manufactures trust by
reading a hash out of an untrusted file.

```sh
service/.venv/bin/python -m service.benchmarks.forecast_policy freeze \
  --snapshot freeze-snapshot.json --snapshot-pin "$FORECAST_FREEZE_PIN" \
  --at "$FORECAST_FREEZE_AT" --output policy.json
service/.venv/bin/python -m service.benchmarks.forecast_policy issue \
  --policy policy.json --policy-pin "$FORECAST_POLICY_PIN" \
  --snapshot issue-snapshot.json --snapshot-pin "$FORECAST_ISSUE_SNAPSHOT_PIN" \
  --at "$FORECAST_ISSUE_AT" --output issued.json
service/.venv/bin/python -m service.benchmarks.forecast_policy score \
  --policy policy.json --policy-pin "$FORECAST_POLICY_PIN" \
  --issued issued.json --issue-pin "$FORECAST_ISSUED_PIN" \
  --snapshot outcome-snapshot.json --snapshot-pin "$FORECAST_OUTCOME_PIN" \
  --at "$FORECAST_SCORE_AT" --output score.json
```

Each JSON file is limited to 20 MiB; duplicate keys, nonfinite literals and
non-object roots are rejected. Output uses a complete new file with mode0600,
published atomically without replacing existing files or symlinks. Its parent
directory must already exist. Standard output contains only the stage and artifact
hash; the result file contains private lineage. Exit2 means invalid/inaccessible
input, unsupported policy or an unavailable output path. A valid scientific
abstention is a successful artifact with explicit withheld reasons. The runner
does not fetch data, schedule issues, activate the service or establish policy
custody. The preserved three-row USGS receipt correctly withholds fitting when
replayed later; it is no prospective prediction or skill evidence.

One macOS/Python service-environment run of the three test modules above passed
43 tests in 139.593 seconds (139.78 seconds wall time). `/usr/bin/time -l` measured
maximum RSS 161841152 bytes and peak memory footprint 123946944 bytes. This is the
entire sequential synthetic test suite, including temporary ledgers and a
2000-record fixture, not a per-issue latency, maximum payload, production or
concurrency guarantee. Archive replay checks were included.

## Separate provisional-input point experiment

`service.observatory.provisional_issue` consumes the same approved-only frozen
development policy through a separate, explicitly experimental computation path.
Predictors may carry literal `Approved`, `approved`, `Provisional` or
`provisional` status, but must have empty qualifiers and be completed at receipt
and at issue. Their original approval strings, values and version hashes remain
in the output. Estimated or otherwise qualified values are not silently dropped,
reclassified, or fitted as approved observations. Development still requires the
unchanged strict approved-only policy; a withheld policy cannot produce points.

This experiment produces points only. It does not inherit the development
policy's residual bands, nominal coverage or uncertainty guarantees. Prediction
uncertainty and uncertainty from later source revisions are both unquantified.
Candidate development gates, whole-future station-day timing, method-specific
support, nonnegative finite predictions and the 48-hour staleness limit still
apply. All nine method/horizon attempts remain in the artifact, including
withheld attempts; the three methods share three target days rather than nine
independent observations. Horizon one remains withheld under the existing
completed-day convention.

Use the separate offline runner with accepted input pins and exact cutoff
instants. These variables are placeholders for independently recorded inputs,
not values that the runner discovers from the files:

```sh
service/.venv/bin/python -m service.benchmarks.provisional_issue compute \
  --policy policy.json --policy-pin "$FORECAST_POLICY_PIN" \
  --snapshot issue-snapshot.json --snapshot-pin "$FORECAST_ISSUE_SNAPSHOT_PIN" \
  --at "$FORECAST_ISSUE_AT" --output point-experiment.json
service/.venv/bin/python -m service.benchmarks.provisional_issue score \
  --policy policy.json --policy-pin "$FORECAST_POLICY_PIN" \
  --experiment point-experiment.json --experiment-pin "$FORECAST_EXPERIMENT_PIN" \
  --snapshot outcome-snapshot.json --snapshot-pin "$FORECAST_OUTCOME_PIN" \
  --at "$FORECAST_SCORE_AT" --output point-score.json
```

The runner shares the frozen-policy runner's bounded strict JSON reader and
atomic mode0600, no-overwrite output writer. It requires a separate trusted
experiment pin for scoring. Later truth must be completed, approved and
unqualified, separately received after issue; revising it creates a new score
without changing the original experiment. Missing or unsupported truth remains
explicit. Computation and scoring do not select models, calibrate intervals,
fetch data or publish results to the app. Every artifact retains
`operationalPublication: false` and the offline experimental label. These checks
establish a reproducible engineering path, not measured forecast skill, genuine
prospective custody, an E5 pass or scientist usefulness.
