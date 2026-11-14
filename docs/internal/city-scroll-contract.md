# Optional city scroll control — implementation contract

Own ONLY `features/ground-truth/components/story/CityScene.tsx`,
`features/ground-truth/components/story/city3d/SinkingCity3D.tsx`, and
`tests/story-scroll-city.test.ts`. Other writers own the story/styles/missions.
Preserve their edits. No dependencies/network/browser/bridge/children.

Add optional `controlledProgress?: number` and `story?: boolean` to CityScene and
SinkingCity3D. Root passes progress only for the invented simulation. Defaults must
retain the current standalone behavior. Ignore external progress in measured mode;
its future remains the explicit existing project action. Normalize finite 0..1 to
simulation time 0..T_MAX. No second clock or world recreation on scroll. Parent
batches progress with RAF. Ignore external changes while paused, reduced-motion,
offscreen, or under manual override; reconcile latest on return/resume. Parent
keeps a still when reduced motion is requested; explicit scene sliders still work.

Any user play/seek/project/watchFall/orbit action takes manual authority. Scroll
must not overwrite it. Show a compact `Follow the story` button while overridden.
That button clears autonomous play/tween, returns the default camera as necessary
and applies the latest valid scroll progress. Do not silently drop manual control
on leaving the viewport. Reset/replay preserve existing pending visible replay
semantics; parent replay returns the active section to its beginning. Backward
scrubbing clears simulation debris/reset crossings, including returning to the
exact initial pose at0. Deterministic static setTime(false animation) is fine for
scroll; retain watchFall for full animated debris. Never call simulation methods
on measured world. Dispose/context loss/retry/offscreen behavior remains intact.

For `story=true`, retain all existing below-canvas controls/notes/options/scenario
inside native details class `es-city-story-controls`, summary `Explore this scene`.
Keep essential provenance and relative years visible outside. Also outside expose
one primary existing project button for measured mode (`If these rates continued`)
and watchFall for simulation (`Watch the collapse illustration`). Thus the major
future/collapse experiences stay prominent. Follow button remains visible outside
if possible. Default no-story controls stay as they were. Root styles unpin a
scene while its detail controls are open; no hidden functionality is removed.

Tests: meaningful authority/pause/reduced/offscreen/finite-progress transitions,
manual override and resume, backward state, unchanged no-prop scenes and existing
lifecycle checks. A pure helper may be exported from SinkingCity3D if necessary;
actual React control checks are preferable where feasible. No regex-only proof.

Recovery: original job6ab3127ee6ed44efafabdeecc1912f5d made no edits because its
/tmp contract vanished during interruption. This durable contract replaces it.
