# Five visual cause experiments — 11 November 2026

Replaces the text-only selector in the optional mechanism LearningLab. The
existing before/after comparison, radar lab, source data and scientific workspace
remain. No new dependency, remote asset, renderer or idle animation loop.

## Interactions

- Groundwater: draw down water, then refill; peak compaction remains in the drawing.
- Irrigation: change irrigated area and compare groundwater with surface supply.
- Drought: change rainfall while holding pumping constant.
- Geology: apply the same pressure change to coarse and fine material; return water
  to compare rebound with retained fine-layer compaction.
- Urban: vary added load separately from paving, showing local compression and
  infiltration/runoff pathways independently.

All values are qualitative drawing controls, not quantities from the science
engine. Alternatives for irrigation, drought and urban growth are explicitly
labelled separate scenarios rather than recovery timelines. The surface-supply
assumption is visible. Original explanations, mechanisms, indicators and city
context remain in labelled disclosures, with primary USGS references. No causal
percentages or new building-safety assertions were added.

Native ranges/buttons work with keyboard and touch. Each cause retains its state
when changing selections; reset affects only the selected experiment. Global
Replay resets the lab. Global pause and reduced motion remove spatial transitions;
manual controls still choose useful still states. SVG alternatives and live result
text describe the same outcome. No offscreen animation needs suspension because
there is no autoplay.

## Verification

- Root tests: **319 passed**, zero failed/skipped/cancelled.
- Typecheck and production build: passed, including all 14 frozen measured-file
  checks, existing fonts and story imagery.
- Root lint: zero errors, 12 existing warnings. Scoped lint clean.
- Diff whitespace check: clean.
- Actual-control tests manipulate all five ranges and inspect changed SVG
  geometry; reducer tests exercise retained compaction, isolated reset, alternate
  water supply and clamping. UI tests retain every original explanation/indicator,
  and exercise pumping/refill, pause and global replay.

CUA inspected all five desktop diagrams and phone layouts at 1440×1000 and
390×844. One fix batch increased the selected heading's CSS specificity, separated
diagram labels, added flow direction markers, connected fields to the settling
surface and fixed the adjoining before/after comparison's intrinsic-width
overflow. Confirmation measured document width **390px at a 390px viewport**.
The built standalone preview also loaded the lazy lab and successfully changed
water drawdown; its heading computed to 32px at the default desktop width.

Captures are under
`/Users/amireza/.codex/visualizations/2026/11/09/01a1c1ab-417c-76b2-9f27-8c19d83b441b/cause-experiments/`.

Fresh read-only Herdr review: pooled Codex **gpt-6-luna**, job
`fefdd61b4e8c46468824fdb9b5017da2`, returned **ship**, with no material fixes.
The coordinator independently checked and accepted the report. The reviewer read
the scoped source/tests and eight final captures; it did not run a browser or
tests. No new Impeccable suppressions were added.

Real-device gestures and assistive-technology sessions were not performed. The
drawings are teaching comparisons, not hydrogeological or engineering models.
Existing production chunk warnings remain outside this bounded refinement.

## Guided mechanism completion — 11 November 2026

The follow-up adds three selectable demonstration states per cause, a visible
selector for each cause's three investigative clues, and Tehran/Tokyo context
with native links to the measured evidence and published response. Full source
notes stay in a disclosure. Diagrams remain schematic and explicitly unmeasured;
context photographs do not establish a cause. No extra renderer or dependency.

Every guided step starts a fresh demonstration. Manual controls then continue
from that state and clear its guided highlight/explanation. The geology return
state retains compaction. Changing irrigation supply preserves the selected
irrigated area, so the same demand can be compared under two supply assumptions.

Verification: all 323 root tests passed after the final regression extension;
the three focused component/reducer tests also passed after adding manual-control
and irrigation-supply transitions. Typecheck, production build and scoped lint passed; root lint
has zero errors and the same 12 existing warnings. Tests exercise all 15 guided
steps, all 15 clue selections, geometry, explanatory text, city destinations,
isolated snapshots, clamping, reset and replay. Whitespace checks are clean.

Independent pooled Codex gpt-6-luna review `842493da1eab4176b15da02e622a4ffc`
ran the three focused tests. Its proposed irrigation reset was rejected after
checking the reducer, drawing and actual component interaction: resetting the
area would prevent the intended same-demand comparison. The added regression
confirms that supply, drawing and explanation change while area stays at 60%.
This review's finding is recorded as rejected, not as an accepted contribution.

The new additions were checked through source, component tests and build checks;
no new browser, real-device or assistive-technology session was performed for
this continuation. Earlier captures above cover the original experiments only.
