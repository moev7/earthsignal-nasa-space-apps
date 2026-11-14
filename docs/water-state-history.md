# Recorded water-state history

`service.observatory.water_history.summarize_water_history(observations)` is a
standalone descriptive API for **externally supplied recorded classifications**.
It supports the acquisition detection-frequency and interval-censored transition
part of [E4](research/scientific-excellence-2026-10-12/BENCHMARKS.md). It does not
classify radar amplitude, use gauges as water truth, interpolate observations,
or promote classifications to independently reviewed truth. Engine, manifest
validation and UI integration remain separate work. A separate [sampling-sensitivity method](water-sampling-sensitivity.md) now
compares explicit date filters and year weighting. Full E4 field and
representative sampling-sensitivity gates remain incomplete; there is no independent NISAR class-truth
claim from this implementation.

## Input contract

Pass a list or tuple containing zero to 2000 dictionaries, in strictly increasing
acquisition order. Each dictionary must have **exactly** these fields:

| Field | Required meaning |
| --- | --- |
| `siteId` | Caller-asserted identity of one site. |
| `supportId` | Caller-asserted identity/version of the common spatial footprint and valid support/mask on which every state applies. |
| `quantityId` | Caller-asserted identity of the water-presence quantity and class definition, including any decision threshold/aggregation definition. |
| `classificationMethodId` | Caller-asserted immutable method/version/policy identity; include relevant sensor/product maturity/CRID distinctions. |
| `sourceId` | Unique identifier of this recorded classification, not a reusable sensor/provider name. |
| `evidenceIds` | List/tuple of 1–32 distinct nonempty evidence identifiers linking the classification to its provenance. Evidence may be shared across records. |
| `acquisitionTime` | ISO timestamp with seconds, optional 1–6 fractional digits, and `Z` or a known `±HH:MM` offset. |
| `state` | Exactly `water`, `dry`, or `unknown`. |
| `visibility` | Exactly `observable` or `unobservable`, for the asserted common support. |
| `visibilityReason` | Recorded explanation of visibility, including cloud/mask/quality limitations where applicable. |

All text identifiers and the visibility reason must be trimmed, nonempty,
printable strings of at most 1024 characters. Unicode is supported; internal
control characters are rejected. The total normalized retained text is capped
at 1,048,576 Unicode code points, including repeated identities, evidence IDs,
timestamps, states and visibility. Admission checks this running total before
canonical JSON serialization. Oversized batches raise `ValueError`; records
are never silently dropped. This bounds escaped input text to at most 12 MiB
plus bounded JSON syntax, rather than relying on the record count alone.
Caller-owned input allocations and downstream consumers need their own resource
limits; this is not an OS memory cap. The four compatibility identities must match across
all records. No dates, identities, states or visibility are guessed. Naive/date-only
times, unknown offset `-00:00`, invalid offsets, UTC-unrepresentable timestamps,
duplicate UTC instants, duplicate source IDs, input permutations that break time
order, missing/extra fields and incompatible identities raise `ValueError`.
The API rejects rather than silently sorting or deduplicating records.

Known `water`/`dry` requires `observable`. `unknown` is allowed with either
visibility: an observable footprint can still have an ambiguous/abstained
classification. An unknown is never converted to dry or water. Only recorded
attempts belong in the input; absent acquisitions are not synthesized as records.

The caller must establish comparability before asserting these identities. String
equality does not verify geometry, support, timestamps, reference licences,
classification accuracy or sensor/product compatibility. A changed valid mask or
method must not be hidden behind the same ID; genuinely incompatible records
must be analyzed separately. This API provides no Sentinel-1-to-NISAR accuracy
transfer or automatic scientific approval.

## Output and interpretation

The output is a finite JSON-serializable dictionary, with:

- `methodVersion`: `recorded-water-history-v1`.
- `inputHash`: SHA-256 of the normalized observations' canonical JSON: UTC times,
  sorted evidence IDs, sorted object keys, compact separators and ASCII escapes.
  Equivalent timezone spellings, evidence-ID order and dictionary key order have
  the same hash. Source IDs, evidence, assertions, states and visibility rationale
  are hashed. Keep the method version alongside the hash to identify computation.
- `identity` and `observations`: the common asserted identity and a detached copy
  of every normalized record, retaining its provenance and unknown state.
  Observation evidence lists, endpoint intervals and transition substructures
  are independent copies; edits to one do not rewrite another.
- `counts`: `attempted`, `observable`, `water`, `dry`, `unknown`.
  `water + dry + unknown = attempted`; known states are a subset of observable.
- `waterFractionAmongObservableAcquisitions`: `water / observable`, or `null` if
  observable is zero. Observable unknown classifications **remain in this
  denominator**. Their count is `observable - water - dry`. A zero fraction with
  only observable unknowns means no positive water classifications, not known
  dry conditions. This is an unweighted acquisition detection fraction.
- `observedTimeSpan`: first/last supplied acquisition and their `elapsedSeconds`,
  or `null` for empty input. Elapsed seconds measure the record span, not water
  duration or continuous observation coverage.
- `acquisitionGaps`: elapsed seconds and endpoint source IDs/times for every
  consecutive pair of supplied records. No gap threshold or missing-acquisition
  count is inferred.
- `samplingSupport`: known-acquisition count; observable and known spans;
  leading/trailing unknown-acquisition counts relative to known endpoints; and
  flags for unknown observations, unequal spacing, or fewer than two known
  acquisitions. `sensitivityEvaluated` is always `false`: these flags describe
  support and do not certify sampling robustness or ecological trends.
- `knownEndpointIntervals`: every pair of consecutive **known** classifications,
  including all intervening unknown records with source/evidence/time/visibility.
