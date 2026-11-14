# Public story integration and feature preservation

The public experience is part of the root Vinext build. Source baseline: Earthsignal `36f9d31849d3836ffd75d166e1b38bc4381b8f0e`, previously reviewed against Ground Truth `65f0ade`. The duplicate nested runtime is removed after integration, while its scientific data and useful interactions are ported into the root app.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Continuous public story with shareable chapter anchors |
| `/explore` | Interactive Tehran/Tokyo atlas, measured neighbourhood and static reading guide |
| `/explore?city=tokyo` | Atlas opening on Tokyo |
| `/workspace` | Existing investigation and scientific tools |
| `/compare` | Interactive two-city trends, timelines, profiles, comparison and water-management histories |
| `/about` | Purpose and evidence distinctions |
| `/stories`, `/stories/tehran` | Redirect to the public story, retaining fragments |

Old `how-it-happens` and `evidence` fragments resolve to the merged mechanism chapter and sources. Old workspace anchors migrate to `/workspace#…`. Default sign-in returns to `/workspace`; existing permitted specialist destinations remain permitted. API handlers, private result ownership and downloads retain their existing implementation.

## Source-backed parity map

Focus changes presentation and disclosure; it must not remove the capabilities below.

| Ground Truth source | Ported capability | Root implementation |
| --- | --- | --- |
| `data/*.ts` | All original case studies, curves, overlays, causes, comparison rows, observations and source records | `features/ground-truth/data` (routing convention changed only in bundle URLs) |
| `pages/Explore.tsx`, `components/map/MapCanvas.tsx` | Both cities; five layers; selectable records and explicit gaps; search; legends; pan/zoom; feature and building inspection | `InteractiveAtlas.tsx`, `AtlasMap.tsx` |
| Measured explorer | Verified raster, ground-motion grid lookup, uncertainty, optional full OSM layer, source/provenance/statistics | Atlas controls and disclosures; original verified bundle loader |
| Geographic imagery | Actual satellite geographic context, street map and data-only mode; adjustable/revealable overlay | Atlas background controls (Esri imagery mosaic, not a dated radar acquisition) |
| `pages/Compare.tsx`, `TrendChart.tsx`, `TimelineScrubber.tsx` | Series toggles, illustrative bands, point reading, event selection/scrubbing, both city profiles, ten comparison dimensions, policy/water histories and lessons | `features/public-story/comparison` |
| Tokyo response | Interactive historical turning points plus a full two-city destination | `TokyoStory`, `/compare`, Tokyo atlas link |
| `AquiferCrossSection.tsx`, mechanism scene | Play/pause, manual progression, before/after states and draggable comparison | Main story aquifer and `LearningLab` |
| `CausesExplorer.tsx` | All five causes, mechanisms, indicators and city relevance | Mechanism learning disclosure; original data retained |
| Orbit, fringes and deformation profile | Orbit slider; interferometry diagram; inspectable illustrative profile and values; satellite mission catalogue | Radar explanation and radar learning disclosure |
| `SinkingCity3D.tsx`, city worlds | Both 3D worlds, orbit/zoom/reset, picking and keyboard inspection, time seek/play/reset, measurement cells, colours, year-20 scenario, collapse demonstration, threshold exploration | Imported city worlds, rebuilt controls and `ScenarioDetails` |
| Evidence/response scenes | Evidence categories, causal references, mitigation material, complete citations and source records | Grouped end-of-story disclosures |

Real buildings retain ground-motion and conditional ground-tilt information without damage colours, cracks, safety diagnoses or collapse dates. The original threshold exploration remains available as conditional ground mathematics. The invented city retains illustrative damage and collapse. Synthetic causal percentages remain in the source data, excluded from the public causal explanation because they are not measured contributions.

The old image comparison used remote text-to-image endpoints, not actual satellite acquisitions. The interaction is preserved with conceptual before/after geometry; actual satellite geographic context is available in the atlas. No fabricated historical acquisition images are presented as evidence.

## Runtime and content contracts

Public layout CSS is scoped to `.es-public`; public and advanced pages share root `--earth-*` palette and font tokens. `StoryProvider` controls global pause and replay; offscreen replay stays pending until the scene is visible. Scene clocks respect viewport visibility and reduced motion. GPU resources and maps have explicit cleanup. 3D manipulation is an explicit touch mode; normal scrolling remains available otherwise.

