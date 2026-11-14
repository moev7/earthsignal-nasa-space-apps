# Earthsignal × Ground Truth: challenge-fit assessment

Assessed 10 November 2026. The intended product is Earthsignal’s measurement and investigation engine presented through Ground Truth’s visual, interactive storytelling. Minimalism changes the order and visibility of controls; it does not discard scientific capability.

**Assessment snapshot, before the implementation below:** the local application has substantial science, 3D and teaching content. The incomplete part is the connection between those elements: public visitors consume one frozen measured case and illustrations, while most original engine tools remain in a separate authenticated workspace. Completing that evidence journey will add more value than expanding the menu of controls.

## Implementation update: public GCOV bridge

The first two recommended integration steps are now implemented locally. Open
`/explore?study=lake-mead-gcov-2026` for the actual dated NISAR crop: before/after
swipe, separate dates, difference scale, keyboard/touch cell inspection, inclusive
native-region statistics, shareable selections and source/download disclosures.
The public study retains the original measurements and valid-pixel population.

The contextual investigation link carries the selected native footprint and dates
into the place/question draft. Scientific explorer also receives the pinned source
acquisitions and the enclosing geographic crop box. Sign-in return and cancellation
preserve the allowlisted public context; navigation does not submit processing.
Existing Tehran/Tokyo, 3D lessons, projections and specialist tools remain available.

Validation: root typecheck, production build and **294 web tests** pass; **67 focused
Python tests** pass. The production verifier checks both frozen public bundles.
Responsive browser checks covered 390, 768, 1280 and 1440 px; manual modes, keyboard
inspection, native-region counts and the actual scientific draft were exercised.
Collaborator access was unavailable locally, so an authenticated login/private-result
session was not exercised. Return parsing and zero-submission hydration have tests.
No deployment or human comprehension trial is claimed. The original audit below
records the gaps as they existed before this increment.

## Evidence and scope

