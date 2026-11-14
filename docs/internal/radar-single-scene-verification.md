# One radar lab, deeper exploration — 11 November 2026

The radar chapter keeps its main interactive scene. “Go deeper” now contains
complementary deformation-profile and satellite-mission information, without
mounting another copy of the playable radar lesson.

The main scene adds three numbered sample sites: Centre, Slope and Stable edge.
The selected site's reference/repeat targets, rays and unexaggerated readings
share the same model coordinates. Selecting a site preserves the scenario,
colour mode and camera. Wrapped phase colours remain cyclic; sinking-depth
colours use a separate continuous, fixed 0–30 cm vertical scale. Before and
zero-sinking states read zero everywhere; the stable edge stays at zero.

The profile button selects a near-level camera view and highlights the same
surface transect within the existing canvas. No second renderer, clipping mesh,
dependency, autoplay or idle animation loop was added. Native sample buttons
avoid conflicts between probe selection and touch orbit. Existing explicit orbit
enablement, keyboard camera alternatives, reset/replay, offscreen release and
context-loss recovery remain.

## Checks

- 326 root tests passed; nine focused radar/model/supplement tests passed.
- Typecheck, production build, scoped lint and whitespace checks passed.
- Root lint: zero errors, 12 existing warnings.
- The release verifier checked all 14 frozen measured files, licensed fonts and
  the three existing story images.
- Fake-renderer and actual-component fixtures check sample/ray/terrain/readout
  parity, both colour modes, independent controls, reset/replay, camera actions,
  fresh-canvas recovery, disposal and zero animation-frame requests.
- The rendered deeper-explanation regression verifies that profile/mission
  content remains and no second radar lab or canvas appears there.

Pooled Codex gpt-6.1-sol implemented the scoped rendering/UI change in job
`d830dba9c5fc4aa49f48dea51f33de34`. The coordinator inspected its diff and reran
the focused checks before accepting it. Independent pooled Codex gpt-6-luna
review `c4bd78a27eaa44d5be2976a22155a47c` found no concrete blockers and passed
the nine focused tests and typecheck; the coordinator accepted that review.

All five adviser replies were inspected in the user's open Chrome session:
Claude and Kimi prioritized fixed sample sites and a compact interaction
hierarchy; Gemini recommended the same-canvas profile preset and lifecycle
checks; DeepSeek reinforced wrapped-phase ambiguity checks and corrected its
initial slope-projection error after clarification; Perplexity supplied primary
source wording. The existing vertex-colour material was kept, and free-form
probing and extra profile geometry were omitted. Primary references remain
[NASA NISAR](https://science.nasa.gov/mission/nisar/interferometry/) and the
[ASF product guide](https://hyp3-docs.asf.alaska.edu/guides/insar_product_guide/).

Real-GPU rendering, mobile visual layout and assistive-technology use were not
newly verified in this continuation. The SSR-only supplement fixture emits a
Recharts zero-size-container warning because it has no browser layout. Historical
workflow receipt-order metadata gaps remain; receipts were not backdated.
