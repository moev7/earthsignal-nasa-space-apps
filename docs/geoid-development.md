# Real-data readiness before a flood score

Earthsignal now has a small, pinned **real Sentinel-1 development case** with
explicit acquisition and interpretation gates. It advances the E2/E3 pipeline;
it does not satisfy those experiments' independent calibration or final-evaluation
gates. [Case, frozen plan, inputs and receipts →](../examples/geoid-development/README.md)

## What changed scientifically

The next model must earn a meaningful score: compatible acquisitions, usable
coverage, relevant reference classes, independent reference quality and untouched
units all matter. A downloadable flood dataset does not establish those conditions.
The first fixed case yields a useful negative readiness result: only 7,935 of
65,536 cells have common usable support, and all are provider-labeled background.
Permanent-water and flooded-water summaries are withheld. No alternate window
was searched. No flood detection accuracy, false-alert calibration, regional area,
forecast or NISAR transfer can be inferred.

The static retrospective provider label groups both dates; it does not describe
independently observed classes on each date. Per-date VV/VH dB summaries remain
descriptive, on exactly the same common
population and native grid. Relative orbit/incidence are unknown, so a temporal
difference/ratio is withheld. Native TIFF scales/offsets, masks, CRS, affine,
dtypes and label vocabulary are checked before arithmetic. No resampling or
synthetic fill creates analytical support.

## Source audit, 15 October 2026

The pinned catalog is 633,270 bytes, SHA-256
`c6ec7e3a3c252977069e9fa1613f07a0c01f7a121a0f55e9868f0645aad38022`,
and decodes to 13,248 rows. Catalog rows and paper tile counts are different
inventories; they are not silently equated. We use source identity and native
raster geometry rather than trusting the catalog field named `area_m2` as a
validated square-metre area. Validity/positive fractions are not selection inputs.

The 915-entry pinned tree exposes loose individual sample files. The selected
four total 19.7 MB, so TAR traversal and whole-shard downloads are unnecessary.
This is a checked exception to the earlier finding that the **default** sample
downloader exceeds our budget. The default still fetches roughly 2.9 GB.

The [pinned card](https://huggingface.co/datasets/links-ads/geoid-flood/blob/868407460bf3db492f50730a57585916baa71dc6/README.md)
and [pinned producer loader](https://github.com/links-ads/geoid-flood/blob/3a1647ed11aea0c81d5f59a8022e9cb8548bddab/src/geoid_flood/datasets/geoid.py)
assert linear sigma-zero for the released SAR imagery. Section 5.5 of the
[paper](https://arxiv.org/html/2608.02315v1) describes a gamma-zero pipeline for
**external-dataset harmonization**. That passage does not establish gamma-zero
for the released sample. The TIFFs provide no independent radiometric units.
This resolves the contexts of the earlier apparent discrepancy; it does not
independently certify radiometric calibration.

The sample explicitly includes EMSR712 AoI10 in train and AoI3 in test. Therefore
“no event straddles splits” is too strong. Future event-held-out evaluation must
construct and audit its own event/site grouping, including overlapping scenes;
it cannot assume a provider split already meets our declared independence unit.
This inspected train crop is permanently development material.

## Advice checked, not voted on

- [Kimi, Instant/High](https://www.kimi.ai/chat/1a13f825-e062-8d8a-8000-09e3a2751e4c):
  descriptive summaries first, fixed selection and clear limits. We rejected toy
  threshold scores without references, and withheld temporal differences without
  geometry evidence. Underlying model identity unknown.
- [Perplexity, Free/Search](https://www.perplexity.ai/search/new/de2c479a-d5a0-40ae-b0a9-1e583fe4e05d):
  separated released sigma-zero from external gamma-zero processing. We rejected
  its oversized acceptance download and event-split overstatement using the
  actual tree/card. Underlying model identity unknown.
- [DeepSeek, ordinary chat](https://chat.deepseek.com/a/chat/s/c52c424e-662d-482d-a9a1-a34d7cc105c0):
  identified TAR header/encoding/identity and partial-publication failures.
  Its categorical claim that all sparse traversal is unsound was not adopted.
  Direct files remove the TAR requirement for this milestone. Model unknown.
- [Claude, Free/Sonnet 5.5 Medium](https://claude.ai/chat/bd01ba55-59fa-4afd-a143-56e7263a1d7b):
  after the direct-file discovery, recommended dropping TAR/Range code, checking
  full-file hashes and native grids, recording missing classes and no inference
  from one window. Accepted. Multi-case bootstrap advice was not applicable.

These are bounded public-abstract consultations. Their claims were checked against
primary source content, file identities and native raster reads. No private
annotations, credentials or source repository were uploaded.

## Remaining scientific requirements

Obtain acquisition geometry and compatible histories; declare a target and task
before selecting additional development cases; gather independent time-matched
references and account for unobservable areas. Reserve untouched event/site
units before tuning. Only then compare calibrated methods and actual error/cost
tradeoffs. Human interpretation and the twelve-person comprehension study remain
unfinished. The complete E1–E6/four-domain objective remains active.

## Run and reproduce

The network operation is explicit and separate from analysis:

```sh
python -m service.benchmarks.geoid_sample fetch \
  --plan examples/geoid-development/selection-plan.json \
  --destination /path/to/new-private-directory
python -m service.benchmarks.geoid_sample analyze \
  --plan examples/geoid-development/selection-plan.json \
  --directory /path/to/new-private-directory \
  --output /path/to/new-private-result.json
python -m service.verify_geoid_development
```

The first command downloads only the four fixed individual files, validates
provider identities and publishes a private complete directory. Existing output
names, unsupported responses and mismatches are refused. There are no automatic
retries, whole-shard fallbacks or credentials. The 64 MiB application-body cap
excludes HTTP/TLS framing; redirect bodies are closed without being read.
Selection/catalogue payloads are separate bounded discovery reads. This round's
three full acquisitions consumed 59,062,761 asset bytes in total, including a
repeat after the final transport-header checks changed.

The second command works offline and requires the optional development reader
`rasterio==1.4.4`, supplied by the test requirements. It is not installed in or
added to the production service. The final command needs only NumPy and the
committed crop: it checks pinned files, every raw array hash, population counts,
class withholding and independently computed percentiles without native GDAL or
network access. It verifies exported crop identity, not full-file extraction
independently of the acquisition receipt.

Root's actual fresh acquisition took 6.36 s and reported 63.25 MiB maximum resident
set; offline full-file verification/native-window analysis took 0.27 s and 79.47 MiB
on the local macOS host. These are one-run local process observations, not server
load tests or service-capacity guarantees. All four repeated source file hashes
match the first acquisition. The unchanged native crop reproduces the negative
readiness result.

The final transport repeat took5.64s and66.19MiB maximum resident set; all four
files again matched. The reader guards socket/header/body deadlines and checks
the remaining budget after setup. Synchronous operating-system DNS resolution
can outlast a socket deadline: this offline research tool does **not** promise
a hard process wall-time limit. It must acquire external process supervision
before becoming a live queue adapter. Linux exclusive directory publication
is checked separately in CI; local execution exercises macOS publication.
