# Recorded-water sampling sensitivity

`service.observatory.water_sampling.analyze_water_sampling(observations, *,
months=None, exclude=None)` compares acquisition counts for externally recorded
water classifications. This bounded E4 component is descriptive engineering,
with synthetic tutorials. It supplies no field accuracy, hazard, water duration,
hydroperiod, causal, trend, seasonal-baseline or sampling-robustness claim.
Compatibility and classifications remain caller assertions, not verified truth.

The input uses the exact [recorded-water history contract](water-state-history.md).
Validation is delegated to the unchanged `summarize_water_history`: 0–2000 records,
strictly increasing unique UTC instants and source IDs, matching identities,
exact fields, valid known offsets, retained unknowns and provenance, 1024-character
individual strings and 1,048,576-character aggregate text. Nothing sorts,
deduplicates, interpolates or resamples observations. The full original v1 summary
is returned unchanged in `history`, including its `sensitivityEvaluated:false`.
The enclosing sensitivity method has its own version and explicitly bounded meaning.

`months` is `None` for all twelve UTC months or a nonempty list/tuple of distinct
integers 1–12. Booleans and floats are rejected; the returned months are sorted.
`exclude` is `None` or exactly `{start, end}`, with explicit known-offset ISO
timestamps containing seconds (optional 1–6 fractional digits). Boundaries are
normalized to UTC, must satisfy `start < end`, and select `[start,end)`.
The block is explicitly supplied: no gap-derived block is invented.

`yearPopulation` contains every UTC calendar year from first to last original
acquisition, including years without records. More than 200 years is rejected.
The population stays fixed across filtering. Empty input has an empty population
and null fractions. A zero-observable or entirely missing year stays visible
and prevents an equal-year estimate; it is never silently dropped.

The three `views` are:

| View | Retained acquisitions |
| --- | --- |
| `all` | Every validated record. |
| `season` | Records whose UTC month is selected. |
| `withoutBlock` | Season records outside the explicit block; identical to `season` if no block is supplied. |

Each view includes `counts` (`attempted`, `observable`, `water`, `dry`, `unknown`),
`observableUnknown`, `selectedSourceIds` and `excludedSourceIds`. The source lists
partition **all original records**, preserving original order within each list.
`exclusion.matchedSourceIds` includes only records actually removed from the
season view; out-of-season block matches do not count as removed season records.

`yearSummaries` contains every fixed year, with `year`, `counts`, `waterFraction`,
`firstAcquisition`, `lastAcquisition` and `sourceIds`. First/last are normalized
UTC strings or null for a year with no retained records. They measure acquisition
support, not days wet. Source IDs retain order. All observations, visibility
reasons, evidence IDs and history intervals remain accessible through `history`.

`pooledWaterFraction` is retained water classifications / retained observable
acquisitions, or null with no observable acquisitions. Observable unknowns are
included in the denominator. A zero fraction with only observable unknowns says
no positive water classification; it does **not** establish dry conditions.
For example, 10 water + 10 dry + 90 observable unknowns gives **10/110**, not 10/20.

