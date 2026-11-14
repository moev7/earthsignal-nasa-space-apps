# Visual mission comparison — 11 November 2026

Replaces the six stacked mission essays in the radar LearningLab with a mission
picker, one interactive technique scene and an optional second mission in a
three-row comparison. Full instrument, technique, purpose and limitation records
remain in a disclosure. All six mission families remain selectable.

The appendix previously occupied the narrow text column alongside the radar
scene. It now sits below that grid and uses the story width. The comparison is
first; the duplicate full radar experiment and the deformation profile remain in
separate disclosures. No scientific dataset, private API or workspace changed.

## Visual and data contract

Radar, optical and paired gravity measurements have different manually controlled
schematics. The visitor changes ground height, land cover or stored water to see
the relevant mechanism. Diagrams are explicitly conceptual and exaggerated, not
acquired imagery or calculated measurements. There is no autoplay, added WebGL
context, dependency or remote asset. Global pause/reduced motion remove transitions;
Replay remounts the workbench into its initial selection and scene state.

Radar wavelength graphics use the same 0–48 cm axis. Approximate L/C wavelengths
are distinguished from image resolution and accuracy, and the NISAR plot explicitly
identifies its L-band channel. NASA NISAR, Copernicus Sentinel-1, JAXA PALSAR,
NASA Landsat OLI and NASA GRACE-FO references informed these descriptions. The ESA
ENVISAT mission link returned 403 to the research fetch; it was not bypassed.

NISAR connection status, sensor, provisional/validated state and observation period
come from the existing hash-verifying public bundle loader. Loading and failed
verification cannot claim a measured result. The absence of an S-band connection
follows the connected sensor record. Other missions describe reference capabilities
in this public comparison, rather than a live operational-fleet inventory or a
promise of connected measured results. Product-access notes remain distinct from
data availability in the story.

## Verification

- **322 root tests passed**, zero failed, skipped or cancelled.
- Typecheck and production build passed; all 14 frozen measured-file checks,
  existing fonts and three story images retained.
- Root lint: zero errors, 12 existing warnings. Scoped lint clean.
- Diff whitespace check passed.
- New actual-control tests switch all six missions, change and reset geometry,
  prevent duplicate comparison columns, show a single-mission view and exercise
  loading/ready/error states. Model tests change dates, status and sensor fields
  to catch hardcoded availability and verify common wavelength coordinates.

CUA inspected desktop and phone together at 1440×1000 and 390×844. The first
inspection exposed the inherited narrow-column placement. The fix moved the lab,
folded duplicate teaching material, identified NISAR's visualized channel and
kept mobile axis labels inside their SVGs. Phone document width was 390px; measured
rightmost labels stayed within their plots. The built standalone preview showed
1184px of lab width at a 1280px viewport, outside the old copy column, and its
optical control changed the diagram and accessible result.

Captures:
`/Users/amireza/.codex/visualizations/2026/11/09/01a1c1ab-417c-76b2-9f27-8c19d83b441b/mission-comparison/`.

Fresh read-only pooled Codex **gpt-6-luna** review
`d3b6cd77388c4d279b822bf8a91f055c` returned **ship**, with no material fixes.
The coordinator independently inspected and accepted it. The reviewer read scoped
source/tests and supplied captures; it did not run a browser or the test suite.
No new Impeccable suppressions were added. Existing large-chunk warnings remain.
Real-device and assistive-technology trials were not performed.
