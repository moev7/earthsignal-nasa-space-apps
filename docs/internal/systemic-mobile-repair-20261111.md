# Mobile exhibition repair — 11 November 2026

Status: implementation and bounded Chrome visual checks complete; final source review and deployment pending. Physical iPhone Safari is not verified.

## Evidence and failure mechanisms

The user's three iPhone captures show oversized overlays covering the opening neighbourhood, a small city scene beneath a tall navigation/title stack, and spacecraft controls separated from their object by a long panel. Current source contained competing mobile position/height rules, hardcoded header offsets, a canvas with a height independent of its clipped parent, a radar scene occupying only the first column of a two-column grid, and hardware geometry shown almost directly above a nearby Earth.

| Problem | Repair | Verification boundary |
|---|---|---|
| Phone pinning and chapter offsets | Measure the real header; keep scene sizes on stable CSS svh. Use the visual viewport for pin admission with at least 144 px reading clearance. Release tall/expanded scenes and reduced-motion scenes to normal flow. | Actual component updates/cleanup and geometry tests pass; Safari's moving address bars still need observation. |
| Canvas cropped/leftover-looking surfaces | One city canvas sized to its parent, independent of lazy stylesheet order. Hide failed city GPU frames. Move opaque city labels, opening links and explore button off the model. Resize the existing Leaflet map when its container changes. | Component/failure tests and source checks; no assertion that the screenshot's every apparent remnant was reproduced. |
| Navigation competing with scene | Move mode switch into contents, keep current chapter readable, reduce header height, use measured chapter anchor clearance. | Actual header resize/listener test; responsive composition pending. |
| Scattered city controls | Expose one 3D interaction toggle beside the scene. Keep timeline, camera alternatives, layers, thresholds and building selection in the labelled settings panel. Retain collapse and future actions. | Actual city authority, rewind, global motion, context recovery and mode tests pass. |
| Tiny radar / duplicate extra scene | Primary radar uses the full content width. Notes/legend are outside the object. Remove the extra orbital animation from radar help; keep supplementary explanation and sources. | Model/renderer/control tests; screenshot acceptance pending. |
| Implausible satellite–Earth scale | Keep a clearly labelled, differently scaled Earth context with a visible gap below the enlarged hardware. Separate hardware, finite radio echo and physical orbital scale modes. Earth/orbit diagram uses 6,371 km mean radius and NASA's 747 km altitude; the locator is explicitly enlarged. | Real Three geometry/framing/disposal and component mode/clock tests; not engineering CAD or live orbit. |
| Huge spacecraft control stack | Hardware parts, signal steps and orbital scale occupy explicit modes. Put camera buttons in one labelled disclosure; keep manual steps, keyboard alternatives, retry, reset and the credited original image accessible. | Adversarial stale-frame, hide/re-entry, pause/reduced-motion, context-loss and mode-switch tests. |

NASA orbit source: https://science.nasa.gov/mission/nisar/mission-overview/ (checked 11 November 2026). The hardware close-up's signal path remains deliberately compressed and slowed, labelled next to the scene.

## Preserved capability

Tokyo response story and history controls, Tehran's verified measured bundle, optional mapped buildings, satellite imagery comparison, source records/downloads, science workspace, authentication/private APIs, optional five-clue investigation, aquifer/cause experiments, the one main repeat-pass radar lesson, manual camera controls and illustrative collapse remain available. This repair changes their presentation and scene sizing, not the underlying observations or scientific engine.

Existing palette, self-hosted Manrope and Barlow Condensed remain. Industrial references inform object-led scale, restrained labelling and directional typography; no claim of a visually verified final match is made in this pass.

## Checks

- Root typecheck passes.
- Root tests: 338 pass, no failures after the final city-toolbar adjustment, including 11 city authority/presentation tests.
- Production build passes, including frozen bundle verification: four measured files and ten radar-study files, local fonts and four local context images, including the credited NASA Blue Marble texture (48,174 bytes).
- Lint: zero errors, twelve existing warnings in unrelated or unchanged code.
- Built application HTTP smoke: `/`, `/?mode=game`, `/explore`, `/compare`, `/about`, `/workspace` return 200. This establishes server rendering, not browser usability or successful authenticated workflows.
- Independent Antigravity `gemini-3.8-flash-medium` review `26dcf621c362417882b74d4d62efc3ac` accepted after coordinator verification. It identified an obsolete ambient-label offset, removed. Review is source/Node only. The subsequent small city-toolbar arrangement is verified by the actual city component tests.
- Two broader source scouts timed out with no usable reports or edits; they are not counted as contributions.

## Resumed visual verification

The prior browser/locked-Mac gate was rechecked during continuation. Shared preview could read viewport/layout state but screenshot capture timed out twice. Chrome fallback on the same existing profile then worked, without account changes. The canceled development server was restarted on 127.0.0.1:5173.

Observed Chrome viewports: 390×844 (opening, aquifer, city, radar and game), 430×932 (orbital-scale diagram), 768×1024 (hardware), 844×390 (game landscape), 1280×800 (chapter navigation/aquifer), and 1440×900 (hardware and Earth context). Measurements showed no horizontal overflow in the checked views. Aquifer pinning used a 101 px measured phone header and receded from water SVG y=329 to y≈371.77 during scrolling. Expanded water controls switched the visual to relative positioning. The city rendered without labels covering it. Radar canvas matched its 350×455.76 px parent at 390 px viewport width. The spacecraft rendered the local texture with visible separation; its finite pulse was observed while the stage and action were visible. Orbit mode hid the GPU canvas and displayed the distance diagram. The game retained one active world, an in-flow phone guide and header access to Echo. The sampled Chrome console had no errors.

Screenshots: `outputs/verification/resumed-mobile/desktop-spacecraft.png`, `phone-radar.png`, `phone-game.png`. These are actual observed local Chrome captures, not generated mockups. Root tests: **338 passed**; focused recovery tests **22 passed**; typecheck passes; root lint has zero errors and the same twelve existing warnings.

Limits: viewport overrides do not establish physical iPhone Safari behavior or address-bar gestures. A browser zoom shortcut attempt did not establish a changed zoom level; no 200% text-zoom pass is claimed. Screen-reader audio, physical touch and forced live GPU loss/retry were not exercised in this visual pass; deterministic lifecycle tests cover the latter logic. No broader teen usability or learning-effect claim is made.

The NASA historical mosaic source, credits and educational-use guidance were checked directly on NASA's Blue Marble and media-guideline pages during continuation. The close-up is labelled schematic; only the separate orbital distance diagram uses the physical Earth/orbit ratio. Production activation follows the final independent source review, with the prior deployed release retained for rollback.

## Final independent review

Review of `c2970749cc10712b54a05eae48b1067de49e9789` completed 11 November 2026 at 12:52:35 UTC: **ACCEPT**, no release blockers. The T3 Antigravity task `earthsignal-resumed-mobile-final-review-20261111` requested `gemini-3.8-flash-medium`; separate executed-model metadata was null. The coordinator inspected the actual final report. The reviewer reran 22 focused tests, all 338 root tests, typecheck, release verification and lint: all passed, with the same 12 existing warnings. It made no edits. This review supplies independent source/Node evidence; the real Chrome observations above were performed by the coordinator. Global pause stops automatic playback; manual camera interaction remains a separate user control. No physical-device or assistive-technology claim is added. External T3 review is recorded separately from native bridge jobs.