The shared `story-evidence` and `atlas-view` contracts keep measured, projected, illustrated, reference and unavailable content distinct. Real scenes start at the observation baseline. Positive offsets are conditional. Simulation years are relative. A measured dataset must not lend its label to an illustrative groundwater, track or land-use layer.

The frozen result bundle lives at `public/data/nisar/tehran-sw-2026`. Existing schema/provenance and SHA-256 checks remain mandatory. The full building layer loads only when requested. External tiles are context; failed tiles do not invalidate the local verified overlay. No substitute observations appear on verification failure.

Manrope Latin variable is self-hosted from `@fontsource-variable/manrope` 5.3.0; its OFL licence ships alongside it. The public journey makes no remote image-generation requests.

## Verification and rollout

Run root typecheck, tests and build, plus the 46 focused processing/bundle Python tests. `verify-public-release.mjs` checks the standalone output’s frozen bundle hashes and font assets. The root release package contains the public app, scientific workspace and frozen observations together.

Continuation verification on 10 November 2026:

- Root web suite: 267 passed; TypeScript and production build passed. The comparison worker's separate component suite also passed all three tests.
- Python: `python -m unittest service.tests.test_ground_motion service.tests.test_buildings service.tests.test_result_bundle service.tests.test_gunw_reader` passed all 46 tests using the existing science virtual environment. System Python lacks NumPy.
- Browser: 1280px comparison and 390px comparison/explorer checks; chart resizing, both distinct Tokyo 1962 events, Tokyo 1980 reading, city/layer/background switching, verified Tehran raster, coordinate probe and optional OSM footprint inspection. The 390px pages had no page overflow; the full comparison table scrolls within its own container.
- Browser-discovered repairs: a single-string SVG title prevents comparison hydration replacement; preserving Leaflet's internal removal listener prevents a city-switch crash after changing basemaps. Regression tests hydrate the server chart and exercise actual Leaflet basemap/city changes. Motion tests also cover a live reduced-motion preference change, clock cancellation and subsequent manual seeking.
- Scoped ESLint has zero errors and one existing raw-image advisory for the verified raster. Repository-wide lint still reports errors in the older scientific workspace and tests; it is not a passing release check.

The Tehran 2003 timeline copy now separates the early radar record from Sentinel-1's 2014 launch; see the documented parity exception in `features/public-story/comparison/SOURCE-PARITY.md`. No measured values or frozen bundle bytes changed.

Independent Codex Luna reviews `d507e8a015d947648349b80ab08128e0` and `3c2706be36be46d99c9a6b38753759cb` were inspected and accepted, and the earlier Codex Sol comparison restoration was accepted after coordinator verification. Full lint currently reports 31 errors across 13 files; every error-bearing file is unchanged from Git HEAD. The owned team has no outstanding jobs, unreviewed successful jobs or pending proposals. Coverage still reports an inherited chronology gap (`discovery_after_build`, with no current-revision design receipt), so orchestration coverage is not green. Historical receipts were retained without backdating a replacement.

Automated coverage includes layer-specific evidence, measured/projected labels, pause/offscreen/reduced-motion gating, pending replay, missing/corrupt/unsupported bundles, and unavailable/lost WebGL fallbacks in a DOM fixture. Synthetic context events are not proof of real GPU restoration.

Before production, run the planned trial with five students and five nontechnical adults or municipal staff. At least eight of ten must explain the mechanism, distinguish measurement from simulation/projection, and find the investigation path. Any interpretation of invented collapse as a prediction for a real building blocks release. Real-device touch, enlarged browser text and real GPU restoration remain acceptance checks beyond viewport emulation. Keep the previous deployed release until preview and those checks pass. No production switch is included in this implementation.

## Putting the measurement engines to work

The public story now offers one optional interaction underneath the verified Tehran atlas: **How does sinking vary across this area?** Opening it draws a reproducible A–B line on the existing map. A spatial step profile reads each crossed 400 m display-grid cell once, with a linked map marker, keyboard slider, signed rates, source-pixel error and explicit gaps. Custom endpoints and methods are disclosed, not added to the main toolbar. There is no additional WebGL context or new processing job.

