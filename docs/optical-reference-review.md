# Help check the water maps

This collaborator exercise makes human interpretation possible before anyone
claims that an environmental map is accurate. It is a guided walkthrough for
first-time collaborators, using the already frozen Lake Mead optical development
patch. Open **Help check a water-map study** in the scientific explorer, or visit
`/reference-review` after signing in. If you arrive anonymously, sign-in returns
you directly to this exercise; other sign-in journeys still open the observatory.
The relative redirect retains external HTTPS behind the origin proxy.

## What a reviewer does

Find the outlined 20 m square in the two dated images. On each date, record
whether the whole square can be judged, choose a label and give a short reason.
Mixed shorelines, dark surfaces, cloud and missing visibility are legitimate
uncertain outcomes. Record each date before moving on, then export a draft.
Importing an existing draft requires the exact exercise fingerprint. Replacing
recorded page answers requires an explicit replacement action; changed answers
and stale asynchronous imports are protected.

The target definition is deliberately explicit: `water` means visible open water
throughout the highlighted cell; `non_water` means visibly no open water there;
otherwise the label is `unknown`. This definition is **not automatically the SCL
classifier's target**. “No open water visible” establishes neither dry ground nor
danger. Reviewed uncertainty, unreviewed entries and visibility remain separate.

Notes and the reviewer alias remain in page memory until the user exports them.
There is no AI, upload, automatic browser storage or accuracy calculation.
Exports are snapshots of the latest answers, not an immutable edit history or
authenticated reviewer signatures. Browser download permissions are controlled
by the browser/OS; use a private folder and share files deliberately.

## Sampling and evidence

The existing pinned inputs contain 2499 native 20 m area cells. SCL provides a
**sampling frame**, not reference truth: 27 gain, 39 loss, 2153 water-at-both,
234 non-water-at-both and 46 unknown-at-an-endpoint cells. All five populations
are retained. The prototype samples eight cells without replacement in each
stratum, using seed `20261014`, then independently shuffles their presentation
and assigns opaque IDs. This yields 40 cells / 80 dated interpretation slots.
The allocation is an engineering prototype, not a powered sample-size claim.

The private audit records `N_h`, `n_h`, selection probability `n_h/N_h`, design
weight `N_h/n_h`, input hashes and exact sampled cells. Empty strata keep null
probabilities. It does not duplicate every population cell into Python objects.
The reviewer packet excludes class values, strata, allocation, weights and seed.
Selection probabilities do not change when a reviewer fails to respond;
nonresponse is a separate analysis problem, and original weights alone do not
resolve it. No error-adjusted area or accuracy is emitted by this tool.

The native 10 m RGB images retain the frozen reflectance scale 0–0.3. Each
outlined square is located through the two recorded native affine transforms;
display zoom does not become measurement input. A square extending beyond usable
RGB pixels can only receive an uncertain interpretation. Radar arrays are never
read or resampled. Optical acquisition times are retained exactly in provenance;
the visible dates use UTC. Their offsets from the original radar acquisitions
remain explicit.

The exercise is already-inspected **development evidence**. Hiding predictions
cannot prove that a person has not seen them elsewhere. Interpretations of these
same images are not independent field observations. A separate reference-response
protocol, reviewer qualification/disagreement process, untouched evaluation and
appropriate estimator are still needed before scientific promotion.

