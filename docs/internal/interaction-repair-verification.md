# Interaction repair — 13 November 2026

Based on `278a20b`, preserving the deployed photography, speech and data work.

- Recorded accents carry clip identity. Repeated radar beats retain the current wash; a physical input transfers that clip rather than layering another. The ambient bed retains its existing generation guard. Narration duck state survives delayed bed creation and effect cleanup; collapse ducking ends when its voice ends.
- Radar and spacecraft use city-style left-drag orbit, right-drag/two-finger pan and pinch/wheel zoom, behind the explicit exploration gate. Adjacent zoom/reset buttons remain usable without entering pointer mode. Spacecraft orbit pivots on the hardware and portrait framing has sufficient zoom range. Rendering remains event-driven, without an idle camera clock.
- Disclosures retain canvas dimensions and hold the model pose. Summary anchoring and pin changes commit before paint. A quick open/close restores the prior story position, including across Pause/Resume. Reading down a long disclosure keeps the closed panel in normal flow until leaving/re-entering the chapter, avoiding an immediate re-pin jump. Wheel/touch scrolling is not intercepted.
- Shared body/caption tokens are 16/14px. Radar text and controls have owned inset padding; repeated primary chrome was consolidated without dropping the numeric model or provenance. Facts stack on narrow screens, output labels wrap, action groups retain spacing and touch targets. Wide game models stay alongside long control columns; narrow layouts retain normal page flow.

## Evidence

- `npm test`: 378/378 passed. `npm run typecheck`: passed. `npm run lint`: zero errors, 12 existing warnings outside the change. Production build/public bundle verifier passed; deployment packaging rebuilds the final commit.
- Actual OrbitControls mouse input is exercised by the spacecraft regression, including orbit, pan, model update/resize pose retention, gate and disposal. Sound fixtures exercise 20 repeated cues, held input transfer, late decode, mute/visibility/disposal and speech duck retention.
- Mounted disclosure tests cover no-scroll open/close, Pause/Resume while open, user scrolling during inspection, restoration of native pinning at the chapter start and listener/frame cleanup. The mounted fitter holds drawing height during expanded content.
- Browser checks used Chrome plus the shared preview: 375×667, 375×812 and 1366×768; all three closed story scenes admitted pinning at both phone sizes. Radar summary position stayed within one CSS pixel and drawing height stayed unchanged on open/close. Game station controls/readouts were inspected at phone/desktop sizes. `/explore`, `/compare`, `/about` and `/workspace` had no page-width overflow at 375px; the comparison's two-dimensional table retains its intentional internal horizontal scroll. Short landscape/reflow layouts release pinning rather than trapping a tall panel.
- Source review: OpenCode `opencode/glm-5.3-flash-free`, job `d2d44592a8d247f69ffa771fd13f3274`, read-only; no blockers in reviewed scope. Root verified the evidence and recorded acceptance. Later small inspection-state retention and guard cleanups have focused regression coverage.
- Chrome advice: Claude Sonnet 5.5 Medium informed region/group/item spacing; browser DeepSeek informed clip ownership/duck-state counterexamples. Gemini Argon High was selected and a technical question submitted, but the conversation disappeared before a reply; no Gemini advice is claimed. Claude's later clarification failed to send. Individual consultation receipts and resource gates are recorded in the existing team.

No physical iPhone/Safari or assistive-technology session was available. Responsive browser measurements are not claimed as physical-device verification. No radar math, measured bundles, masks, checksums, GUNW/GCOV units or Kokoro v2 narration text/cache changed.

## T3 continuation completed — 13 November 2026

The deployed `e40f77a` build contained the local scroll-height helper, but that helper's source file was omitted from its commit. This continuation publishes `lib/story-scroll.ts`, including the explicit per-layout reading clearance and the closed disclosure-height measurement already used by `StoryStage` and the viewport fitter. It preserves the implementation inspected in accepted OpenCode review `d2d44592a8d247f69ffa771fd13f3274`.

Added direct regressions for nested open disclosures (counted once), permanent controls with hidden summaries, closed panels, layout-bound fallback, nonnegative height, and explicit desktop clearance. All 380 web tests pass, including the mounted stage and fitter checks; TypeScript, scoped ESLint and production build pass. The package verifies 15 measured ground-motion files and 10 radar-study files. No additional design changes or browser/device claims are introduced by this source-completeness repair.

## Musical source correction — 13 November 2026

The user reported continuing overlap around the spacecraft/radar chapters. Both
`orbital-ambience.mp3` and `orbital-wash.mp3` derive from Heavenly Loop, so allowing
one of each still duplicates the music. Capture/found beats and phase input now
filter the existing continuous bed for 650 ms instead of decoding/starting the
wash. Water, ground-shift and collapse recordings remain independent foley.
Narration ducking remains authoritative during input, idle and scene cleanup.

The regression fails against the prior engine on the shared-source wash and
passes against the correction. It covers 20 alternating beats with phase input,
a late bed, filter restoration, narration ducking, material foley, mute/resume
and disposal. All 380 web tests, TypeScript, scoped ESLint and production build
pass. No new listening/device verification is claimed.
