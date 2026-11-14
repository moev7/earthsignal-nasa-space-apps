<!-- Archived README through dbe1b32; original content retained, relative links adjusted for this directory. -->

# Earthsignal Observatory

A responsive scientific observatory inspired by NASA Space Apps **Dancing with the SARs**. Start with Place & question for water, fire, ecology and urban workflows, or open the full Scientific explorer. Both use the same visual system; the original observation collection, radar analysis, histories and scientific tools remain available. No synthetic measurements substitute for missing evidence.

Live workspace: **[nasa.r8volt.com](https://nasa.r8volt.com)**. Private source repository: **[meowtappeparlechat/earthsignal](https://github.com/meowtappeparlechat/earthsignal)**. Public discovery works anonymously; radar processing, prepared study and downloads require an operator-provisioned collaborator account.

## Accessible decision observatory

The expansion adds versioned evidence/claims, owner-scoped assessments, deterministic evidence briefs, snapshots, printable reports, threshold/footprint scenarios, temporal evidence views and native before/after/difference/excluded exports. An optional Gemini connection selects reviewed **public** explanations only after exact-payload preview and consent; private results stay in local deterministic briefs.

Sources have explicit supported/configuration/unsupported/research states. Actual science/mask/grid checks govern measurements; discovery does not establish change. New forecasts, climate scenarios and advanced models are not activated merely because their contracts or research methods exist. See the [implementation checkpoint](../docs/decision-observatory.md), [source registry](../docs/source-registry.md), [implemented methods](../docs/observatory-methods.md) and [design QA](../design-qa.md) for current capabilities and remaining validation gates.

## Run locally

Node>=22.13.0; production uses22.22.1. Native vinext/React web application, Python FastAPI science service and two SQLite WAL databases. No Sites account or runtime is required.

```sh
npm ci
npm run dev
# http://127.0.0.1:5173
npm run typecheck
npm test
npm run build
HOST=127.0.0.1 PORT=3040 npm start
```

For local collaborator access, create a private state directory and configure these variables **in the shell launching the app**:

```sh
umask 077
mkdir -p .earthsignal
export EARTHSIGNAL_AUTH_DB="$PWD/.earthsignal/auth.sqlite3"
export EARTHSIGNAL_PUBLIC_ORIGIN=http://127.0.0.1:5173
npm run collaborator -- provision yourname
npm run dev
```

For processing, run the separately configured [science service](../service/README.md), set `EARTHSIGNAL_PROCESSING_URL=http://127.0.0.1:8030`, and inject the same private `EARTHSIGNAL_GATEWAY_SECRET` into both services. Earthdata credentials stay on the science host. Production requires HTTPS; use the exact public origin. The auth DB directory must already exist. Catalog exploration remains useful without a processing connection.

Universal search opens with **⌘K / Ctrl+K** or **/** outside text fields. Choose **Radar comparison** to inspect the retained real study or select two acquisitions, crop the map and submit a job. Catalog compatibility is advisory; authoritative science-file validation runs before calculation. Pair dates must be chronological.

## Documentation and operations

- [Using analytics and forecasts](../docs/analytics.md), [Architecture](../docs/architecture.md), [scientific definitions](../docs/science.md), [versioned API](../docs/api.md)
- [Deployment and TLS](../docs/deployment.md), [collaborator administration / backups / recovery](../docs/operations.md), [troubleshooting](../docs/troubleshooting.md)
- [Reproducibility and prepared-study evidence](../docs/reproducibility.md), [contributing](../CONTRIBUTING.md), [security](../SECURITY.md)
- [Release packaging](../scripts/package-release.sh), [web deployment with rollback](../scripts/deploy-web.sh), [systemd/nginx templates](../service/deploy)

The retained Lake Mead crop compares2026-06-26 and2026-09-30, with10002 common-valid10m pixels (1.0002km²), median−1.461262dB, and93.337% common coverage. Independent native-source reproduction matched input digests, masks, exported values and statistics. This is backscatter difference; speckle and surface conditions limit interpretation. [The exact manifest](../examples/prepared-study/manifest.json) and [verification receipt](../examples/prepared-study/verification.json) preserve the evidence. The GitHub workflow checks frontend/types/build, Python service behavior and native GDAL export reconciliation; actual archive streaming is a separate operator check.

## Real sources and scientific limits

- **ASF / NASA Earthdata:** live NISAR GCOV, GUNW, GOFF, GSLC and OPERA Sentinel-1 RTC discovery through the public ASF Search API. Exact product IDs, acquisition times, footprints, processing versions, maturity, polarization and source links are retained. Product browse images are original archive assets. The server caps each query at 24 products and uses bounded requests and short cache headers. No Earthdata credential is needed for catalog discovery; some science downloads require sign-in. A footprint or browse image is not a derived hazard estimate.
- **OPERA applications GitHub repository:** an actual, small historical DSWx-HLS B01 water-class GeoTIFF, pinned to commit `452c0145b1dbdd5ca82c6d13d7fadc8fba0bbd06` and verified against its Git blob and SHA-256. This is Landsat/Sentinel-2 **optical data**, not NISAR radar. The snapshot date is inferred from the repository filename; individual contributing granule IDs are unavailable. The notebook describes provisional products.
- **OpenStreetMap:** real geographic basemap without a key. Attribution is retained. Move to a supported commercial or self-hosted tile service before heavy traffic; obey the public tile usage policy.

The processed source mosaic has 30 m pixels in EPSG:32611. Class 1 covers **402.7365 km²**, class 2's pixel footprint covers **98.5779 km²**, and codes 0/1/2 comprise **94.3431%** of all mosaic pixels. These are whole-mosaic figures, **not Lake Mead alone**. Class 2 is not converted to an exact fractional water area. All other codes stay excluded without guessed meanings. The map initially zooms into the Lake Mead region, and the interpretation explicitly distinguishes the viewport from the whole-source totals. One historical raster does not establish water-level change, volume, flooding or current conditions.

Radar acquisition playback can span different tracks, directions or reprocessed versions. It browses actual records, not an aligned change time series. Ground-motion interpretation requires line-of-sight referencing, coherence and atmospheric corrections.

## Foundation

- `features/science/domain.ts`: discriminated real observation collection, data-type registry and pure filters. Date, location, orbit, maturity, preview and saved filters compose without relabeling unrelated data.
- `features/science/use-science.ts`: shared selection/filter/bookmark state. Filtered-out records cannot remain in the detail panel; bookmarks store only IDs locally.
- `features/science/science-workspace.tsx`: one workspace. Reusable filter, card, detail, keyboard-search and slider modules. Evidence, processing and acquisition context expand beneath the map rather than splitting the workflow into modes.
- `features/catalog/domain.ts` / `asf.ts`: runtime-validated, typed acquisition and GeoJSON contracts; safe public-asset allowlist; optional metadata remains unknown. Exact source query travels with the response.
- `app/api/scenes/route.ts`: server-side catalog adapter, validated query parameters, abort/25-second timeout, explicit unavailable/empty behavior. Errors never substitute synthetic data.
- `features/catalog/use-catalog.ts`: abortable loads, retry, and query-matched result state so old acquisitions cannot appear under a newly selected place.
- `features/catalog/geo-map.tsx`: client-loaded Leaflet, resize/lifecycle cleanup, actual footprint or georeferenced raster layers. Switching observations fits the correct region; saving or opening details preserves the map viewport.
- `features/science/universal-search.tsx`: installed command/dialog primitives, keyboard navigation and dismissal, shared visible actions. `/` does not intercept typing in text fields.
- `features/science/webmcp.ts`: feature-detected tools for reading the filtered real collection and selecting a visible record, using the same UI state. Aborted registrations are cleaned up.

Recharts loads only when acquisition context expands. The analysis raster stays out of the client bundle; the display PNG is approximately 20 KB. The browser receives display layers and protected downloads. Scientific processing stays on the Python service; local authentication and job history use separate SQLite databases. Credentials never enter browser code.

For larger deployments, add paginated/indexed discovery, an application cache and rate controls, object storage for analysis-ready rasters/tiles, and authenticated preference storage. Additional analyses should produce separate typed derived products with provenance, quality masks, units, algorithm/version, temporal baselines and validated scientific interpretation. Keep scientific processing upstream of the UI.

## Reproduce the actual raster processing

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/processing/requirements.txt
.venv/bin/python scripts/processing/process_water.py
.venv/bin/python -m unittest discover -s scripts/processing -p 'test_*.py'
```

The generator retrieves the pinned GitHub raster, verifies its identity, counts **native pixels before resampling**, multiplies by the absolute affine pixel-area determinant, and renders a nearest-neighbour Web Mercator PNG for Leaflet. It writes the source raster and a complete processing receipt under `public/data`. Source bytes are checked even when a local `--source` file is supplied.

Tools assessed: [asf_search](https://github.com/asfadmin/Discovery-asf_search) supports discovery/download workflows, [NISAR Cookbook](https://github.com/ASFOpenSARlab/NISAR_Cookbook) provides GCOV processing recipes, [nisar-py](https://github.com/ASFHyP3/nisar-py) supports NISAR transformations, and [OPERA applications](https://github.com/OPERA-Cal-Val/OPERA_Applications) provides the reservoir raster and categorical-area method used here. The app calls the documented ASF API directly; it does not claim to run all these Python libraries. MintPy/ARIA-tools remain candidates for compatible interferometric workflows after data/product compatibility is established.

## Verified checkpoint — 2026-10-08

Team `earthsignal-prototype-20261008`, coordinator `earthsignal-coordinator-20261008`, epoch 1. Coordinator owns source and publishing.

Browser design consultation completed in a fresh Claude chat, visible Sonnet 5.5 / Medium / Free: https://claude.ai/chat/66498283-0942-49fb-add4-4e0557532c75 . Accepted advice: provenance attached to data and exports, honest viewing-direction/reference language, no invented smoothing, responsive UI. These safeguards persist in the actual-data workspace.

Independent scientific check: Gemini Pro/High (`gemini-3.1-pro-high`), job `e2079648c2bc4a849d2792da2743997a`, **accepted with persisted bridge review**. It read the actual GeoTIFF and independently confirmed checksum, native CRS, class counts, areas, included coverage, and scientific caveats. Earlier Flash review timed out; a second source review found selection fallback issues, independently fixed, but was rejected as final acceptance because the brief had changed to real data.

Verification: TypeScript passes; nine meaningful catalog/real-collection tests and two Python processing tests pass. Actual ASF queries returned current acquisitions for Lake Mead and Tehran. Browser checks cover Ctrl+K and slash search, keyboard selection of places, scientific orbit filters, real map/metadata, responsive filters, expanded evidence and zero functional-mode tabs. Native browser `document.modelContext` is unavailable: native WebMCP registration/execution validation is unavailable; unsupported browsers work normally. No fabricated validation receipt.

Production build and deployment are verified separately at handoff. No scheduled automation is configured for this prototype.

## Radar implementation checkpoint — 2026-10-09

Goal: approved GCOV backscatter comparison, prepared study and live collaborator jobs. Team `earthsignal-radar-live-01a11cd9-20261008`, coordinator `chat-01a11cd9-1293-7521-9e28-8475325b6ae8`, epoch1. Coordinator owns integration, credentials, deployment and acceptance. Current milestone: self-host full workspace and publish private repository; user abandoned Sites hosting.

Implemented: typed `radar-change` observations; before/after acquisition selection with catalog advisory and viewport crop; owner job history, cancellation and idempotency; four display layers, shared brightness, symmetric difference legend, coverage/provenance/downloads. The authenticated native Node gateway validates collaborators and signs requests; the FastAPI processing service independently validates signatures, replay and ownership. One SQLite WAL worker uses bounded remote reads, native aligned crops, versioned masks, atomic publication, cancellation/recovery, ordered caching and expiry. No synthetic result appears in the observation collection.

Deployment: `45.63.116.105`, `https://nasa.r8volt.com`. Let's Encrypt certificate expires2027-01-06; nginx HTTPS/HTTP redirect, Certbot timer and renewal hook verified. Dedicated `earthsignal` account and enabled API/worker services share a384MiB/halfCPU slice. Existing server services preserved. GDAL3.12.2 NETCDF virtual IO is verified, with Python3.14.4 native science packages. Public signed GET200, anonymous API401, replay/tamper401; the gateway uses its explicit Earthsignal user agent. User manages Cloudflare; no Cloudflare configuration changed. Earthdata is configured at `/etc/earthsignal/earthdata.netrc`, owner earthsignal, mode0600, outside source/browser/manifests. A bounded actual HDF5 metadata probe transferred18772bytes and confirmed schema1.5 mask definitions; no comparison acceptance is inferred from that probe.

Scientific correction: `gcov-hhhh-v3` supports producer schemas1.5.0 (uint8 anomaly0/2) and1.6.0 (uint16 fill65535, HH focusbit256, low-byte anomaly0/2), requires the corresponding map and rejects unknown definitions. Schema1.5 source is pinned to isce3v0.25.13; schema1.6 to commit127452609bb9b3bdf3f7a2bf1cdf49c493b49441. Earlier v2 candidate jobs correctly remained unpublished when unsupported1.5 masks were encountered; two failed, third cancelled during reads. Selection rationale and rejection history remain in service-owned storage. Prepared job `932485953d57489eb109b90eb34a606b` completed and is pinned: 10002 common-valid pixels,1.0002km², median−1.461262dB. Contract validation passed; independent native-source reproduction passed: digests, native pixels, masks, coverage and all statistics matched;6919780 bytes,148.9MiB peak,492.756seconds.

Verification:21 frontend/gateway tests, TypeScript, production build and new-file/GeoMap eslint pass.65 service tests pass on the native host; local suite skips only native GDAL. Export tests now assert independent ground-truth counts and exact excluded-pixel mask, alongside equal/double/reversed numerical tests. Browser desktop/mobile QA covers pair selection, mismatch/invalid crop, map extent, disabled anonymous submission and responsive history without page overflow. Full self-host authentication and download verification is the current integration milestone. Preview is http://127.0.0.1:5173; QA screenshots are ignored under `outputs/`.

Delegated evidence: SolHigh (`gpt-6.1-sol`) service job `cf188af7b2bf48fe974ff6c088094bec` accepted as implementation contribution with coordinator mask/storage corrections, not end-to-end science acceptance. GeminiProHigh (`gemini-3.1-pro-high`) frontend job `8071b8fcc68c47cbb6113946d9dc13b5` rejected for concrete rendering/lifecycle/contract gaps; assigned frontend paths integrated and corrected by coordinator. Erratum: rejection's nonexistent-property observation concerned `water.rasterUrl` (correct property `water.imageUrl`); `water.imageBounds` does exist. Broad science review `7020a061e8954132a9ac22beff974f76` rejected for missing exception-map semantics. Focused1.6 review `a50dfedf0edb4677a52bd3bb22918689` accepted narrowly; its legacy-absence assumption is superseded by the verified1.5 specification. Final dual-schema review `bf79f37b79244428b0eb524e4e700290` accepted with qualifications: stronger exported-mask test requested and implemented; its proposed1.6valid_min uncertainty rejected because pinned XML explicitly defines it. GeminiFlashMedium (`gemini-3.8-flash-medium`) UI check `8f3a7dc228af4040856e02754cc58ead` failed provider EOF/output protocol; partial advice was not accepted as a completed review. Coordinator browser/test checks provide actual UI evidence. Reviews persisted in bridge; no inferred quota/account claims.

Architecture consultation covered by the planning ClaudeFree/Sonnet5.5Medium receipt: https://claude.ai/chat/5933d0f5-698f-4034-ba1d-a6566c0b0944 . Accepted asynchronous jobs, masks, cancellation/recovery and resource caps; rejected sorted cache keys and automatic auth retries. Planning GeminiPro review `eeded0dac0be48219c245cbfb0193f6f` accepted with source qualifications.

Self-host decision: user requested own full workspace at nasa.r8volt.com and a private GitHub repository, superseding Sites activation. Original Sites identity remains historical. Browser Claude Free/Sonnet5.5Medium review https://claude.ai/chat/26cb2a5d-7dc8-454b-b74b-62e4ffcdc5c6 accepted local operator-provisioned collaborators, opaque hashed SQLite sessions, exact-Origin CSRF, loopback science HMAC and resource bounds. Rejected advisor's scrypt N16384/r8/p1 claim: current OWASP specifies p5 at this memory level; async serialized hashing uses p5. Native vinext standalone discovery GeminiFlash job `d01dbcfc413a44b1bd7b57a142e745cd` accepted after installed-source verification; actual build remains a coordinator gate. Sol authentication writer `19077a44cf0446ad82ebae4c916d28fb` owns only local auth, endpoints, sign-in UI, operator CLI and tests. GeminiFlash docs writer `a57162bf7c984accbec7cee74d58d3d1` owns isolated `/tmp/earthsignal-docspack`; neither has server credentials. Coordinator owns gateway/native configuration/deployment, independent reproduction and GitHub publication. Next: integrate and check auth, build/deploy native Node frontend, verify browser and protected downloads, publish private repo with docs/CI.


## Self-host completion — 2026-10-09

Resumed under explicit user handoff by `earthsignal-resume-t3-20261009`, team `earthsignal-radar-live-01a11cd9-20261008`, epoch2. The active host is **https://nasa.r8volt.com**; Sites publishing is historical and was not resumed. Public discovery is anonymous; collaborator jobs and the independently reproduced prepared study are protected.

Fresh acceptance: strict TypeScript and all41 web/catalog/auth/gateway tests passed; native standalone production build and compiled operator CLI passed. The service passed65 tests on the deployed GDAL3.12.2 host, including the native exported-mask test; local service execution passed64 and skipped only that native check. Login, all9 prepared-study artifacts and exact manifest reconciliation passed over public HTTPS. Browser checks verified authenticated result selection, Ctrl+K, actual before/after/difference/exclusion rasters, 390px mobile layout without horizontal overflow, and logout clearing protected access. The temporary verification collaborator was disabled and sessions revoked.

All three services are active/enabled, nginx configuration passes, Certbot timer is enabled, and Earthdata remains0600 server-only. Web observed peak176140288bytes under192MiB with zero restarts; science observed peak323100672bytes under384MiB, both with swap disabled. A bounded transient native test unit was collected after successful completion. Existing unrelated server services were preserved.

Independent authentication correctness review: SolHigh (`gpt-6.1-sol`) job `a761dad10aa8409fa0f6a633c789a05a`, accepted after the coordinator corrected its confirmed gateway body-admission/deadline gap and added checks. GeminiPro auth review `b505b5a867464ca8afd26e351b5f0272` declined and was rejected; no acceptance inferred. A final GeminiFlash documentation audit `d95af7771ae9477c9f6788d439f74e2c` timed out without a result. Coordinator checked the docs against source and corrected stale reproduction status, native gateway wording, gamma0 notation and release-symlink rollback instructions. Existing self-host design consultation covers the unchanged architecture; no repeat consultation was needed for these completion checks.

Source handoff includes private-repository CI, deployment/operations/science/API docs, pinned study manifest and reproduction receipt. Private credentials, auth databases, temporary browser state and build/QA artifacts are excluded from Git. GitHub publication and CI results are reported separately at handoff.


<details>
<summary>Preserved analytics handoff — 2026-10-09</summary>

## Analytics implementation checkpoint — 2026-10-09

Team `earthsignal-analytics-20261009`, owner `earthsignal-analytics-coordinator-20261009`, epoch1. User approved implementation of region analysis, native pixel inspection, histograms, transects, interpretation, annotation learning, time series and validated forecasting. Coordinator owns contracts, gateway, historical data/modeling, integration, verification and self-host deployment. Science and UI workers have disjoint ownership. Acceptance: exact native/mask/AOI reconciliation, protected ownership, real source provenance, chronological forecast evaluation, responsive one-workspace UX and live checks.

Decision: reuse the existing protected result rasters for bounded on-demand analytics without rereading remote granules. Add observed Lake Mead gauge history from the pinned OPERA repository as a distinct historical dataset; never imply it is satellite area or current conditions. Forecast only with sufficient contiguous history and temporal validation; expose model and persistence baseline scores. Annotations are unverified hypotheses, not automatically trained ground truth.

Browser consultation unavailable: Claude design-review question was to assess native-raster analytics and validation-gated historical forecasts within one workspace. On 2026-10-09, `https://claude.ai/new` displayed Cloudflare security verification; no question/data sent and no adviser answer claimed. Proceed with deterministic evidence and independent focused review. T3 Code thread “Dancing with the SARs Solutions” stopped at its Codex usage limit. Under the user’s explicit follow-up request, ownership handed to `chat-01a11cd9-1293-7521-9e28-8475325b6ae8`, epoch2. No retry of the gated account. Live acceptance completed for release `20261009-analytics-v3`; private source publication is the final milestone.

Completed contributions: Sol `fab7762a397f4556ae9c9311228106d0` implemented native analytics/annotations and API integration. Gemini Pro `77bf9e179cdd401690314de6456a2993` implemented the isolated UI checkout `/tmp/earthsignal-analytics-ui-20261009`; coordinator integrates only its assigned files. Earlier UI job `1a3e032e6ba94d868ba375e4dc08d650` was cancelled while queued, zero attempts, to use an isolated checkout; team tagging rejects differing cwd, so isolated UI evidence is tracked here. Coordinator owns observed gauge history, model evaluation, runtime contracts/gateway and deployment.

Verification at follow-up:49 web tests and strict TypeScript pass; native production build and scoped lint pass. All85 service tests pass on the GDAL3.12.2 host with no skips (local83pass/2GDALskips). Actual prepared exports reconcile10716 total/10002 valid pixels, all histogram totals10002, exact native probe,128 transect samples, threshold areas1.0002km², and empty outside-AOI statistics. Bounded test unit peak241.5MiB under256MiB, zero swap. The pinned gauge source was independently regenerated:14,506 observed readings, SHA-256 `f481fbb5c7e5d5493be396980e0fe5bfff1b22f341e3efae042690a9fd14e5b5` through2023-09-18.

Independent evidence: Gemini Flash/Medium (`gemini-3.8-flash-medium`) forecast review `0d033d3a297c4d23b920e54981052e7b` accepted with historical/prospective limits; Gemini Pro/High (`gemini-3.1-pro-high`) focused science/ownership review `5d1be3e3ea834e0aa3ece40af7f7fb03` accepted after coordinator native checks. Sol science and Gemini Pro UI contributions accepted with integration qualifications; all verdicts persisted. Coordinator corrected CSS/test integration, native sign-in navigation, date-input events and disclosure state. Live browser verified pixel/region/transect tools, owner-private notes, provenance JSON export and390px charts without overflow; live HTTPS verifies anonymous/Origin/cross-user denial and private notes on shared prepared results. A downloaded JSON reconciles2,657 selected pixels and unverified-note provenance; CSV distinguishes14,506 observed readings from7 retrospective predictions. Temporary verification collaborator disabled and sessions revoked after QA.

</details>