The optional animation shows `rate × years` from a flat reference, separately from the measured-rate plot. It does not reconstruct terrain or intermediate acquisitions. It respects global pause, pending offscreen replay and reduced motion. Year zero preserves missing support. Future uncertainty is not invented.

The profile uses the existing `result_bundle.value_grid` output: median rates over 5×5 source pixels, withheld below 13 measured pixels. Its error field is the median source-pixel standard error, deliberately not divided down because errors are correlated. It is neither a standard error of the block median nor a confidence interval for differences between places. The source 80 m scientific grid is distinct from the 400 m public readout grid. Native analytical probes remain in the workspace.

| Existing engine | Useful public presentation | Scope and limit |
| --- | --- | --- |
| `service/ground_motion.py`, `service/result_bundle.py` | Existing measured neighbourhood 3D plus the new map-linked spatial profile | Actual rates and mask support; the future is conditional. No invented terrain or time history. |
| `service/buildings.py` local plane-fit ground tilt | Existing selectable footprints and conditional tilt inspection in the 3D scene | Ground estimates and uncertainty; no real-building damage or collapse diagnosis. |
| `service/inspection.py`, native radar probes | A simple spatial question and one linked reading; full native pixel/region/transect analysis remains in advanced tools | The public profile reuses frozen display-grid output, not a newly run native transect or interpolated raster. |
| `service/observatory/water_history.py`, `lib/water-history.ts`, public water-history archive | A later optional reservoir-level timeline, with actual historical readings and gaps | A separate case study, not Tehran groundwater evidence. No 3D lake volume or bathymetry without those measurements. |
| Native radar change and `service/observatory/raster.py` | A later measured before/after or signal-change animation | Keep the native common-valid masks and dates. Backscatter is not height, structural damage or automatically classified flooding. Private job exports are not public assets. |
| `service/observatory/scenarios.py` | One disclosed “what changes if I choose this threshold?” question in a compatible investigation | Assumed inputs and deterministic consequences, not causal forecasts or probabilities. |
| Seasonal sampling and statistical estimation modules | Explain one result's sensitivity inside a method disclosure | Retain support counts and actual uncertainty. Do not add another dashboard or turn a statistical index into physical geometry. |

