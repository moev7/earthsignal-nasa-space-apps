# Challenge resources and native SAR processing

Earthsignal keeps its main story, optional game and Explore focused on Tehran
subsidence and Tokyo's historical response. [Radar processor](https://nasa.r8volt.com/workspace?view=sar)
in Advanced tools provides broader source discovery, bounded native processing,
private study history and independently checked public observations.

The [official challenge Resources panel](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/?tab=resources)
was inspected on 13 November 2026: nine NASA resources and five partner resources.
The exact original links are preserved in
[official-resources.json](../public/data/challenge/official-resources.json).
A listing establishes a resource's role, not successful processing or rights.

## What each resource contributes

| Official resource | Concrete application in Earthsignal |
| --- | --- |
| NASA Earthdata Search | Exact collection/acquisition provenance for NISAR; original files are resolved on the server. |
| ASF Data Search Vertex | Native product discovery, exact IDs, acquisition chronology and source collection maturity. |
| NISAR Data User Guide | Version-specific masks, radiometry, valid acquisition modes and product-specific units. |
| Intro to Remote Sensing | The main story distinguishes observations, interpretation and schematic mechanisms. |
| Intro to Synthetic Aperture Radar | The spacecraft/radar demonstrations explain repeat observations; synthetic demonstrations remain labelled. |
| NASA ARSET Trainings | Calibration, common-valid support and interpretation boundaries inform the scientific methods and explanations. |
| NISAR StoryMaps | Phenomenon-led explanations connect water, land and measured change without treating an illustration as data. |
| NISAR Applications White Papers | The Tehran groundwater question and broader investigation boundaries; no causal attribution from backscatter alone. |
| UAVSAR Postcards | Original GRD/annotation discovery and a numeric diagonal-polarization reader; a postcard is never a scientific raster. |
| RCM Data | Public CEOS ARD catalog/metadata adapter, gamma0 and quality-mask reader, and independently verified Manitoba example. |
| CSA Python Tutorial | Source-linked reproducible radar interpretation reference; separate code/data rights and numeric conventions remain authoritative. |
| RADARSAT-1 Data | Historical catalog adapter, original complex TIFF magnitude reader and independently verified Arctic sample window. |
| SAOCOM Catalogue | Explicit source/access entry; no generic TIFF calibration or unsupported numerical execution. |
| SAOCOM Registration | Free access/redistribution review gate; no paid license, new account or agreement is created automatically. |

The machine-readable [readiness snapshot](../public/data/challenge/source-readiness.json)
is exposed by `/api/sar-sources` and `/api/challenge-resources`, and readable in
the workspace. `null` means unverified. Product support, runtime access, successful
original-source verification and permission to publish are separate facts.

## Scientific quantities and actual checks

| Source/product | Implemented computation | Original-source evidence / limit |
| --- | --- | --- |
| NISAR GCOV | Frequency A HH gamma0 dB; same-grid compatible before/after difference | Existing Lake Mead comparison plus a validated 28 October 2026 Tehran crop: all 2,475 values/mask decisions matched an independent GDAL netCDF read. Schema 1.5/1.6 masks stay distinct. |
| NISAR GUNW | Quality-screened, ionosphere-corrected, median-referenced single-pair relative LOS in mm | Schema 1.5 only. New single-pair publication requires independent phase-sign validation. The existing provisional Tehran multi-pair study remains unchanged. |
| NISAR GSLC | Schema 1.6 complex64 beta0 observation; original complex crop bytes retained | Fixtures pass. The actual validated Tehran product lacks the producer-defined `isReceiveOnly` attribute, so calibrated execution is withheld. GSLC pair processing is withheld. |
| NISAR GOFF | Schema 1.6 slant-range/along-track component offsets in metres, layer 1–3; variance/SNR/correlation/focus screening | Fixtures pass. The actual August–November source pilot uses an unsupported schema and rejects before science reads. Offsets are not LOS, vertical motion or a rate. |
| RADARSAT-1 | Original complex source magnitude, explicit native pixel window | All 16,384 source magnitudes reproduced exactly with independent tifffile/imagecodecs decoding. GCPs are not an affine map; geocoding and calibrated backscatter are withheld. |
| RCM CEOS ARD | Original RR/RL or source-declared channel gamma0 power converted with 10 log10; original validity mask | All 2,072 RR samples and mask decisions reproduced exactly. The checked example has one acquisition; it does not establish temporal change. |
| UAVSAR | Annotation-led HH/HV/VV diagonal GRD power, little-endian float32, native degree grid | Numeric fixtures pass. The selected ASF annotation was not retrieved with the existing processing-host grant; original-source processing is not claimed. |
| SAOCOM | Source entry and explicit access/product gate | The advertised catalogue products query returned HTTP 403 without authorization. Exact free grant, publication rights and a verified level-specific native product reader remain prerequisites. |