The rationale follows [Olofsson et al.'s primary good-practice recommendations](https://www.sciencedirect.com/science/article/pii/S0034425714000704)
for distinct sampling, reference-response and analysis designs. Official
[Copernicus SCL definitions](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/S2L2A.html)
and [Sentinel-2 processing](https://sentiwiki.copernicus.eu/web/s2-processing)
describe classifier/visibility context; they do not validate this patch.
Contains modified Copernicus Sentinel data 2026; the original source legal notice
and attribution in the frozen example remain applicable.

## Reproduce without new downloads

Use a verified native-GDAL runtime with NumPy and Pillow, from the repository root:

```sh
PYTHONPATH=. service/.venv/bin/python examples/optical-reference-development/build_review.py \
  --output /tmp/earthsignal-review-new --seed 20261014 --per-stratum 8
```

The directory must not exist. The builder checks the original receipt, metadata,
archives and array hashes before using them, then writes three files with mode
0600 in a new 0700 directory: `index.html`, `packet.json`, `sampling-audit.json`.
Give a reviewer only the HTML; keep the sampling audit separately until
interpretations are frozen. Serving the entire output directory exposes the audit
and defeats that separation. The production route serves the reviewer document
only after existing collaborator authentication, with no-store/Cookie-varying
responses and no public asset fallback. Review data is not submitted to the API.

To inspect an exported draft, independently retain the SHA-256 of the exact
`packet.json` bytes, then run:

```sh
PYTHONPATH=. service/.venv/bin/python examples/optical-reference-development/inspect_review.py \
  --packet /tmp/earthsignal-review-new/packet.json --packet-pin TRUSTED_PACKET_FILE_SHA256 \
  --review /private/path/review-draft.json --output /private/path/new-inspection.json
```

Both JSON inputs are limited to 1 MiB. Duplicate keys, nonfinite values, invalid
labels, foreign/missing/duplicate cells, inconsistent visibility, nonprintable
text, changed pins and existing output files are rejected. The private inspection
artifact preserves the review and completion/visibility counts; stdout omits
names and notes. Integrity hashes do not establish authorship or scientific truth.

## Verified development checks — 14 October 2026

Seventeen native tests passed, including actual EPSG/WKT/metre CRS parsing;
the local NumPy-only run explicitly skipped two CRS tests. Native generation
produced the unchanged 40-cell packet with zero human labels:
`f930622fad0ec390813e3786a8d5e8661ce2bbccbb593049a8de37ffae017876`.
The final 87288-byte HTML reproduces SHA-256
`0ac44045f02877895fe5a30b8ee40fb70aa0aadce5339253731eb0716bce6b0b`.
That generation took 0.773 s in a 160 MiB / quarter-CPU transient unit; its
reported cgroup peak was 49.1 MiB. The combined native test/generation run took
2.530 s and reached the 160 MiB cap. These bounded cases are not whole-region or
concurrent-load guarantees.

Independent Codex Sol reviews checked all 80 rectangle corner joins and found
import-race/text-validation issues. Root corrected generation/state guards,
Unicode printability and a replacement/export alias-state issue; actual-inline
JavaScript regression tests cover them. A genuine synthetic browser export
round-tripped through native inspection: 80 slots, two reviewed-unknown,
78 unreviewed, zero water/non-water labels. Wrong pins and output overwrites
failed; inspection output was 0600. This is software verification, not a human
pilot or an environmental reference result.

Desktop/mobile browser checks covered visibility/label gating, unrecorded edits,
navigation persistence, export and resume; 390 px overflow was zero. An isolated
real auth fixture served exact HTML after normal login and denied anonymous,
invalid and revoked sessions, with no public asset fallback. No production user
or account was created for that test. The E1–E6 scientific gates remain open.

## Compare separate reviews

Complete separate first-pass interpretations before reading a peer’s answers.
Open **Compare two saved reviews**, then choose two exports for this exact
exercise. Neither file replaces your editable draft. Original visibility, labels,
reasons and recording times remain side by side; **Look at square** links to the
same native image area. Record current edits before moving between squares.

The method `optical-review-comparison-v1` partitions every sampled date slot in
this order:

1. **Waiting for review** if either answer is unfinished.
2. **Someone could not see it** if either completed interpretation is unobservable.
3. **Unclear answer** if either remaining visibility or label is unknown.
4. **Different clear answers** when both known, observable labels differ.
5. **Same clear answer** when both known, observable labels match.

Two unknown labels never become agreement. A separate visibility-disagreement
flag requires two completed answers with different known visibility. It can
overlap a primary category and is not an extra observation. The table counts
all 80 dated slots; the clear-answer denominator includes only the final two
categories. Filtering and pagination change the displayed rows, not the counts.
These deliberately stratified sample counts are not population rates or areas.

Replacing a file immediately clears the old comparison. Invalid, incomplete,
foreign, duplicate-key, float-schema or malformed-UTF-8 drafts are rejected.
Loading and hashing use per-input generation checks so older completions cannot
restore stale results. Aliases use NFC then ASCII A–Z lowercase for collision
checks, not full Unicode case folding or authenticated identity. Different aliases
do not prove different people or independence.

All files remain local page memory, with no automatic storage, server upload or
AI request. Exports are private: they contain both reviewers’ aliases and notes.
Canonical review hashes and exact-file hashes have different purposes; neither
establishes authorship. The browser artifact is a descriptive browser envelope,
not the native comparison’s complete artifact/hash format.

For a reproducible offline native comparison:

```sh
PYTHONPATH=. service/.venv/bin/python examples/optical-reference-development/compare_review_drafts.py \
  --packet /private/path/packet.json --packet-pin TRUSTED_PACKET_FILE_SHA256 \
  --left /private/path/review-A.json --right /private/path/review-B.json \
  --output /private/path/new-comparison.json
```

Each input is bounded at 1 MiB; the pure engine additionally bounds combined
canonical inputs at 3 MiB, 320 sampled cells and its canonical artifact at 4 MiB.
The CLI caps the exact ASCII-escaped canonical output plus newline at 4 MiB
before atomic publication, writes mode0600, and never replaces an existing file,
directory or symlink. It retains the original records and full joint decision
counts without votes, resolved labels, kappa, percentages or accuracy estimates.
The native validator accepts its recorded timezone-aware times; the browser
accepts unchanged browser exports’ canonical millisecond UTC times. No schema
broadening or automatic timestamp conversion is performed during comparison.

A separate adjudication protocol, independent reference evidence, untouched
validation and sampling-aware estimators remain prerequisites for accuracy or
area claims. [Foody’s analysis of reference-data error](https://www.tandfonline.com/doi/full/10.1080/2150704X.2013.798708)
supports treating reference quality as a separate issue; agreement alone does
not remove reference error. The Olofsson recommendations above govern eventual
sampling and area-estimation design. These sources do not validate this exercise.

### Comparison release checks — 14 October 2026

The final 103840-byte reviewer document reproduces SHA-256
`27f25a174cf62cae3da8dd3fa75cc90e49fa83df72595a86299919aa5f0c0694`.
The packet fingerprint and original optical/radar studies remain unchanged.
Thirty-four focused native tests passed, plus189 web tests, TypeScript and build.
An actual browser comparison export agrees with native output for all80
synthetic-fixture date slots, raw answers, counts, flags and review hashes.
Independent Sol review found the Unicode serializer-size issue; root reproduced
and corrected it, and independent Luna verification confirmed the exact-byte gate.

Actual desktop/390px mobile checks retain own-draft edits, block unrecorded
navigation and clear stale comparisons on invalid replacement. An isolated normal
sign-in fixture returns to the rendered exercise and its account is subsequently
disabled/revoked. This does not constitute a production-user session test or
human comprehension study.

The final web archive SHA-256
`1c0934b70733f942097b7f4a842bdb68a1855162afda2897ee4ea16275375267`
activated at `releases/20261014T-review-comparison-r20b`, with an actual rollback
and return verified. Live HTTPS returns a relative303 sign-in address with
private/no-store and no exercise body; all128 retained artifact hashes still
match. API/worker/web are active, with384MiB/halfCPU science and192MiB web caps.
The new pure comparison is available as an offline repository tool; no scientific
worker activation, new accuracy result or data download is implied.