- Refreshed the private Earthsignal remote through its existing Git access: `origin/main` is `69f0c5a`, the imported development branch is `36f9d31`. GitHub connector access to the private repo returned 404; Git fetch succeeded.
- Verified the public Ground Truth repository still points to `65f0adeb60b858c1177278bed9be404f4faa38a8`.
- Assessed the current **uncommitted local checkout**, including the later ground-profile and 3D radar lesson work. These local features must not be described as already pushed or deployed.
- Read the official [2026 challenge brief](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/) in the browser. Its body was unavailable to the text-fetch tool but loaded in the browser. Also checked the official [participant FAQ](https://www.spaceappschallenge.org/resources/participant-faqs/).
- Inspected the local entrance, public navigation and radar lesson. Selecting zero sinking produced zero range change and zero phase cycles. This is a teaching-model check, not a real-data validation.
- Root typecheck passed; all **283 web tests passed** in this assessment. The four manifest-listed Tehran assets passed size and SHA-256 checks. No new scientific processing, production readiness test or comprehension trial was performed.

## Coverage against the intended product

| Area | Present now | Remaining gap |
| --- | --- | --- |
| Real NISAR ground-motion case | Tehran frozen GUNW-derived result, 36 source granules, 18 June–21 October 2026; provenance, uncertainty and checksums | One aggregate period; no public measured temporal sequence |
| Visual explanation | Aquifer animation/swipe, 3D measured neighbourhood, invented collapse city, interactive repeat-pass radar/phase lesson | Important learning interactions are several scrolls away and inside disclosures; a short recommended path should make them easy to find |
| Public exploration | Tehran/Tokyo selection, five layers, Esri geographic context, measured cell probe, building selection, A–B rate profile, conditional future profile | Most alternate layers and Tokyo curves remain illustrative; the atlas does not query the original measurement engine |
| Original processing engine | Native GCOV before/after processing, quality masks, bounded queue and protected artifacts remain implemented | No curated public GCOV case is connected to the story/atlas |
| Scientific analytics | Workspace has native raster probes, polygon statistics, distributions, transects and annotations | Public profile samples the coarsened display grid; it is not the full native analytical toolkit |
| Story-to-investigation continuity | Advanced tools and investigation links reach `/workspace` | Links do not carry the current study, selected geometry, dates and quantity into the investigation |
| Tokyo | Interactive historical lesson, comparison curves, milestones, profiles, water-management records and map context | Curves are explicitly synthetic; no measured Tokyo NISAR bundle or acquired historical imagery sequence is connected |
| Useful outcomes | Community questions, source records, existing workspace explanations/exports | No demonstrated improvement in a real user’s understanding or decision; the ten-person trial is prepared but not conducted |
| Delivery | Single local Vinext runtime; scientific service remains separate as intended | Current changes are uncommitted/local; public source/release/preview evidence must accompany a submission |

The old engine was not lost. In `features/science/use-science.ts` and `use-radar-jobs.ts`, discovery and job processing still reach the original APIs. Public components instead load `/data/nisar/...` through `features/ground-truth/data/nisar.ts`. This is a partial integration, not an absence of an engine.

## The two measurement paths must stay distinct

1. **GCOV backscatter change:** `service/processing.py` computes changes in returned HH radar power on common valid native cells. The quantity is dB. It does not directly measure sinking, water loss or building damage.
2. **GUNW ground motion:** `service/gunw_reader.py`, `ground_motion.py` and `ground_motion_study.py` use unwrapped phase, quality screening and viewing geometry to derive line-of-sight motion and aggregate vertical rates. The public Tehran bundle comes from this path.

The existing 3D phase lesson explains a synthetic model. The city future slider and conditional profile extend a fixed rate. None is a measured history through successive dates. Esri satellite imagery provides geographic context and is not imagery acquired on the selected radar date.

## The highest-value next increment

Build one shared **study → evidence → inspect → investigate** flow, retaining the current story and full workspace.

### 1. Connect a real dated comparison to the public viewer

The repository already contains a small Lake Mead GCOV study: `examples/prepared-study/manifest.json` and `verification.json`, with native assets in `examples/native-radar-development/`. The recorded comparison is 26 June versus 30 September 2026, with 10,002 common-valid pixels. Its receipt records reproduced native-source arithmetic; that receipt was inspected, not reproduced again during this assessment.

Create a curated public export of its actual before/after/difference/validity layers. Reuse the engine’s common stretch, mask and provenance semantics. Give it a simple swipe/blink/difference interaction and a point reading. Keep its dB quantity distinct from the Tehran mm/year case. An observed signal change can motivate a question without asserting an environmental cause.

**Acceptance:** displayed date/quantity/mask match the manifest; point readings match native source cells; invalid cells remain missing; a frozen export loads without sign-in; private jobs remain protected.

### 2. Preserve context between the story and deeper tools

Introduce a typed study reference identifying product/quantity, source manifest, geometry and dates. “Inspect this study” should open the same evidence; “Investigate this place” should prefill a draft with compatible boundaries and dates, then let the visitor choose to run work. Loading a case should not silently submit a processing job.

Use a common public study presentation with separate adapters for ground-motion and backscatter products. The existing ground-motion bundle schema should not be relabelled as a generic schema that accepts incompatible units. Export only deliberately curated public studies; do not add anonymous access to owner-scoped jobs.

**Acceptance:** the place, dates and evidence identity survive forward navigation, sign-in return and browser Back; no private result becomes public; switching products updates units and controls.

### 3. Make the existing interactivity a clear sequence

Offer a short guided path: move the aquifer → try the invented city → inspect the actual measurement → compare the historical response. Make the core action visible on each scene. Keep numerical thresholds, full provenance and specialist settings in labelled disclosures. Preserve free exploration, replay, reduced motion and the full tools.

Promote one small “Try measuring” interaction—such as the existing A–B profile—into the evidence chapter. Draw attention to its relation to the map instead of adding a second disconnected chart. A selected-area summary can follow, but a summary of the 400 m display grid must not claim the precision or semantics of the original native analytics. Use native outputs for native analytical claims.

**Acceptance:** an unfamiliar visitor can perform one meaningful interaction per chapter without instruction and explain which parts are measurements or teaching models.

Make those actions inviting questions: “Can you make the fringes disappear?” in the synthetic radar lesson; “How does this side of the plain differ from that side?” on the measured profile; and “What changed after Tokyo’s water controls?” in the historical account. Feedback must come from the selected evidence or explicitly identified teaching model. These small investigations can make the experience playful without inventing scores, causal percentages or policy forecasts.

### 4. Add measured temporal exploration only with suitable data

The current GUNW export contains aggregate rates. `summary.stacks` contains pair diagnostics; it does not contain dated vertical displacement rasters. `stack_frame` returns aggregate rate/sigma and `run` saves aggregate direction/vertical arrays.

A genuine time sequence needs retained pair crops, a justified temporal/reference method, compatible geometry and mask/uncertainty handling. Do not manufacture frames by multiplying the current rate and label them observations. The existing conditional animation remains useful under its present label.

### 5. Keep Tokyo substantial and be explicit about its evidence

Retain the current historical lesson and comparison. Add an observed historical series only when its source, dates, district, units and digitisation uncertainty are documented. Keep Tokyo’s response context separate from a matched NISAR comparison until one actually exists.

## NASA challenge fit

The official brief calls for an interactive application that uses NISAR radar data to communicate surface change to a broad audience. It explicitly includes subsidence and encourages storytelling and contextual evidence. Its listed multi-polarisation/frequency and temporal ideas are potential considerations, not a mandatory checklist. A focused Tehran case is a defensible primary demonstration; broader coverage should prove reuse rather than overwhelm the visitor.

Current fit is strong in subject relevance, actual NISAR use and scientific/visual material. It is partial in accessible end-to-end measurement exploration, demonstrated user benefit and submission packaging. This is an engineering assessment, not a NASA judging score. The official FAQ says the 2026 submission and judging guides become available on **13 November**; detailed older rubrics should not be presented as confirmed 2026 scoring rules.

The original GCOV analytical path uses HH power; metadata mentioning other channels does not mean a multi-polarisation comparison is implemented. Multi-polarisation exploration is a possible later extension, not a reason to delay connecting the already verified measurements to the public experience.

## Smallest convincing demonstration

Show a visitor one real neighbourhood; let them alter the teaching mechanism; return them to measured ground-motion evidence; let them inspect a point/profile; then use Tokyo to discuss response. Offer the existing real dated backscatter comparison as a second measurement case and a clear route into the engine. Success is a coherent, reproducible interaction with evidence—not the number of datasets or controls on screen.

Evidence screenshots: [entrance](/Users/amireza/.codex/visualizations/2026/11/09/01a1c1ab-417c-76b2-9f27-8c19d83b441b/challenge-fit-20261110/01-current-entrance.jpg), [working radar lesson](/Users/amireza/.codex/visualizations/2026/11/09/01a1c1ab-417c-76b2-9f27-8c19d83b441b/challenge-fit-20261110/03-working-radar-lab.jpg).

Audit assistance: OpenCode `opencode/glm-5.3-flash-free`, source-inventory job `c620ffe438384822af14cf47c20128d9`, independently checked and accepted with the temporal-data and display-grid corrections above. Perplexity Free Search supplied a bounded source check; the consequential brief and guide-date claims were checked directly on official pages. Other design/label/lifecycle questions reuse the earlier project adviser receipts. The participation evaluator reports `historical_accepted`, `missing_plan` and `workflow_incomplete` at the final checkpoint revision; the evidence above does not claim a green orchestration score. Separate local learning curation encountered a provider quota gate: its candidate remains unaccepted. Neither limitation is scientific validation evidence.
