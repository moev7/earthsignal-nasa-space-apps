# Living public story — local acceptance

Implemented on `codex/earthsignal-public-release-20261110`, based on `37ec962`.
This increment changes public composition, disclosure, scene control and optional
learning missions. It retains the existing scientific workspace, datasets, Tokyo
comparison, atlas and real radar-image comparison. No dependency, API, private
result, authentication or processing contract changed.

## Behavior

- Large measured-neighbourhood opening; short aquifer → invented city → radar →
  measured observations → Tokyo sequence, with normal scrolling and chapter links.
- Aquifer and invented-city still states follow scroll progress. Manual controls
  take authority until “Follow the story.” Global pause, replay, reduced motion,
  offscreen suspension and resource disposal remain supported.
- Measured Tehran opens at the observation period. An explicit action enters the
  conditional future. Invented collapse remains prominent and clearly labelled.
- Full controls, maps, profiles, scientific introductions and provenance remain
  in persistent help/disclosures or their existing routes. Opening a scene's
  details releases its sticky position so expanded controls remain readable.
- Five optional comprehension questions award 20 points each, once per question.
  Local versioned receipts merge across tabs. Reset invalidates previous receipts;
  unavailable storage uses tab memory. Hiding missions preserves discoveries.
- Rewinding clears the real simulation's dust and debris buffers before rendering
  a still. Browser history records the previous reading position before chapter
  navigation scrolls.

## Deterministic checks

- `npm test`: **312 passed**, zero failed/skipped.
- `npm run typecheck`: passed.
- `npm run lint`: zero errors, 12 existing warnings.
- `npm run build`: passed, including public-release verification of four measured
  ground-motion files, ten radar-study files and the local licensed font.
- `git diff --check`: passed.

Added tests exercise actual React controls and lifecycle boundaries for scroll
authority, pause/replay, reduced motion, offscreen return, context retry, cleanup,
mission hydration/scoring/storage errors and reset. A real simulation-world test
emits collapse dust, rewinds, and checks its visible buffers without a GPU clock.
GPU construction is instrumented in component tests; that is not live GPU testing.

## Browser observations

CUA inspected 390×844, 768×1024, 1280×900 and 1440×1000 layouts. The combined
inspection found excessive mobile pinned height; one fix batch shortened repeated
caveats, reduced mobile scene height and removed the duplicate Tokyo introduction.
The confirmation retained visible evidence labels and full optional controls.

Observed: reversible aquifer scroll movement; invented-city manual collapse and
Follow; pause holding year 10.86287853 across scroll; radar model phase changing
from 1.23 to zero cycles; a correct answer awarding 20 points and persisting after
reload; mobile progress/reset disclosure; explicit 3D exploration mode; help
opening by keyboard; chapter Back returning to scroll position zero and Forward
returning to the aquifer. At 390px the document width was 390px.

The production standalone build was also opened at `http://127.0.0.1:5174/`.
Its measured opening rendered, the real Lake Mead radar comparison loaded its
images, the full Tehran–Tokyo comparison opened, and Advanced tools opened the
existing workspace. No private job was submitted and no authentication state was
changed.

Captures are in the local visualization directory
`/Users/amireza/.codex/visualizations/2026/11/09/01a1c1ab-417c-76b2-9f27-8c19d83b441b/story-experience/`.

## Independent review and provenance

Fresh Herdr reviewer: pooled Codex `gpt-6-luna`, jobs
`e58afc1fa332484db816439cae35e62b` and
`d20f66e2868a4fa088562a87769bdb1d`. The first required recapturing a phone opening
saved before its lazy scene appeared. The same path was recaptured with actual
rendered 3D. The valid-evidence review returned **ship**, with no material fixes.
Both review results were independently accepted; neither reviewer ran the tests
or used a browser. This substitutes a fresh bounded Herdr reviewer for the stock
Impeccable native review role.

An accepted Antigravity `gemini-3.8-flash-medium` scout mapped scene APIs. A pooled
Codex `gpt-6.1-sol` city worker supplied useful partial implementation, explicitly
reporting the dust-reset gap. The coordinator completed and verified integration;
the partial job was not accepted as a finished deliverable. An interrupted mission
worker's partial files were inspected and completed directly, with meaningful
tests added. No failed execution is counted as an accepted contribution.

Impeccable triage: the intentional Arial exception remains limited to Leaflet's
zoom glyphs. There are no new suppressions. The requested design sidecar was
refreshed; the palette, Manrope and existing DESIGN.md were preserved.

## Limits and release boundary

This is local implementation acceptance. Real phone gestures, screen-reader use,
text enlargement on real devices, slow-network profiling, a complete live private
sign-in/download journey and the proposed ten-person comprehension trial remain
release checks. Reduced motion and unavailable/lost WebGL have deterministic
coverage; no operating-system motion setting or real GPU fault was forced here.
The build still reports large-chunk warnings. No production switch or deployment
was performed; the previous versioned local release remains available.
