# Earthsignal: challenge-first data processing and representation

Planning snapshot: 13 November 2026. Repository inspected at `bb253ed1ee097b5a4316e2e1e5e3f51d2712c17e`. This document proposes implementation; no source data, application behavior, accounts or deployment were changed by this planning task.

Implementation record: [delivered source methods, original-value verification and remaining access/schema gates](../challenge-processing.md). The planning snapshot below is preserved as the recovered T3 scope, rather than a claim that every archive is enabled.

## Goal and definition of completion

The user's data-processing scope is **all newly available challenge data sources/resources that can actually be used**, with the app adapted to the challenge. The main landing page and app have a narrower editorial focus: **visual, animated and gamified exploration of land subsidence in Tehran, compared with Tokyo's historical experience**. Broader scientific applications, source selection and processing belong in **Advanced tools**. Build an expandable, source-aware SAR processor and evidence representation system beneath both: source bytes → documented processing → checked scientific results → understandable interactive findings. Analysts discover and process data through our own API. New results become public only through a checked publication step.

### Product boundaries: core experience and Advanced tools

* **Landing page, main story and optional game:** Tehran's ground motion, the groundwater mechanism, uneven settlement, how SAR detects it, and what Tokyo's historical response helps us understand. Prioritize approachable 3D, animation, sound, tactile exploration and Echo's contextual guidance. Scientific detail remains available through progressive disclosure. Keep the game optional.
* **Tokyo comparison:** retain its actual historical records, dates, sources and policy context. Do not imply Tokyo has the same contemporary NISAR coverage or comparable measured rates unless that evidence has actually been processed and verified. Historical outcomes and illustrative intervention scenarios remain distinct.
* **Main Explore experience:** make Tehran's measured maps, profiles, time views and 3D neighbourhood an accessible continuation of the core story; preserve the Tokyo comparison as an obvious next step. Do not replace the landing or main navigation with a generic global multi-sensor dashboard.
* **Advanced tools:** host the global/multi-source catalog, Lake Mead and other scientific studies, polarization/product controls, AOI processing, calibration/quality inspection, analysis, exports and broader challenge-resource coverage. New data families must have real scientific functionality here, not merely documentation links.
* **Shared evidence and design:** both surfaces use the same verified study IDs, revisions, numerical contracts and source provenance. Offer contextual “Inspect the evidence in Advanced tools” links that preserve the relevant study/selection, plus a clear return to the main story. Bring a new resource into the main story only when it directly improves the Tehran/Tokyo explanation; broad source coverage alone is not an editorial reason to add another chapter or widget.

The earlier “global change atlas” recommendation is therefore scoped to Advanced tools. Comprehensive backend capability and a focused public narrative are simultaneous acceptance requirements.

Every listed resource needs a coverage entry and a concrete application. Data resources require a real adapter and processed science example wherever lawful access and usable observations permit; guides/tutorials must trace to implemented methods, checks or explanations. Metadata discovery, a thumbnail or an external link does not count as processing. RCM, RADARSAT-1, SAOCOM and linked UAVSAR science are part of the delivery scope. An inaccessible product gets an evidenced access/format/resource gate and a remaining task, rather than silently disappearing from the plan.