`equalYearWaterFraction` is the arithmetic mean of per-year water/observable
fractions **only if every fixed year has at least one observable acquisition**.
Otherwise it is null and `withheldYears` lists all zero-observable years.
Equal-year weighting answers a different descriptive question from pooling.
Neither is JRC occurrence or recurrence: JRC's official method uses its own
monthly normalization and definitions. These outputs must not be relabeled as
JRC metrics. In the producer's
[v2 user guide](https://storage.googleapis.com/global-surface-water/downloads_ancillary/DataUsersGuidev2.pdf),
occurrence averages monthly detection fractions; recurrence uses water years and
observation years within a defined water period and season. Neither definition is
this equal-calendar-year diagnostic.
No monthly weighting or temporal inference is implemented here.

The [2022 Sentinel-2 wetland study](https://scielo.org.za/scielo.php?script=sci_arttext&pid=S1816-79502022000100008)
describes cloud-dependent availability and classification omissions that affect
hydroperiod interpretation. Equal-year weighting cannot recover unobserved
conditions or remove interpretation error. These sources motivate visible dates,
unknowns and method distinctions; their published field performance is not
transferred to Earthsignal.

`differences.seasonVsAll` is season minus all, and
`differences.withoutBlockVsSeason` is without-block minus season. Each contains
`pooledWaterFractionDelta` and `equalYearWaterFractionDelta`, null if either
operand is unavailable. A block matching no records gives unchanged retained
fractions and zero defined deltas; this supplies no water or coverage evidence
for that block. Null is not coerced to zero.

The output has `methodVersion: 'water-sampling-sensitivity-v1'`,
`status: 'descriptive'`, the unchanged normalized-observation `inputHash`,
`options: {months, exclude, timeBasis:'UTC', interval:'[start,end)'}`, and
`optionsHash` of those normalized options using the existing `canonical_hash`.
The limitations array records the distinctions above. The function is pure and
does not mutate input lists, records, evidence or options.

## Offline reproduction

The CLI requires an exact UTF-8 JSON envelope with exactly these fields:

```json
{"schemaVersion":1,"observations":[],"options":{"months":null,"exclude":null}}
```

Use integer schema version 1. Both option keys are required in the file; null
means the native defaults. The reader rejects duplicate keys at any nesting,
nonfinite numeric constants/overflow, float or boolean integer fields, malformed
UTF-8, extra/missing fields and invalid observation/option schemas. It verifies
the lowercase SHA-256 of exact input bytes **before parsing**. Whitespace changes
therefore change the source-file pin even if normalized observations are equal.
The digest identifies bytes; it does not authenticate provenance or class truth.

From the repository root, with the existing science-test environment:

```sh
service/.venv/bin/python -B -m service.benchmarks.water_sampling \
  --input examples/water-sampling-demo/density-input.json \
  --input-pin INPUT_SHA256_FROM_METADATA \
  --output NEW_PRIVATE_RESULT_PATH.json
service/.venv/bin/python -B examples/water-sampling-demo/build.py
```

The [synthetic metadata](../examples/water-sampling-demo/metadata.json) pins each
exact input and result file and each canonical artifact hash. The builder's
default mode verifies all seven JSON files; `--output-dir NEW_DIRECTORY` writes
new files without replacing existing ones. The envelope intentionally has no
metadata field; synthetic identity/evidence labels are also present in every
record. The separate metadata explicitly declares all cases invented.

| Synthetic case | Main result |
| --- | --- |
| [density](../examples/water-sampling-demo/density-result.json) | 2024: one April water; 2025: twelve April dry. Pooled `1/13`, equal-year `0.5`. Block April 4–12 removes eight dry records, leaving pooled `1/5` and equal-year `0.5`. |
| [unknown](../examples/water-sampling-demo/unknown-result.json) | Observable unknown remains in denominator; unobservable unknown remains recorded. Initial pooled `1/3`, equal-year `0.25`. Removing 2024's season records withholds equal-year result for 2024; retained pooled is zero with one known dry. |
| [missing-year](../examples/water-sampling-demo/missing-year-result.json) | Water in 2024 and dry in 2026 retain missing 2025 in every view: pooled `0.5`, equal-year null, `withheldYears:[2025]`. |

The artifact wrapper is `{schemaVersion:1, kind:'water-sampling-sensitivity',
sourceFileSha256, summary, artifactHash}`. `artifactHash` is canonical hashing of
the wrapper **before adding its own hash**. The shared writer serializes to a
private mode-0600 temporary file, fsyncs, then atomically links a new destination;
existing files, directories and symlinks are never replaced. Input reads are
bounded to 20 MiB plus one byte; output is capped at 20 MiB before publishing.
Output serialization occurs before that cap check, so this is not a peak-memory,
runtime or live-concurrency guarantee. No network or runtime/service integration
is involved. The CLI inherits the existing benchmarks package's installed test
dependencies; a plain Python lacking NumPy cannot import that package.

## Verification

```sh
service/.venv/bin/python -B -m unittest \
  service.tests.test_water_sampling service.tests.test_water_sampling_cli \
  service.tests.test_water_state_history service.tests.test_water_history_cli -v
```

The scoped implementation run passed 41 tests, including 16 new numerical/CLI
tests and 25 existing history regressions. Coverage includes UTC/leap-day and
half-open boundaries, missing/zero-observable years, unknown denominators, original
order and partitions, hashes/immutability, invalid options, span/record/text/file
limits, pin-before-parse, private nonreplacement output, and all three pinned
fixtures reproduced byte-for-byte by two independent CLI processes each. These
checks establish deterministic synthetic behavior, not field usefulness,
classification accuracy or completion of E4/E1–E6.

## Guided explanation in the observatory

Open the historical water study in **Scientific explorer**, then **Water over time**
and **Why satellite observation dates matter — try an example**. The original gauge
history, CSV and retrospective forecast remain separate. The tutorial offers three
explicitly fictional examples, dated visit inspection, visible missing/unclear
records, a secondary weighting/date-exclusion comparison, exact source/result
downloads and method hashes. Its pinned native results are reproduced in tests;
the browser also reconciles displayed counts, filters, fixed years and arithmetic.
A damaged learning fixture withholds its claims while preserving the surrounding
scientific workspace. There are no uploads, AI requests or new processing routes.

This is preparation for E4 and comprehension testing, not a completed human study.
Real comparable classification histories, spatial-mask verification, representative
seasonal/gap experiments and independent field/usability evidence remain required.