Validated NISAR availability does not reclassify older provisional acquisitions.
The checked Tehran time window did not produce a compatible validated two-date
pair. No replacement data, cross-sensor subtraction, analytical resampling or
whole-granule fallback is used to fill a gap.

## API and lifecycle

The public routes `/api/challenge-resources`, `/api/sar-sources`,
`/api/public-studies` and `/api/public-studies/:id?revision=…` return source roles,
readiness and reviewed evidence descriptors. Public study pages live at
`/studies/:id?revision=…`; manifests and native values are pinned by SHA-256.

Collaborator-only routes share the existing HMAC gateway, owner-scoped SQLite
queue, one bounded worker, admission limits, cancellation and expiry:

| Route | Action |
| --- | --- |
| `POST /api/sar-studies/search` | Bounded source/product/date/AOI discovery, at most 24 records. |
| `POST /api/sar-studies/plan` | Explicit metadata, access and runtime checks; no automatic submission. |
| `POST /api/sar-studies` | Submit with one idempotency key. Exact source IDs, operation, polarization and AOI are required. |
| `GET /api/sar-studies` / `GET /api/sar-studies/:id` | Owner history and explicit status refresh. |
| `POST /api/sar-studies/:id/cancel` | Cancel queued/running work. |
| `GET /api/sar-studies/:id/artifacts/:file` | Owner-only allowlisted manifest, values, preview and provenance. |

Requests use `schemaVersion: "1.0"`, `sourceId`, `recordIds`, `bbox`, `channel`
and `operation`: `backscatter-observation`, `backscatter-change`,
`los-displacement`, `pixel-offset` or `native-observation`. GOFF may specify
`component` (`slant-range` or `along-track`) and `layer` (1–3). RADARSAT-1 native
inspection requires `pixelWindow: [x, y, width, height]`; its AOI is discovery
context, not invented geographic registration.

There is no background polling or publication from a job. Authentication expiry
clears private plans/results. Source or request changes invalidate the plan and
submission key. Values and previews are hash-checked before inspection; zero is
preserved and missing samples remain null/transparent.

## Operator publication and rights

`python -m service.sar_publication` accepts an explicitly selected public-location
candidate, matching independent source-value review, current registry hash and
source rights approval. It recomputes arrays, masks, statistics and artifacts,
then atomically publishes an immutable hash-qualified revision and registry
pointer. Prior revisions remain available. An unverified private job cannot
publish itself. Receipts are auditable operator records, not signatures proving
reviewer identity.

RADARSAT-1 uses the archive's [Open Government Licence](https://registry.opendata.aws/radarsat-1/).
The identified RCM Public User License is royalty-free and approved for this
integration; before imagery reads its original PDF must match SHA-256
`a7486d315775c7009b1dd529f3f31ea52a9d158297cf4d400c6dcdbdf3ee79b1`.
Required Government of Canada/CSA credits accompany public output. Changed terms
reject. Paid licenses, data purchases and new access grants are outside this work.

New GUNW crop caches bind source URL, collection, AOI, reference height and reader
identity and verify content digests. Legacy granule-only crops require explicit
historical-cache inspection; they cannot silently satisfy new geometry requests.
Historical time-series interpolation/bridging is not promoted to new observed
support, and the frozen public Tehran bundle is not rewritten.

See [native reader boundaries](../service/sar/README.md),
[deployment](deployment.md) and [the recovered T3 implementation plan](internal/challenge-data-integration-plan.md).

## Harmony evaluation

The actual GCOV capability response advertises `nasa/harmony-gdal-adapter` and
`asf/nisar-py`, bounding-box/variable subsetting, HH power and the subswath mask.
It does not advertise the schema 1.6 `inputDataExceptionMask` variable required
by this method. No numerical equivalence benchmark or Harmony processing job was
claimed; the checked bounded-range path remains the production method. A future
subset path must preserve that exception/focus mask, ancillary metadata and the
exact native sample window before adoption.
