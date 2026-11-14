> Historical release receipt. The current city pinning and ambient/recorded sound contract is in `city-sound-verification.md`.

# Living story implementation and release verification

11 November 2026. Scope: a public story and optional investigation built around the same five experiments. Research, reference comparisons and consultation receipts: [surface contract](surfaces/living-story.md).

## What changed

The visitor follows one question from a Tehran street to groundwater, uneven settlement, a repeat radar visit, actual observations and Tokyo's response. Each chapter has a short setup, a direct action, a visible consequence and a question that leads onward. The optional game records discoveries from these actions; it no longer adds a second multiple-choice lesson beside each scene.

- Pump and refill an illustrative aquifer. Water returns while previously compacted fine layers remain compressed. Pressure and grain spacing are linked visual representations, not measured pressure or a calibrated groundwater model.
- Move the ends of an invented street together and differently. The pipe connection reveals differential movement. Original invented 3D city, collapse demonstration, playback and detailed view controls remain accessible through **3D city**.
- Capture one radar echo, change the ground, capture a second echo and compare. Captures freeze their inputs; duplicate presses do not earn another finding. The existing 3D radar engine, sample sites, camera and instrument controls remain available. One model replaces the previously duplicated lesson.
- Sample the checksum-verified Tehran ground-motion map by tapping or keyboard. Compare an actual estimate and uncertainty with a missing-data patch. Gaps are not zero. **3D city** preserves mapped buildings and conditional future views; **Radar images** preserves the separate dated Lake Mead HH backscatter study. Radar brightness is not relabelled as subsidence.
- Try a response with groundwater withdrawals, other water sources and monitoring. A schematic supply network responds to choices, without inventing a numerical policy forecast. Tokyo's real photograph and detailed published-history comparison remain available.

Echo gives one authored response derived from the experiment state, with an optional hint. No remote assistant request, fabricated dialogue or grade is needed. Findings remain optional, stored locally and resettable. The final report lets the visitor revisit findings, write their own next question, preview/copy the resulting postcard and download it.

Optional short synthesized sound cues start only after a user gesture and begin off. Pause, replay, chapter exit, page hiding and unmount stop sound; stale asynchronous resume callbacks cannot restart it. There are no audio downloads, ambient loops or new runtime dependencies.

## Functionality preserved

Root Vinext routing/release process, verified observation bundles, measured/projection/illustration distinctions, Tokyo history, satellite hardware and echo inspection, heavy-layer opt-in, original map/profile/measurement layers, processing workspace, authentication, protected/private results, downloads and API endpoints remain intact. Public styles are scoped. No processing algorithm, observation raster, result schema, authentication implementation or production secret was changed.

## Evidence and limits

Deterministic coverage includes cold/retry equivalence, irreversible illustrative compaction, capture identity/frozen state, action receipts, any-order navigation, browser history/focus, replay/reset/persistence, actual finite/gap map data, map keyboard sampling, failed images and audio lifecycle. Existing radar geometry/resource disposal and server/authentication coverage remain in the root suite. Full final command results are recorded below after completion.

Native Chrome responsive UI confirmed 390×844, 768×844 and 1440×844. The in-app browser ran at 1280×720. A temporary same-origin 390×844 iframe also checked CSS layout; it was removed before packaging. Phone controls, actual keyboard pin movement, satellite pulse stages, sane schematic Earth separation, scrolling beyond the satellite, and copyable report preview were observed. The last street-controls correction was confirmed in the still-open 390 px iframe: two mode controls and a compact action/readout row now precede the visible diagram. Native screenshots were cropped to the website viewport to exclude unrelated tabs.

The original shipping images retain their existing provenance and credits; no new raster asset was added. Existing palette and Barlow Condensed/Manrope typography were retained. DESIGN.md and its sidecar were compared with the extension; no replacement visual world or token change was introduced. Surface-specific motion and layout are documented in the surface contract, without rewriting the global system.

Impeccable's one discovery-target scan found two layout-transition issues, both corrected (pressure uses transform; route width changes immediately). Twenty-seven palette/type advisories remain as reviewed incumbent/scientific tones and local type roles. No new suppression was added. The existing narrow Arial exception concerns the Leaflet zoom glyph.

Physical iPhone/Safari, real teen/nontechnical participant comprehension, sound through the user's physical speakers and real-world building-damage validity are **not established** by these checks. A browser export-event timeout is not evidence of a downloaded file; the persistent text preview and real Blob link were verified instead.

The initial Antigravity source scout and three-file QA assignments timed out with empty results. They count as no independent contribution. A separate bounded finish review, `e2e491d1cb634aa28fd6c2b00ca3f28d` on Antigravity `gemini-3.8-flash-medium`, also timed out after 362 seconds with empty output. That timed-out attempt supplied no independent disposition or accepted contribution; the subsequent focused review is recorded below. Other local worker providers retain known quota gates. The coordinator completed source/browser/deterministic checks; those do not substitute for an independent design sign-off. Five browser adviser responses were inspected and checked against primary sources as described in the contract; they do not substitute for code verification or participant testing.

## Final checks and deployment

- `npm test`: **343 passed**, zero failed.
- `npm run typecheck`: passed.
- `npm run lint`: zero errors; 12 existing warnings in other surfaces/tests.
- `npm run build`: passed, including release verification of four ground-motion files, ten radar-study files, two licensed local fonts and four existing story images.
- Isolated Python 3.12 unittest run of processing, buildings and result-bundle suites: **58 passed**. No Python source was changed.
- `git diff --check`: passed.

Deployment activation and production smoke evidence are recorded in the release receipt; the pre-change production release is `20261111T125353Z-346d68f` and is retained for rollback.

## Continuation decision

The user explicitly selected **“Use the newer manual-only experiments”** during the finish/release continuation. This supersedes the earlier request for scroll-driven water. The default remains the non-game story, using the same manual experiments; only the explicit investigation collects local findings. The game exit is labelled “Return to the story”. The canceled local development server was restarted. Parent reran all 343 root tests, typecheck, lint (zero errors, 12 existing warnings) and the production build successfully before the final focused review.

## Focused finish review and corrections

A subsequent bounded T3 Antigravity review, `earthsignal-living-focused-finish-review-20261111`, completed at 15:25:11 UTC with **ACCEPT**, no concrete blockers at source `657235bd212fdcfcf79a7ed5d9a7ba43cd1fa424`. Requested model `gemini-3.8-flash-medium`; separate executed-model metadata was null. The coordinator read its actual final result. Eight focused tests and typecheck passed under that read-only review. No browser or participant testing by that reviewer is claimed. This narrower contract supplied exact critical files and discriminating fixtures after the prior broad native timeout. It is an external T3 result, not a native bridge accepted job.

The coordinator then reproduced two missed edge cases with failing regressions and fixed them directly: default story worlds remain mounted while scrolling, so they now silence/invalidate audio on viewport exit as well as unmount; the game now supplies the native `radar-model` target used by spacecraft help and the `case-file` target. Both affected regression suites failed before these fixes and pass after them, including canceled asynchronous audio resume after viewport exit and observer cleanup. The independent verdict applies to the reviewed baseline; these small subsequent corrections are supported by the coordinator's regression evidence and final root checks.