Only the first row's new profile is implemented in this continuation. The other rows describe selective reuse opportunities; they are not claims of additional shipped scenes. The existing 3D view supplies spatial context while the profile supplies inspectable numerical evidence. The five browser advisers favored this pairing; suggestions requiring measured time series, another terrain surface, or unsupported uncertainty were rejected against the actual bundle contract. ESA's [two-view motion operator](https://step.esa.int/main/wp-content/help/versions/12.0.0/snap-toolboxes/eu.esa.microwavetbx.sar.op.insar.ui/operators/HorizontalVerticalMotionOp.html) independently supports the explicit east–west/vertical-only motion assumption.

The [human trial protocol](public-story-trial.md) is prepared with a blank score sheet. No participant results have been recorded.

### Latest local acceptance

The new profile and the scientific-workspace lint repairs pass **277 web tests**, the **46 focused Python tests**, TypeScript and the production build. Full ESLint now has **zero errors and 12 warnings**; the earlier 31-error result above is historical. Codex Sol implemented the lifecycle repairs, and independent Codex Luna review `914e0628cf6d4ce99faff5db53e90a9d` found no scoped blocker. The attempted Antigravity engine inventory exited unsuccessfully without a result; it is not counted as a contribution and was not automatically retried. The coordinator checked the actual engine and bundle sources directly.

The profile's focused controls regression verifies global pause, offscreen replay, reduced-motion still states and clearing an invalid route's previous map overlay. Model tests cover exact cell boundaries, diagonal corner crossings, reversed routes, missing/zero values, out-of-grid positions and frozen-grid parity. Browser keyboard selection produced a linked 130 mm/year downward reading with ±81 mm/year source-pixel error. Conditional playback advanced from 0.1 to 0.9 years and held at 1.4 after global pause. These are interface checks, not scientific validation of future motion.

The story and explorer fit a 320 CSS-pixel viewport. A simulated 200% DOM-text stress test at that width also fits after wrapping navigation and the atlas comparison link. This is not a native browser text-enlargement or physical-touch certification. An actual desktop `WEBGL_lose_context` loss showed the fallback, and restoration returned the measured scene; mobile GPU behavior is still unverified. All five frozen bundle files remain identical to Git HEAD's original Ground Truth files. No push, deployment, participant session, device-access change or account change was performed.

Final orchestration coverage retains chronology warnings and lacks a current-cycle queued build/check pairing: the main lifecycle implementation belongs to the previous revision and the profile integration/build was performed directly by the coordinator. All five adviser receipts and the actual accepted independent review are recorded, but coverage is not green; its missing chronology is not repaired by inventing job receipts or timestamps. A bounded read-only Librarian check also confirmed that the user's engine-reuse observation is non-durable and project-scoped, so it remains pending without promotion to global or active knowledge.


### Shared identity and Atlas Above reference — 10 November 2026

The user’s request for the **same** palette supersedes the earlier independent workspace identity. Root `--earth-*` tokens now define the public charcoal/mint/warm-white palette and Manrope font. The public shell aliases those tokens; the scientific workspace, form controls, portal controls and sign-in use them too. A shared Earthsignal mark and explicit 44px “Back to the story” link connect `/workspace` to `/`. Scientific raster scales, multiseries plots and threshold encodings retain their source colours. The selected investigation boundary uses the interface accent, rather than a data category.

Inspected [Atlas Above’s Berlin map](https://atlasabove.com/maps/berlin) and [the author’s construction article](https://atlasabove.com/news/how-the-map-is-made). The submitted `/maps/` directory returns 404, but its city links work. The useful ideas are legible angled city geometry, streets/parks as context and clear orientation. The author describes city-provided 3D models and imagery, OSM context and manually refined landmarks; this does not establish an available Tehran dataset or reusable hosted API. We retain our verified Tehran footprints and estimated-height labels. No Atlas Above code, geometry, textures or service calls are imported.

Added instant **Neighbourhood view** and **Overhead view · north up** controls in the existing measured scene’s view disclosure. North is `-z` in the measurement coordinate frame. Overhead pairs with the existing 80m cells; it changes neither scene time nor scientific values and adds no animation, dependency or GPU context. Decorative traffic/trees and additional style menus are not added to the measured scene.

Validation: TypeScript, production build and all 277 web tests pass; full lint has zero errors and the existing 12 warnings. The unchanged science service was not rerun for this styling/navigation change. Local browser checks confirmed shared computed background `rgb(25, 28, 29)` and Manrope in both routes, both workspace modes at 320px without page overflow, and return navigation to `/`. At desktop, selecting overhead plus cells retained time `0`, the measured/provisional label and the hatched missing cells. Physical mobile touch remains unverified. Local development stays running on port 5173 for user review.


Independent Codex Luna source review `da9cb59cfa2a4f15949668c9daf5fa28` found no scoped code defect. Its missing reference/runtime checks were completed by the coordinator, with desktop, 320px and north-up/cell screenshots. The final small portal/boundary/sign-in token repairs and invitation/title copy were checked directly. The read-only native Librarian audit `9911555416ae4f3b9f7aac3a03319a1b` verified the correction’s source hash and project/non-durable scope; the observation remains pending, with no active or global promotion.

Revision 11 orchestration coverage is still not green: direct coordinator implementation has no queued build/check pair, and inherited `discovery_after_build` chronology remains. Actual source review and deterministic/browser checks above are recorded separately; metadata does not certify them or erase those gaps. Both bounded jobs are complete and accepted; all current messages are acknowledged. The persistent team stays available for this continuation.


### Repeat-pass radar in 3D — 10 November 2026

The supplied two-pass/fringe diagram is the radar lesson in `LearningLab`, rather than the measured city or atlas. Its interaction contract is one synthetic 3D scene with a sinking control, observation comparison and optional orbit/zoom. The ordinary page keeps scrolling until orbit is explicitly enabled. Manual input replaces automatic scene playback; no extra mission dashboard, dependency or external service is required.

Physics references: [NASA’s NISAR interferometry explanation](https://science.nasa.gov/mission/nisar/interferometry/) describes same-position, zero-baseline repeat observations for deformation. The [ASF HyP3 InSAR guide](https://hyp3-docs.asf.alaska.edu/guides/insar_product_guide/) specifies a complete wrapped phase cycle for half a radar wavelength of line-of-sight distance change. Geometry and its numerical readings must share the same unexaggerated model. The teaching convention is positive phase for increased range, not an assertion about every product’s displacement-sign convention. A vertical movement projects onto the radar’s line of sight; a half-wavelength line-of-sight change must not be labelled the same amount of vertical sinking.

Acceptance oracles: zero ground motion gives uniform deformation phase; at 35° incidence, 18cm downward motion gives approximately 14.7447cm increased one-way range and 1.228728 cycles for an illustrative 24cm wavelength. Display exaggeration changes the geometry alone. Synthetic phase colours are separate from the verified Tehran raster. Atmospheric, orbital and topographic terms are omitted from the toy deformation model and must remain acknowledged as real processing requirements.


Implemented files: `InterferogramConcept.tsx`, `radar3d/{RadarLesson.tsx,createRadarScene.ts,types.ts,radar-lesson.css}`, and the pure `lib/radar-interferometry.ts` model. Open `/#radar-lab`, then “Try repeat-pass radar in 3D, and explore the science”. The slider, Before/After/Compare, visible Explore in 3D toggle and keyboard camera presets operate one scene; existing profile/mission disclosures remain available. HTML values and explicit sources remain available after GPU failure. Reopening/retrying uses a fresh canvas so an explicitly released context is never reused.

Coordinator checks: all **283 root web tests**, TypeScript, the production build and scoped ESLint passed. The six new tests include a real Three.js scene/OrbitControls/geometry/material fixture with only the renderer boundary replaced, plus React StrictMode, manual controls, replay, lazy visibility, closure, document hiding, context failure/retry and exactly-once disposal. No animation frames are requested. Surface colours are converted from the shared sRGB phase palette to Three’s linear vertex colours. An independent oracle confirms the physical numbers above. The local server responds200 and serves the new radar disclosure/anchor. No real-GPU visual or physical-device recovery check was performed in this change; fixture success is not hardware certification. No measured bundle/service or dependency changed, and the local server stays running.


Pooled Codex Sol implementation `7e0bc8b193864ce0a93667ddc95f4fd7` and independent OpenCode `opencode/glm-5.3-flash-free` review `759f627c612a4e28a21cd39643775e35` are inspected and accepted. OpenCode independently recomputed the range/phase oracle, reran all six focused tests and found no blocking scientific, lifecycle or interaction defect. It did not claim real-GPU testing. The coordinator verified all 283 web tests, typecheck, scoped lint and production build. Adviser access attempts stopped at an active-user Chrome state-change guard; no new adviser reply was claimed. Kimi/Claude dispositions reuse the earlier accepted focused-flow/scene architecture advice; source discovery was resolved directly through NASA/ASF. A stale MCP submission was rejected before enqueueing; fresh matching bridge/source/dispatcher `ad7ef4f75acd` queued the same review request once. The review respected the temporary one-slot disk admission gate without bypass or cleanup of unrelated files.


Final revision13 coverage confirms accepted implementation and a distinct accepted independent review, all five adviser dispositions resolved, no outstanding/unreviewed jobs, and no unacknowledged messages or proposals. Its inherited `discovery_after_build` chronology flag still prevents green workflow coverage; actual checks above are not replaced by that metadata, and no timestamps were backdated. The persistent team stays active for continuation.

## Real dated radar study (10 November 2026)

The public explorer includes a frozen Lake Mead GCOV comparison at
`/explore?study=lake-mead-gcov-2026`, alongside the Tehran and Tokyo atlas.
The story's satellite chapter links to it under “Compare two real satellite images”.
This is HH backscatter change in dB between 26 June and 30 September 2026,
not the Tehran GUNW ground-motion quantity in mm/year and not an inferred flood,
water-area or damage classification.

`python -m service.export_public_radar --check` reproduces the public export
from the pinned native study and historical verification receipt without network
access. It verifies original TIFF hashes, grid, masks, radiometry, statistics and
shared display stretch. The new public PNGs use the same 94 × 114 native grid as
the numerical arrays. The outer manifest identifies this presentation explicitly:
the unchanged embedded source manifest describes its historical Web Mercator
previews. Public PNG hashes are in the outer file table. Native TIFF downloads
retain the original linear gamma0 powers; public before/after inspection uses dB.

The browser validates file lengths/hashes, native PNG dimensions, common null
masks, difference arithmetic and coverage before showing measurements. It fails
closed with retry on unavailable or corrupt assets. Region summaries are medians
of valid pixelwise dB differences, with valid/total counts and valid area.

A public study and inclusive native cell/region selection travel through named,
allowlisted query parameters to `/workspace`. Dates and place come from the trusted
study registry. The investigation draft receives the selected native footprint,
converted from WGS84/UTM zone 11 north; it never treats the public study as a private
job ID and never starts analysis on navigation. Collaborator sign-in and its cancel
link retain this public context. Existing personal histories, APIs and tools retain
their authentication boundaries.

The scientific comparison form also receives the original acquisition IDs and the
geographic box enclosing the native selection. The place/question draft retains
the exact native-cell polygon. Both remain editable drafts; neither runs on entry.

Verification for this increment: root typecheck/build, 294 web tests and 67 focused
Python tests passed. Browser interaction checks covered 390/768/1280/1440 px with
no horizontal overflow, 44px mode controls and vertical touch scrolling. Real-device
gestures and a successful collaborator login were not exercised; local collaborator
access was unavailable. The ten-person comprehension trial remains outstanding.


### Navigation correction — 10 November 2026

The deployed Vinext `next/link` handler canceled page clicks without completing a route transition. HTTP200 checks did not expose that interaction failure. `components/site-link.tsx` now uses ordinary browser anchors for public header/footer/actions, study tabs, comparison/profile links and workspace return links. Exact URLs, selected-tab semantics, query strings and fragments are retained; same-page chapter controls and auth/science logic are unchanged.

The regression mounts the actual public header/footer, observes clicks after React’s handlers, and requires navigation to remain uncanceled, including modified/new-tab clicks. All295 web tests, TypeScript, production build and scoped lint pass. Actual standalone-browser clicks reached Explore, Tehran/Tokyo, Advanced tools and the return path; the Tokyo and Lake Mead tabs selected the correct query-based case. Independent Luna review `2246db1f65f34b1184a6fb30f3de8bec` found no blocker. The user correction remains project-scoped and non-durable after read-only provenance audit, with no active/global preference promotion.


### Site-wide spacing correction — 12 November 2026

Shared spacing and interface type tokens now cover the public story, all five game stages, atlas, comparisons, spacecraft, sign-in and advanced tools. Labels and values have separate flow, controls wrap and grow, desktop control docks have more width, and supporting disclosures stay in document flow. Removed the late game-fit rules that compressed captions and overlaid the objective disclosure. The score stays inline; mobile toolbars wrap; Echo's current instruction remains complete; secondary source/workspace disclosures and range inputs have 44px targets. Workspace claim tags also wrap under enlarged text. Scientific grids, math, measurements, state and audio code are unchanged.

Verification: 377 web tests pass; TypeScript, production build and lint pass (12 existing warnings, zero errors). Existing policy-city cascade coverage now loads the shared global tokens and checks readable captions instead of requiring the old 10/11px sizes. Browser checks covered story/game and explore/comparison/about/sign-in/workspace at 320, 375, 390, 768, 1366 and 1440px. The production radar model and current action fit together at 1366×768; phones retain normal page scrolling. Text-spacing overrides and a direct 200% text simulation found no page overflow or clipped visible instructions after the repairs. Screen-reader-only text and scrollable raw GeoJSON were treated separately. These are viewport checks, not physical-device touch or a comprehension trial; private collaborator result states were not created.

The previous coordinator inspected Gemini Argon High and Claude Free Sonnet 5.5 Medium spacing/hierarchy advice before implementation. This continuation reused those decisions. Independent Codex Luna review `79d0a32da8ac437683e539d137fdd3ea` found no concrete regression in its read-only CSS/cascade scope and passed the five focused policy-city tests; root supplied browser acceptance. The earlier Sol builder returned a partial result, which was preserved and repaired by root rather than counted as fully accepted. Full local measurements are retained in `outputs/releases/density-verification-20261112.json`.
