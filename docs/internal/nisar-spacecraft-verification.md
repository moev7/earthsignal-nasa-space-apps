# Explorable NISAR spacecraft — 11 November 2026

The NISAR illustration now opens a local procedural spacecraft explorer. Four
hardware buttons highlight and frame the reflector, solar arrays, boom and radar
instruments. The original credited NASA/JPL artist’s concept remains the loading
and unavailable-3D fallback, and is available in the source disclosure.

The mesh reflector, rim and ribs, gold payload housing, solar-cell grid and
curved Earth context are schematic. Major hardware facts come from
[NASA/JPL quick facts](https://www.jpl.nasa.gov/press-kits/nisar/quick-facts/):
about a 12 m reflector, 9 m boom and two arrays just over 5.5 m each, together
providing about 5 kW. No CAD accuracy, live orbit, acquired imagery or new S-band
connection is implied. The connected Tehran result remains L-band.

“Send a radar pulse” sits beside the canvas, with an in-view phase label. It
starts one illustrative 2.4-second send/ground-echo/return sequence and frames
the full path. Manual steps provide equivalent still states. This shows
reflection, not displacement from one echo; the separate repeat-pass lesson
explains that comparison. Orbit requires explicit enablement, with native camera
buttons as keyboard alternatives.

## Verification

- All 328 root tests passed. The two focused spacecraft cases exercise actual
  component controls and real Three.js geometry through an injected renderer.
- Typecheck, scoped lint and production build passed. Root lint has zero errors
  and the same 12 existing warnings. Whitespace checks are clean.
- The release verifier checked all 14 frozen measured files, existing fonts and
  three credited story images. No new dependency or downloaded model was added.
- Fixtures cover finite completion, stale queued callbacks after cancellation,
  manual/animated exclusion, pause/reduced-motion/no automatic resume, replay,
  hidden/offscreen/closed ancestors, coalesced visibility events, context loss
  during initial view/drawing, stale module resolution, fresh canvases and
  exactly-once resource disposal. No idle animation runs.
- Per-part material ownership prevents one highlight recolouring other hardware.
  Signal actions return to an overview so ground echoes remain in frame.
- Static SVG/PNG exports of the actual geometry and camera states were inspected
  for overview, reflector, arrays and ground echo. These are geometry checks,
  not browser or WebGL screenshots.

The initial pooled Codex Sol job `d209d1b9a7eb4c4b9c332f0071b21879` hit quota
after saving partial work and was not accepted as a completed contribution.
The coordinator inspected the saved source, completed the in-view signal controls
and regression checks, and verified the integrated result. The original dependent
review never ran. A fresh due availability check recovered Grok; separate
independent critique `93afca592201431b8bc51384e38d2d03` timed out after
900 seconds without a report. Its saved stdout was empty; the error log showed
repeated reasoning-loop recovery. It supplies no accepted review evidence.
That attempt was not accepted. The final integrated teen-story/NISAR review
subsequently completed through the user-approved Antigravity T3 route, task
`earthsignal-teen-final-antigravity-review-20261111`, against commit `5760042`.
It reported no release blockers and passed 17 focused tests plus typecheck.
The coordinator inspected and accepted that bounded review; earlier failed
workers/reviewers retain their actual states. See the teen-story verification
record for provenance and device-testing limits.

Chrome Gemini Pro/Argon and browser DeepSeek informed the schematic and finite
animation design before implementation. Earlier Chrome Kimi/Claude advice covered
the fixed-choice hierarchy. Perplexity’s current Chrome pricing modal obstructed
input; hardware facts were verified directly from NASA/JPL. The proposed
single-pulse interferometric colour gradient was rejected.

Real-GPU rendering, mobile gestures and assistive-technology sessions were not
performed. Workflow metadata retains the failed writer and receipt gaps; no
completed work or timestamps were fabricated.
