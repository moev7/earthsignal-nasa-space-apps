# Industrial story increment — local verification

Based on `6e920ab`, on `codex/earthsignal-public-release-20261110`.
This is the stronger visual increment requested after the first living-story
pass. It does not replace the earlier acceptance record or claim deployment.

## Result and visual evidence

The two supplied industrial references informed the condensed display type,
large object-led compositions, functional part callouts and spare controls.
The existing charcoal, warm-white and mint palette remains. Manrope remains the
body/interface face; the locally hosted Barlow Condensed display face is licensed
under OFL. Three locally optimized images provide Tehran and Tokyo context and
a clearly labelled NASA NISAR artist's concept. Credits, licenses and responsive
crop changes are available through persistent help; the source manifest is
`docs/internal/story-media-sources.json`. The images total **504,716 bytes**.

AtlasAbove's Berlin scene informed bounded illustrative cars, pedestrians and
park canopies. The public measured scene is framed closer to its building
centroid. Street life uses a separate clock: it cannot advance a measured year,
remesh the ground or move a scientific building pose. Its visible label says it
is illustrative. The measured OSM road polylines and mapped park polygons supply
routes/placement bounds, rather than invented observational geometry.

Tokyo remains a main chapter with a photograph, interactive history and two
turning-point controls. Every historical event, including both 1962 events, and
the full year control remain under a labelled disclosure. Real radar images,
measured atlas, simulation/collapse controls, aquifer, missions, comparison and
advanced workspace remain available.

CUA inspected 1440×1000, 1280×900, 768×1024 and 390×844 in one batched pass.
One fix batch brought the city closer, adjusted exhibition lighting and fitted
the opening heading. The confirmation covered desktop and phone. At 390px the
document width was exactly 390px. Phone scenes use normal flow so reading does
not require passing through oversized pinned scenes. Desktop scroll scenes and
manual controls remain.

Captures:
`/Users/amireza/.codex/visualizations/2026/11/09/01a1c1ab-417c-76b2-9f27-8c19d83b441b/industrial-story/`.
This includes actual reference captures, the desktop/phone confirmation and
production-preview opening, Tokyo and satellite-help captures. Separated moving
frames differed; separated global-pause captures were byte-identical. These
captures complement the lifecycle tests; image differences alone do not identify
which actor moved. In the production build, selecting Tokyo's 1980 control changed
the selected year/event, full history expanded with all seven events, and the
satellite reflector help opened a persistent explanation.

The final saved production opening exposed a CSS chunk-order defect: the lazy
city stylesheet overrode the hero control's bottom/left/background declarations,
stretching the button over the scene. A narrowly stronger public-story selector
now wins in either load order. The rebuilt production preview was confirmed at
1440px and 390px: the control is approximately 246×50px, with the dark story
background; the phone document still measures 390px. This was a blocking repair
after the bounded design pass, not another taste-polishing round. The final
`production-opening.jpg` and `production-phone-opening.jpg` show the repair.

## Checks and budgets

- `npm test`: **317 passed**, zero failed, skipped or cancelled.
- `npm run typecheck`: passed.
- `npm run lint`: zero errors, 12 existing warnings.
- `npm run build`: passed. Release verification checked the unchanged four
  measured ground-motion files and ten measured radar-study files against their
  manifests, two local licensed fonts and three WebP assets.
- `git diff --check`: passed.
- The rebuilt standalone server was restarted and inspected at
  `http://127.0.0.1:5174/`.

The ambient layer is capped at 72 cars and 80 pedestrians: four instanced meshes,
two geometries, two materials, 25,000 geometry/instance bytes and no new textures.
Up to 96 illustrative canopies add two static meshes and 22,328 buffer bytes.
These are incremental layer budgets, not total renderer/GPU or network budgets.
Ambient-only rendering is capped at 30fps; static shadows are cached and invalidated
for scientific changes. Exhibition pixel ratio is capped at 1.5. Offscreen,
document-hidden, pause, reduced-motion, context-loss, toggling and disposal gates
have focused coverage. New tests inspect real instance matrices, geographic
bounds, scientific geometry versions, disposal and preserved Tokyo controls.
They do not establish frame rate on real low-end phones.

## Review provenance and resource gate

Pooled Codex **gpt-6.1-sol**, Herdr job
`8fab3368b0454e5c8c0cdccd137bb55a`, implemented the bounded city layer. The
coordinator independently inspected its source, ran root checks, integrated the
visual framing/lighting fix and accepted the scoped result. The media scout used
Antigravity **gemini-3.8-flash-medium**, job
`a220e0e4082d42a99074bf7d2300cc32`; it timed out after writing assets/metadata.
The coordinator inspected those partial files, independently verified primary
licensing/credits, decoded all three images and completed integration. The failed
job is not an accepted worker contribution.

The fresh independent final visual review and the bounded native Librarian
assignment could not start: bridge health reported approximately 300 MB free,
below the 512 MiB admission threshold, with effective concurrency zero. No native
agent substitute or unrelated deletion was used. The latest project-scoped,
non-durable correction remains staged as observation
`c661379de105c3a02d586d44e68f7aa826012227a7a2aa06dc6d6f7274b65214`.
Earlier independent finish reviews apply to `6e920ab`, not this increment.
The bridge coverage report also retains consultation-order and unresolved/skipped
adviser metadata flags. No timestamps were backdated or missing receipts invented
to make the workflow report green.

Impeccable triage: the new intentional display typography is documented in
DESIGN.md and its sidecar. No new suppression was added. The existing narrow
Arial exception for Leaflet zoom glyphs remains. The build's large-chunk warnings
remain; no dependency or map-engine swap was introduced.

## Release limits

This is a local preview, not a production switch. Real-device gestures,
screen-reader and text-enlargement checks, live private sign-in/download flows,
slow-network and GPU profiling, and the ten-person comprehension trial remain
release checks. Reduced motion/context failures have deterministic coverage;
neither an OS setting nor a real GPU fault was forced in this browser pass.
Retain the preceding release for rollback. A fresh independent final visual
review remains outstanding because of the resource gate above.