The current resource inventory is the [organizer's 14-resource mirror](https://hackathlone.com/challenges/dancing-with-the-sars). The [official challenge page](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/) returned HTTP 502 during this audit; reconcile the inventory and requirements against it when reachable. The brief centers NISAR surface-change analysis and accessible interactive communication; it does not itself require using every partner archive. Comprehensive feasible coverage is the user's additional product objective. “New resources” means newly listed challenge resources, not that historical partner acquisitions were collected today.

```text
Challenge resource registry ──> source-specific discovery ──> workspace selection
                                                            │
                              existing shared queue / bounded operator workers
                                                            │
                          exact-source + schema + native-grid + quality checks
                                                            │
                             candidate bundle + verification receipt
                                                            │
                                  explicit reviewed publication
                                                            │
                          versioned public registry + immutable artifacts
                                                            │
                         Tehran/Tokyo story / game / Explore / Echo
                                         + Advanced tools
```

Public page loads and game actions must not start upstream science downloads or processing. Existing authenticated workspace access remains the processing boundary. Initial public live discovery, if exposed, should use bounded preset searches; arbitrary user locations retain explicit submission and privacy controls.

## All-resource coverage matrix

All 14 entries are in scope. The coverage record carries the original challenge URL, canonical publisher URL, retrieval time, resource type, access/license state, implementation owner, method/example IDs, checks and unresolved work. A publication may cite several resources without pretending they are independent datasets.

| # | Resource | Concrete use in Earthsignal | Required proof / actual gate |
| --- | --- | --- | --- |
| 1 | [Earthdata Search](https://search.earthdata.nasa.gov/) | CMR-backed source discovery, exact collection/granule provenance and current NISAR releases | Reproduce bounded query and resolve exact science asset, not screen scraping. |
| 2 | [ASF Vertex](https://search.asf.alaska.edu/) | Existing ASF adapter, acquisition/pair selection and source cross-check | Catalog identity and file metadata agree; returned coverage is separately screened. |
| 3 | [NISAR guide](https://nisar-docs.asf.alaska.edu/) | Product, quality, release and geometry policies; Harmony/range adapter requirements | Each supported specification maps to a checked method and fixture. |
| 4 | [Remote-sensing introduction](https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing) | Scale, temporal sampling and uncertainty explanations tied to map controls | Reviewed explanation and a corresponding visible interaction; fetch currently 403, so do not claim newly inspected page content. |
| 5 | [SAR introduction](https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar) | Frequency/polarization/scattering and phase interpretation in actual scenes | Teach with source-specific values and genuine samples; fetch currently 403. |
| 6 | [ARSET training](https://appliedsciences.nasa.gov/get-involved/training) | Method selection and validation exercises for water, vegetation, fire and deformation | Pin the applicable lesson/version and implement a reproducible check; landing fetch currently 403. |
| 7 | [NISAR StoryMaps](https://science.nasa.gov/mission/nisar/arcgis-storymaps/) | Design briefs for phenomena-led investigations and interpretation | Trace a use case to a real processed study; do not copy narratives or infer data from rendered colors. |
| 8 | [Applications white papers](https://science.nasa.gov/mission/nisar/societal-benefits/) | Define scientific questions, useful outputs and limits for each investigation | Method/question register cites the relevant paper and its actual claim boundaries. |
| 9 | [UAVSAR postcards](https://uavsar.jpl.nasa.gov/education/postcards.html) | Follow underlying product links; process airborne polarimetric or repeat-pass data | Read original numeric data plus annotation/quality metadata; distinguish postcards from science and UAVSAR from NISAR. |
| 10 | [RCM resource](https://donnees-data.asc-csa.gc.ca/en/dataset/rcm) | EODMS/source-package adapter and real C-band example | Public/licensed access and product-level redistribution checked; no assumption of vetted access. |
| 11 | [CSA Python/QGIS tutorial](https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial) | Reproduce its RCM wildfire raster example and turn plotting steps into a tested reader/exhibit | Tutorial points to real BC-fire rasters; source host currently timed out. Read actual raster metadata and code/data licenses before adoption. |
| 12 | [RADARSAT-1 archive](https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1) | Historical C-band discovery and calibrated archive processing | Exact archive format, calibration and native geometry verified; a historical image alone does not prove change. |
| 13 | [SAOCOM catalogue](https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html) | CONAE discovery and level-specific L-band ingestion | Catalogue is searchable; archive download/processing has separate authorization/license requirements. Verify an actual documented machine interface before promising automated discovery. |
| 14 | [SAOCOM registration/access](https://www.argentina.gob.ar/noticias/la-informacion-saocom-cada-vez-mas-accesible) | Explicit access readiness and licensed archive/sample workflow | No automatic registration, agreement acceptance, acquisition order or redistribution. Gate stays visible until the required grant exists. |

Partner evidence changes the engineering scope:

* CSA states RADARSAT-1 archive products are available under an Open Government Licence through EODMS/AWS. The official EODMS project documents search/order/download tooling and a search service; inspect current collection capabilities rather than inventing a universal COG endpoint. [CSA archive access](https://www.csa-asc.gc.ca/eng/satellites/radarsat1/data-access.asp), [EODMS CLI](https://github.com/eodms-sgdot/eodms-cli), [search service](https://github.com/eodms-sgdot/eodms-website/wiki/Search-Service). CSA pages were available in search evidence but direct fetches timed out during this audit.
* RCM public access is a subset of the archive; EODMS registration and user profile affect access. Tutorial-linked open examples are a useful first acquisition route, subject to their actual data terms. [CSA access policy](https://www.csa-asc.gc.ca/eng/satellites/radarsat/access-to-data/about.asp), [tutorial and linked raster](https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial). The repository describes a modified MIT license, but its linked `LICENSE.txt` returned 404; do not label its code plain MIT or assume raster redistribution rights.
* CONAE's archive access article describes a registration/license route for Argentine archive imagery. Its [test products](https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomAdel.html) include geocoded products and cropped interferometric/polarimetric series, but downloading explicitly accepts stated terms; public availability does not grant public-app redistribution. Keep this an action-time license gate, not an automatic sample download.
* UAVSAR postcards link product records. [Producer format documentation](https://uavsar.jpl.nasa.gov/science/documents/polsar-format.html) distinguishes numeric ground-projected data, complex data and annotations; use those contracts, not a JPEG decoder. Product availability/rights still need verification for the selected example.

The [official EODMS CLI examples](https://github.com/eodms-sgdot/eodms-cli) show unauthenticated discovery for `Radarsat-1-L1-COG` and `rcm-ard`, alongside other collections. The [AWS RADARSAT-1 registry](https://registry.opendata.aws/radarsat-1/) documents an open-data path. Inspect these ready-product routes early; do not assume every RCM path requires vetted access, or every archive scene already has a ready product. Documentation is not yet a tested successful download/processing receipt. An EODMS processing order is a separate external action, not a free side effect of metadata discovery.

## Source-aware processing architecture

Normalize identity and provenance; preserve each sensor's science. Add `service/sar/{registry,contracts,admission,publication}.py` and source adapters under `service/sar/adapters/` for NISAR, EODMS RADARSAT-1/RCM, SAOCOM and UAVSAR. These are proposed files. Existing processors stay behind adapters; do not duplicate proven GCOV/GUNW math.

Each adapter implements a bounded contract:

1. `discover(query)` → catalog records, exact source/product/version, observation interval, footprint, available layers, retrieval provenance and declared access state. A record may have no downloadable asset.
2. `inspect(record)` → authoritative header/annotation metadata, data representation, calibration, CRS/grid, polarization/frequency, masks, scientific compatibility and required resource budget.
3. `plan(record(s), operation, AOI)` → immutable processing specification: exact assets, allowed operation, native windows, needed auxiliary layers, rights, byte/RAM/time estimate or explicit unknown, and deterministic identity.
4. `read_native(plan)` → bounded original arrays plus validity/quality and geometry. COG windows, HDF5 ranges, raw-grid ranges or an explicitly admitted offline package are source-specific transports; never secretly download an entire archive when a range request fails.
5. `process(inputs, method)` → quantity-specific numeric results, uncertainty/support, derived metrics and display assets, with full method lineage.
6. `verify/publish` → independently reproducible values and reviewed, revisioned public representation; rights must permit the particular output being published.

Capability is a set of separate fields, not a green “connected” badge: `discoverable`, `accessGranted`, `metadataInspected`, `nativeReadable`, `operationsSupported`, `processingReady`, `exampleVerified`, `publishAllowed`. Include `lastChecked`, evidence references and a specific blocking reason. Use null for unverified capability, not optimistic true or an inference from a portal being online.

| Product family | Processing to implement | Non-equivalence / admission condition |
| --- | --- | --- |
| NISAR GCOV | Verified diagonal channels, calibrated power/dB, temporal differences, polarization views and appropriate ratios | Expand beyond Frequency A HHHH only with exact channel/frequency mask/radiometry fixtures. Complex covariance terms are not positive intensity. |
| NISAR GUNW | Relative LOS displacement, quality-screened stacks, justified vertical/east decomposition and supported temporal views | Reference/secondary dates, connected components, corrections, geometry and observational support travel with results. |
| NISAR GOFF | Documented offset components and uncertainty/SNR screening, with interval-aware motion views | Offset pixels, meters and rates require producer geometry/definitions; not GUNW phase or automatic subsidence. |
| NISAR GSLC | Bounded complex imagery/polarization inspection; a separately admitted co-registration/interferometry method where feasible | Do not promise a full raw-to-GUNW service on the web host. Complex processing needs its own verified dependencies and compute admission. |
| RADARSAT-1 / RCM | Product-specific image reader, calibration/LUT handling, geometry/terrain treatment, masking, polarization and within-sensor date comparisons | Determine amplitude versus power and calibration convention from source metadata. A TIFF extension does not establish analysis readiness. |
| SAOCOM | L1C/L1D or other documented ready-product calibration/quality pipeline; inspect licensed cropped SLC examples for bounded complex processing | Distinguish geocoded versus terrain-corrected geometry and supplied derived products from our own retrievals; gate unsupported levels explicitly. |
| UAVSAR | Annotation-driven numeric grid ingestion, diagonal power/polarization views and justified temporal/phase products | Correct dtype/endian/grid/datum and calibration state; phase/covariance science is distinct from a postcard color composite. |

Apply a comparison contract before every subtraction, ratio or trend: quantity, calibration convention, band/channel, observation geometry, processing release, spatial support, reference and dates must be compatible for that operation. C-band versus L-band or airborne versus satellite views may be synchronized side by side, but are not one interchangeable numerical series. Never subtract a NISAR gamma0 raster from another sensor's sigma0 image just because both are in dB. A justified cross-sensor method requires its own registration, calibration, uncertainty and validation protocol. Reprojection for visualization does not confer scientific compatibility.

Use the existing shared scheduler and owner limits for new `sar-study` job kinds, not another unconstrained queue. Heavy/geocoding/complex pipelines require an explicit bounded offline worker profile and verified capacity; ordinary web workers accept only proven resource-fit methods. If a source cannot be windowed, reject online execution and plan a bounded operator preprocessing step under a separate admitted storage budget. The goal remains processing that source, with its gate visible; no new cloud purchase or automatic access expansion is assumed.

## What exists and what is missing

| Area | Actual implementation | Planned change |
| --- | --- | --- |
| Discovery | `app/api/scenes/route.ts`, `features/catalog/{domain,asf,use-catalog}.ts`: ASF search, five product choices, date/point filters, at most 24 records, cancellation and upstream errors | Add precise release/CRID and paired acquisition metadata, supported-processing status and bounded AOI filtering. Preserve existing consumers and stale-request protection. |
| GCOV analysis | `app/api/change-jobs/**`, `lib/{radar-contract,radar-gateway,radar-server}.ts`, `service/{api,store,processing,range_reader}.py`: authenticated jobs, exact-ID resolution, native crops, common masks, dB difference, analysis/export | Reuse this route family. Extend validated-collection support only after inspecting actual metadata/mask semantics; do not just loosen an allowlist. |
| GUNW analysis | `service/{gunw_reader,ground_motion,ground_motion_study,ground_motion_timeseries}.py`: separate operator-run study pipeline using CMR and bounded reads | Keep operator-run initially. Audit validated products, cache identity, temporal quality and reference/geometry assumptions before exposing an asynchronous study job. |
| Public publication | `service/result_bundle.py` exports ground motion; `service/export_public_radar.py` exports the specifically frozen Lake Mead example; `scripts/verify-public-release.mjs` verifies shipped assets | Add a shared publication registry/envelope around the two distinct scientific bundle formats. Generalize GCOV export separately while retaining its original frozen-fixture reproduction check. |
| Public loading | `features/ground-truth/data/nisar.ts`, `lib/public-radar-study.ts`: hashes, schemas and fixed study identities | Resolve explicit registry revisions. Preserve study-specific assertions for existing examples; new studies need their own checked descriptors rather than bypassing those assertions. |
| Public interactions | `MeasuredMap.tsx`, `InteractiveAtlas.tsx`, `radar-study/PublicRadarStudy.tsx`, `timelapse/**`, measured city scene, game and Echo | Consume one study/revision selection. Probes, profiles, HUD, mission receipts and explanations reference the same quantity, observation period and revision. |
| Source capabilities | `/api/sources` currently describes observatory sources, while GCOV readiness is returned by change jobs | Make the UI distinguish discovery, supported processing, runtime readiness and published evidence. Do not advertise NISAR as an enabled observatory assessment provider without implementing that provider. |

Important compatibility findings:

* `service/processing.py` explicitly requires provisional GCOV collections and supports mask specifications 1.5/1.6. The newest catalog records can therefore be discoverable but intentionally unprocessable today.
* `features/catalog/asf.ts` infers provisional/beta maturity from collection names; otherwise it says “Not specified in catalog.” Add an exact, source-backed validated-collection mapping rather than interpreting any unrecognized name as validated.
* `service/gunw_reader.py` accepts specification 1.5.0 only. A validated collection does not establish file-schema compatibility.
* The GUNW crop cache is currently named by granule alone. Before reuse across new AOIs/releases, include source revision/identity, native crop window and processing settings in its key and validate the stored metadata.
* `ground_motion_timeseries.py` currently bridges unreliable temporal steps with the pixel's fitted rate and interpolates between look-direction epochs, reporting an aggregate bridging fraction. Before extending this into new public studies, provide per-frame/per-cell observed versus reconstructed support, or withhold reconstructed steps. Do not describe those steps as direct observations. This is a source-audit finding, not a new live-data verification or a reason to mutate the historical bundle silently.

## Current upstream facts and resulting decisions

ASF documents validated L0–L2 products released on **6 November 2026**, covering acquisitions from **21 October 2026**, initially at CRID **P05036**. Earlier provisional products use P05023. Validated collections omit the maturity suffix: for example `NISAR_L2_GCOV_V1` and `NISAR_L2_GUNW_V1`. A short new observation interval must not be sold as a robust annual trend. Existing Tehran evidence retains its actual period and provisional status. [Availability](https://nisar-docs.asf.alaska.edu/availability-overview/), [collection names](https://nisar-docs.asf.alaska.edu/earthaccess/).

Downloading/streaming science files requires Earthdata authentication. Keep the existing authorized server-side credentials out of browsers and public manifests; do not require public visitors to create accounts. Any missing credential, EULA or new access grant is an explicit operational gate, not an invitation to create accounts or accept terms automatically. Metadata discovery and authenticated science access remain separate. [Access guidance](https://nisar-docs.asf.alaska.edu/access-overview/), [ASF API/authentication](https://docs.asf.alaska.edu/api/basics/).

Harmony now documents variable extraction and spatial subsetting for GCOV/GUNW, with spatial subsetting marked complete in November. Extraction targets 2D grid variables; that is not proof that every auxiliary mask, scalar or 3D geometry/correction cube required by our processors will be preserved. Keep the existing range reader as the production transport until a measured comparison justifies an explicit new adapter. [Harmony](https://nisar-docs.asf.alaska.edu/harmony/), [roadmap](https://nisar-docs.asf.alaska.edu/roadmap/).

Known issues include a permanent instrument acquisition gap from 27 July to 10 August 2026. A picture that animates smoothly through an interval is not evidence of an acquisition at every point in that interval. Record gaps and reconstructed support explicitly. [Known issues](https://nisar-docs.asf.alaska.edu/nisar-known-issues/).

## API and publication design

Extend the existing interfaces with typed source/resource discovery, processing and publication surfaces:

| Interface | Scope and behavior |
| --- | --- |
| Proposed `GET /api/challenge-resources` | All 14 resources and their data/method/explanation relationships, actual support level, evidence and visible gates. Drives the challenge coverage view and release audit. |
| Proposed `GET /api/sar-sources` | Safe public capabilities from the adapter registry; authenticated readiness details stay private. No credentials or account identities. |
| Existing `GET /api/scenes` | Live metadata, bounded query/response/time; add release filters and exact product metadata. Point/bbox modes must be unambiguous. Preset results can be cached; custom locations are private/no-store. A footprint match is not a valid-pixel measurement. |
| Proposed `POST /api/sar-studies/plan` | Authenticated preflight for exact selected product IDs, method and AOI; returns compatibility, required inputs, limits and access gates without starting heavy work. |
| Proposed `POST /api/sar-studies`; `GET /api/sar-studies/:id`; cancel/artifact/analysis children | Typed new study kinds through the existing shared scheduler and signed gateway. Reuse owner/idempotency/cancellation policies. Result payloads discriminate by scientific operation; do not reinterpret GCOV jobs. |
| Existing `POST /api/change-jobs` and child routes | Authenticated GCOV processing/analysis only; unchanged owner, Origin, HMAC, idempotency, cancellation and expiry protections. Server resolves exact source IDs; never accepts arbitrary download URLs. |
| Proposed `GET /api/public-studies` | Small read-only list of published study revisions, product/quantity, observation dates, maturity, coverage, manifest URL/hash and available interactions. Read a checked local registry, not the live job store or upstream archive. |
| Proposed `GET /api/public-studies/:id?revision=…` | Resolve an explicitly requested immutable revision; unknown or withdrawn revisions have explicit outcomes. No private job IDs, identities, notes, credentials or internal paths. |
| Versioned `/data/…` artifacts | Existing static delivery, with revision-qualified paths for new publications and immutable caching. Every referenced file is in the manifest with byte count/hash. Retain existing published URLs during migration. |
| GUNW study execution | Existing operator CLI first. A later dedicated typed study request can reuse the queue/scheduler, but must not overload the GCOV `changeRequest` contract or bypass queue limits. |

Keep `/api/scenes` backward compatible for current ASF consumers; introduce explicit `sourceId` routing for other adapters using bounded GET preset queries or an authenticated POST search for custom geometry. Return truncation/cursor/completeness explicitly; 24 returned records do not mean an archive was exhaustively searched. Do not silently fan one visitor search out into every archive or processing queue.

Suggested new files: `lib/{challenge-resources,sar-contract,public-study-registry}.ts`, checked resource/publication registries under `public/data/`, `app/api/{challenge-resources,sar-sources,sar-studies,public-studies}/**`, and `service/sar/**`. Integrate admission/dispatch into `service/{api,store,run_job}.py` and the existing signed gateway; compatibility wrappers keep `/api/change-jobs` stable. These are proposals, not files already implemented.

The data-update path is incremental: explicit bounded catalog refresh → new/changed candidate identities → admitted processing → review → new published revision. Record acquisition time, provider publication/update time and our last successful check independently. Provider outage preserves the last verified published revision with an honest freshness label. A later configured refresh cadence needs per-source request budgets, cursor/checkpoint persistence, concurrency/backoff and a stop at auth/license gates; this plan does not enable unattended jobs. Never advertise an acquisition archive as a continuous real-time sensor feed.

Use a common envelope for identity/provenance and **different typed payloads** for:

* `ground-motion-rate`: mm/year, LOS or explicitly derived vertical component, sign convention, time interval, reference, uncertainty and support.
* `ground-displacement-series`: mm, per-epoch dates and observed/reconstructed/withheld support; separate from annualized rates.
* `radar-backscatter-change`: before/after calibrated power and derived dB difference, polarization, exact acquisitions and common-valid population.
* `radar-offset`: source-defined component/unit, uncertainty/quality and acquisition interval, with explicit displacement-to-rate conversion where supported.
* `polarimetric-observation` / `complex-observation`: calibrated channels or complex representation, cross-talk/calibration state and covariance definitions. Any decomposition/classification/retrieval is a separately versioned derived method with its own validation.

Identity must include collection/concept metadata where available, exact granule IDs, product specification/version, CRID, retrieval time, source asset identity, native CRS/affine/window, quality policy, algorithm version and relevant settings. Upstream timestamps, observation dates and publication times are separate fields. Preserve uncertainty and missing-reason information; never manufacture a precise reason when only “unavailable” is known.

The shipped registry pins each manifest digest. A manifest containing its own file hashes does not establish that it is the intended revision unless the registry/app also anchors that manifest. Cache source byte ranges against stable remote identity (ETag/length and recorded metadata); hash the actual extracted arrays/artifacts. Do **not** claim a whole-HDF5 SHA-256 without reading the whole HDF5 file.

Publication sequence: candidate → validated → independently checked → reviewed publication. Stage all artifacts, verify completeness and hashes, then atomically publish the registry/release pointer. Job completion is not public publication. New upstream processing creates a new revision; stories pin an explicit revision and switch through a reviewed release. Rollback changes the pointer without rewriting evidence. Preserve referenced public revisions within a documented retention/storage policy; caches and expiring private jobs remain independently bounded.

## Implementation order and acceptance

These milestones sequence the whole challenge scope; completion of the first two existing examples alone is **not** completion of the project. After the registry/contracts are fixed, partner adapter pilots proceed alongside validated NISAR work. They do not wait for every GUNW enhancement to finish.

### 0. Freeze the challenge contract and source inventory

Implement the 14-resource register and source/product capability ledger, trace the challenge requirements into testable features, reconcile against the official page when available, and pin method/source versions. Inventory existing credentials and license grants by readiness only, without exposing or changing them. Select candidate studies based on actual acquisition coverage: deformation, water/wetland change, vegetation/fire response, agriculture or ice motion. Give every data family a processing owner and every blocked path a concrete next step.

**Done when:** all 14 resources are classified and mapped to an adapter, reproducible method or reviewed interaction; every feasible science family has a selected processing recipe and candidate data; unknown format/access states are explicit. No “metadata connected” status counts as measured science.

### 1. Connect the already verified studies end to end

Add the typed registry and read-only API around the current two bundles, then migrate loaders to explicit IDs/revisions without changing their numbers. Link story → Explore → game evidence → workspace to the same study. Evidence receipts record revision, quantity, source cell/profile and support. Echo receives typed local probe results, not arbitrary private workspace data. Keep simulation states visibly illustrated and separate from measured probes.

**Done when:** existing displays and source links resolve; a sampled cell/profile agrees across public surfaces; both units and missing states survive round trips; changing study revision cannot silently reuse old evidence; public API exposes only published data. An upstream outage leaves published studies usable. Existing GCOV analysis and workspace study deep links still work.

### 2. Make current discovery honest and usable

Extend catalog metadata/contracts and fixtures for validated/provisional/beta/unknown collections, GUNW reference and secondary acquisition times, track/frame/direction/polarization/release, and processing support. Add bounded AOI/date input and response-size/concurrency protections where absent. Surface “available in archive,” “supported by this processor,” “ready to process” and “published study” as distinct states. Re-check the actual authentication boundary: the scene handler itself has no session guard, despite broad wording in API documentation; add route-level tests/documentation rather than assuming all `/api/*` routes behave identically.

**Done when:** a validated result is labeled correctly without being offered to an incompatible processor; a footprint-only or empty-quality match never becomes a measurement; rapid query changes cannot attach an old result to the new AOI; public preset caches cannot contain custom-location queries.

### 3. Admit one new validated GCOV comparison

Discover and pin two real, compatible acquisitions over a small Lake Mead AOI (dates depend on actual availability). Inspect HDF5 identification, radiometry and quality definitions against current producer documentation. Add an explicit supported collection/specification policy and fixtures. Preserve track/frame/mode/polarization/grid/release compatibility and common-valid statistics. Use the existing queue and exact-ID resolution, reproduce the crop independently, then publish a new revision through the new publication path.

**Done when:** both acquisition identities, masks, native grid and dB arithmetic are verified; every sampled/exported value agrees with native artifacts; unknown specification fails closed; the old frozen study remains reproducible. If no compatible nonempty pair exists, report that gate and keep the existing study—do not substitute a different mission or synthetic result.

### 4. Refresh GUNW studies and evaluate Harmony

First fix/verify crop-cache identity and the temporal support disclosures identified above. Audit the validated GUNW specification, connected components, coherence, correction screens and look geometry. Produce a bounded operator-run candidate before offering new public ground-motion claims. A single LOS pair may support a displacement example; vertical decomposition and rates need their own adequate evidence and explicit assumptions. The synthetic radar lab's fixed 35° geometry must never be applied to real GUNW products as a default.

In parallel as a separate experiment, compare the **same native window in one GCOV and one GUNW product** via existing ranges and Harmony. Use product-appropriate windows rather than pretending different native resolutions cover the same extent. Capture bytes transferred, cold/warm latency, peak RSS, queue impact, CRS/affine, dtype, exact masks, numerical differences, and all required ancillary metadata. Categorical masks must match exactly; numeric tolerances must be justified from encoding, not selected after seeing results. A hybrid metadata/range plus Harmony adapter is acceptable only if provenance and total budgets remain explicit.

**Done when:** the transport decision has actual measurements. Missing required layers, altered mask semantics, undocumented resampling or excess resource use blocks Harmony adoption for that product. No automatic range/full-file/cloud fallback. No new paid infrastructure assumption.

### 5. Complete partner adapters and wider NISAR operations

Implement RADARSAT-1, RCM, SAOCOM and UAVSAR adapters and source-specific tests in disjoint source modules. Investigate the CSA tutorial's real wildfire raster, the RADARSAT-1 archive ready-product path, UAVSAR ground-projected science behind a postcard, and SAOCOM licensed geocoded/cropped examples. Each starts with metadata/rights inspection, then a small reproducible numerical crop, then a compatible date pair or a clearly single-date polarization study. Do not fabricate change evidence when only one usable observation exists. Add GCOV channels, GOFF and bounded GSLC processing as verified methods rather than retaining catalog-only product tabs.

Run the first cross-adapter experiment on one NISAR crop, one UAVSAR numeric grid and one RADARSAT-1 ready product, sequentially under measured budgets. Compare adapter outputs against independent original-byte/metadata readers, not against one another as if the sensors measured identical quantities. Add RCM/SAOCOM as their actual inputs/rights permit. Resource estimates and quality rules are per method/product; a universal float32 conversion or fixed 35° incidence model would be wrong.

**Done when:** every feasible science source family has an actually executed, independently checked numerical processing example and a public representation where publication is permitted. Every feasible temporal-change path includes a compatible pair/series. Remaining blocked products retain evidence, owner and next action. A dummy adapter, browse-only display, test mock or generic “later” note cannot satisfy this milestone. If a needed heavy pipeline exceeds current capacity, report its measured requirement and bounded deployment option rather than calling the source integrated.

### 6. Strengthen the Tehran/Tokyo experience; expand Advanced tools

Keep the landing, main story, optional game and main Explore focused on Tehran subsidence and its comparison with Tokyo. Use new resources to improve the relevant radar explanations, measured scenes and interactions. Keep a visible “How this was measured” trail to source records, native values, method and quality support, with deeper inspection in Advanced tools.

Place the broader global change atlas in Advanced tools, with phenomenon/place/time selection and contextual source/product controls. Its source-comparison lens can show C-band/L-band or airborne/satellite observations side by side with separate units and dates. Guides, tutorials and other scientific examples inform these tools and their interpretation; they do not each become a new landing-page section.

The main story follows Tehran's real findings and the human question behind them, then Tokyo's historical response. Game missions explore this same arc: manipulate groundwater, investigate uneven settlement, read the radar signal, probe Tehran's verified evidence and explore intervention choices with Tokyo's history as context. Broader source/polarization investigations belong in Advanced tools. Pure mechanism simulations remain useful but cannot stand in for data investigation. Echo narrates the selected observation and support state using the deterministic telemetry contract; bounded assistant explanations cite reviewed evidence and never invent scene numbers. Natural voice can explain variable numeric findings through reviewed text/cues without expanding private-data disclosure or arbitrary synthesis endpoints.

**Done when:** the main experience presents a coherent visual and gamified Tehran/Tokyo narrative. Contextual handoff to Advanced tools preserves the study and selection, and the return path is clear. In Advanced tools, users can investigate broader surface-change questions, process supported data, compare appropriate dates/channels and export provenance-bearing findings. Every feasible source family is available there at its verified capability level, and at least one broader investigation demonstrates the expanded science. Mobile and desktop stay readable; 14 resources do not become 14 competing landing-page widgets.

## Release gates and resource limits

Retain the current configured maxima while implementing: one science worker, at most 1,000,000 native pixels, 512 MiB transfer per GCOV pair, 1 GiB service storage budget, 3 GiB free-disk reserve, 1,200-second job wall time, queue 8, owner outstanding 2 and daily 5. These are configuration/source limits, **not newly measured production capacity**. Measure CPU/RSS and web/voice contention before admitting GUNW stacks; do not carry the offline study's larger transfer defaults into the web queue. Keep temporary publication files and extracted crops accounted for. No background refresh schedule is enabled by this plan.

Required discriminating checks:

1. Masked pixel next to a measured pixel remains unknown in map probe, profile, 3D, Echo and export; null never becomes zero or an interpolated observation.
2. GUNW LOS, derived vertical rate, series displacement and GCOV dB cannot be attached to the wrong story/mission slot. Ground tilt is not structural safety or collapse probability.
3. Mismatched native grid, polarization, processing release, chronology or unknown quality schema rejects a scientific comparison with a reason. Separate-context co-display of unrelated products remains allowed with clear labels.
4. Changed ETag/length mid-read stops the job. New source version/AOI/reference settings cannot reuse an incompatible crop cache. Retries never bypass auth, range, storage or quota gates.
5. Tampered manifest, array, mask or publication file prevents promotion; the client also rejects a corrupted published artifact. No partial publication or fallback to demo data.
6. Reprocessing creates a new revision; a pinned story and saved evidence retain their original identity. Failed publication preserves the previous release; withdrawal is explicit.
7. Cross-owner access, unauthenticated processing, missing/wrong Origin, arbitrary URLs and traversal fail. Public registry responses never include workspace inputs or private annotations.
8. Tiny-screen/iPhone and desktop interactions retain touch gates, readable HUD/controls, global Pause/Replay and bounded rendering; loading a new data revision does not remount duplicate 3D/audio engines.
9. For each adapter, independently reproduce source decoding and calibration: amplitude/power distinction, LUT/noise handling, sigma0/gamma0 convention, byte order, CRS/affine and masks. A browse image must be rejected as analytical input. Complex channels retain their mathematical type.
10. License/access gates prevent the particular prohibited download or publication; a successful private computation cannot automatically become public. Capture only safe grant/terms references, never credentials, in provenance.
11. Challenge coverage audit distinguishes listed resources, working discovery, executed processing and publicly published evidence. All 14 resources have a concrete use or evidenced gate, and every feasible data-family processing objective is satisfied; tests cannot mark a mocked adapter as live science.
12. Editorial scope remains explicit: landing/main story/game/Explore center on Tehran subsidence and Tokyo; broader source catalog and scientific processing live in Advanced tools. Contextual links preserve study selection and provide a return path. No unsupported contemporary Tokyo measurement or public multi-sensor dashboard is introduced by this data integration.

Run focused catalog, gateway, public-study and Python scientific tests for each phase, followed by typecheck/lint/build and end-to-end publication/outage checks. Perform an independent source/value review before publishing new science. No test/build/deployment was needed or run merely to write this plan.

## Adviser decisions

All five were consulted in the existing Chrome profile, with non-sensitive abstract briefs and actual replies inspected on 13 November. After the user's scope correction, each received one bounded clarification covering all feasible challenge sources. Earlier two-site-only scope advice is superseded; the original examples remain implementation fixtures.

| Adviser / visible mode | Decision taken and limitation |
| --- | --- |
| [Gemini / Pro, Argon High](https://gemini.google.com/u/2/app/dc12fbe96c414f7d?pageId=none) | Accepted schema dry-run, auxiliary-layer completeness, product-level compute admission and three-adapter experiment. Rejected unverified collection/bucket assumptions until sourced, arbitrary performance thresholds, automatic fallback, universal float32 outputs, a universal EDL requirement and unverified layover/shadow-mask assumptions. Channel expansion is in scope with fixtures; resource limits come from measurements. |
| [Claude / Free, Sonnet 5.5 Medium](https://claude.ai/chat/ccfa48da-53f9-4b5a-9c50-164f378eab12) | Accepted immutable revisions, publication/rollback, rights-bearing adapter contracts and explicit listed/processed/published coverage. Rejected reducing every operation to crop/tile/summarize or assuming one format/transport for every archive. Bounded metadata search stays separate from heavy processing. |
| [DeepSeek / default chat, model not stated](https://chat.deepseek.com/a/chat/s/4156ac60-5298-4fe5-a4c1-d3f4354e7043) | Accepted footprint/coverage, masked-probe, geometry, revision/cache, amplitude/power, complex-data and rights counterexamples. Rejected whole-file hashes for range-only access, blanket acquisition matching for unrelated context panels, and treating its illustrative calibration labels/formulas as producer specifications. |
| [Perplexity / Search, model not stated](https://www.perplexity.ai/session/0deb200d-ceab-4b03-b5b1-41be905cef27) | Used primary-source leads for current NISAR services, EODMS/AWS and partner access; independently inspected relevant documentation. Rejected mandatory public end-user accounts and its blanket SAOCOM browse-registration claim: CONAE's own linked catalogue page says public searches/thumbnails are possible. ESA proposal access is a separate route, not the default challenge integration. |
| [Kimi / Instant High](https://www.kimi.ai/chat/1a1d61c5-2e92-8954-8000-09e3ce1dbde5?chat_enter_method=home) | Accepted the clarified all-family processed-example requirement, one phenomenon-led atlas, source switcher and visible gates. Superseded its original two-site ceiling. Rejected assuming RADARSAT-1/RCM coverage at Lake Mead, seamless historical continuity, fixed study examples without discovery, or mandatory EDL login for public viewing. |

The implementation recommendation is therefore: **inventory the whole challenge, build shared source-aware processing, complete every feasible adapter in Advanced tools, and use relevant verified findings to strengthen the focused Tehran/Tokyo experience.** Scientific breadth belongs in Advanced tools; the main experience retains its visual, human and gamified narrative. Scientific support, licensing and resource admission determine how each source is processed and represented.

Planning handoff: all five browser consultations are recorded as inspected and resolved in the owned team at revision 50. The long-lived orchestration coverage still carries historical consultation/workflow and independent-check flags; this planning artifact does not claim a completed build or independent implementation review. No worker result, new data execution or deployment is being accepted by this handoff. The scoped user correction is staged as project learning, not promoted to durable knowledge.