- `intervalCensoredTransitions`: the opposite-state subset of those intervals,
  with direction, endpoint state/source/evidence/time, `leftOpen: true`, and
  `rightClosed: true`.
- `limitations`: the assumptions and unresolved interpretation limits.

Conditional on valid comparable classifications, opposite known endpoints imply
**at least one** transition somewhere in `(left acquisition, right acquisition]`.
The transition time and additional transitions remain unresolved, even with no
intervening unknown records. Each interval has `minimumTransitions: 1` for opposite
endpoints and `0` for equal endpoints, with `multipleTransitionsUnresolved: true`
and `continuityEstablished: false`. Equal water endpoints do not establish
continuous water; equal dry endpoints do not establish continuous dry conditions
or no changes. There are no intervals beyond the known endpoints.

An empty input has `identity: null`, null spans/fraction, zero counts and empty
intervals/gaps. A singleton has a zero-second record span and no intervals. An
all-unknown input retains every record, time and acquisition gap, but has no
known span/intervals. Leading/trailing unknown counts are null without a known
endpoint, rather than assigning overlapping leading/trailing runs. No output
estimates percent of wet days, duration, hydroperiod, cause, confidence or forecast.

## Example

```python
from service.observatory.water_history import summarize_water_history

common = dict(siteId='site-1', supportId='fixed-footprint-mask-v1',
              quantityId='open-water-presence-definition-v1',
              classificationMethodId='externally-recorded-method-v1')
rows = [
    dict(common, sourceId='classification-1', evidenceIds=['reference-1'],
         acquisitionTime='2026-01-01T00:00:00Z', state='water',
         visibility='observable', visibilityReason='Common footprint visible'),
    dict(common, sourceId='classification-2', evidenceIds=['reference-2'],
         acquisitionTime='2026-01-05T00:00:00Z', state='unknown',
         visibility='unobservable', visibilityReason='Cloud obscures common footprint'),
    dict(common, sourceId='classification-3', evidenceIds=['reference-3'],
         acquisitionTime='2026-01-21T00:00:00Z', state='dry',
         visibility='observable', visibilityReason='Common footprint visible'),
]
history = summarize_water_history(rows)
assert history['waterFractionAmongObservableAcquisitions'] == 0.5
assert history['intervalCensoredTransitions'][0]['direction'] == 'water-to-dry'
```

This says water was recorded on one of two observable acquisitions. The cloud
record remains unknown, and the transition is bounded by January 1 and 21. It
says nothing about the fraction of days wet within that interval.

## Offline runner

The optional runner accepts a UTF-8 JSON envelope with exactly `schemaVersion`
and `observations`; the version must be integer `1`. Pin the **exact input file
bytes** independently, then run from the repository root:

```sh
python -m service.benchmarks.water_history --input observations.json \
  --input-pin LOWERCASE_64_CHARACTER_SHA256 --output history.json
```

For a synthetic, explicitly non-evidence example, save the three-record example
above as `{"schemaVersion":1,"observations":[...]}`, calculate its raw-byte
SHA-256 with `sha256sum observations.json`, and supply that digest as
`--input-pin`. The runner reads at most 20 MiB plus one byte and verifies the
pin before JSON parsing or summarization. It rejects duplicate object keys,
nonfinite numbers, wrong envelope fields, and unsupported schema versions. The
input pin establishes byte identity only; it does not establish authenticity,
truth, compatibility, classification accuracy or provenance validity.

The new output path must not already exist. The private artifact includes the
raw `sourceFileSha256`, the full normalized summary, and an `artifactHash`
computed over the canonical artifact fields before `artifactHash` is added.
The summary's `inputHash` has a different meaning: it hashes normalized
observations (including normalized times and sorted evidence IDs), so it is not
the raw-file digest. Standard output reports only the artifact hash, method
version and counts. This offline tool does not fetch data, create a corpus,
estimate hydroperiod or field accuracy, or establish NISAR truth. Existing
scientific and sampling limitations above still apply.

The output file also has a 20 MiB limit. A valid classification input can yield
a larger summary; that run fails without publishing a partial result. The
summary is serialized before the output-size check, so these file limits do
not establish a peak-memory or execution-time bound. Service integration needs
its own resource validation before this offline runner can be exposed to jobs.

## Local verification

Run `python3 -m unittest service.tests.test_water_state_history -v` from the
repository root. Deterministic synthetic tests cover irregular cadence, missing
and cloudy gaps, unknown and equal endpoints, direct and multiple transition
intervals, empty/all-unknown/singleton support, ordering/uniqueness, timezone
normalization, compatibility assertions, invalid records, the 2000-record bound,
finite serialization, input immutability and canonical hash stability. These are
engineering checks, not a field validation or completed E4 sampling experiment.

## Corrected local verification receipt

On 2026-10-12, 16 water-history tests and 10 seasonal-sampling tests pass.
Three coordinator regressions failed before hardening: aggregate text reached
serialization, returned evidence/transition structures shared mutable references,
and embedded controls were accepted. The corrected API enforces the aggregate
budget before hashing, copies nested evidence/transition structures independently,
and rejects nonprintable text. The original writer is not counted as accepted
corrected implementation; independent acceptance is recorded in the build checkpoint.

A bounded local macOS/Python3.12 serialization probe used 900 synthetic alternating
classifications, 899 transition intervals and a repeated printable astral-Unicode
evidence identifier. Normalized text totaled892,690 code points; the JSON export
was49,749,427 bytes. Whole-process maximum RSS was134,086,656 bytes, peak memory
footprint110,412,928 bytes and elapsed time0.12seconds. This is one isolated
library/export probe, not the maximum admissible input, live service concurrency
or a deployment memory guarantee. No giant rejected input was allocated.
