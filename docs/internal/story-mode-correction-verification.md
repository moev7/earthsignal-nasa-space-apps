# Default story, optional investigation — 11 November 2026

The default `/` experience is the scroll-driven story. Its aquifer and city
scenes stay alongside the reading beats while normal, reversible scrolling
changes their still states. Reduced motion and short viewports retain a readable
non-sticky fallback. Opening secondary scene controls can unpin an enlarged
panel so it does not cover the narrative.

The five-clue investigation is an explicit `/?mode=game` alternative. Native
entry/exit links preserve the current chapter. No saved preference or mission
receipt can make the plain URL a game: the server selects the mode from the
explicit query, and the mission provider is mounted only in game mode. Points,
challenges, clue trail, case opening and case file are absent from the default
story. Existing progress remains available when the player returns to the game.

The NISAR overview now uses a broad planetary horizon and a wider camera frame.
Earth is much larger relative to the spacecraft, and the craft occupies less
than 65% of overview width in the tested landscape/portrait views. Part
inspection keeps its existing close-up framing. The signal path stays attached
to the same ground target. The display remains a schematic with simplified
spacecraft proportions, Earth distance and signal timing, not a shared physical
scale or live orbit.

## Verification

- All 334 root tests passed; typecheck and production build passed.
- The actual home component/server query is tested for default, explicit game,
  invalid and ambiguous mode values. Default has zero game UI; game has all five
  challenges and an exit to the story.
- A real StoryStage/AquiferExperiment fixture scrolls the SVG water surface down,
  reverses it, pauses it, exercises reduced-motion manual controls, and confirms
  a manual override lasts until “Follow the story”. Existing city authority,
  finite playback, mission persistence and spacecraft lifecycle checks pass.
- Real Three geometry fixtures check the broad Earth-to-spacecraft ratio,
  overview screen occupancy, portrait framing and retained pulse endpoints.
  A static SVG/PNG geometry export was visually inspected; it is not a WebGL
  browser screenshot.
- Local HTTP responses for `/` and `/?mode=game` confirmed distinct server-rendered
  modes, zero/five challenges, zero/one clue trail and working entry/exit hrefs.
- Frozen data, authentication and source labels are unchanged. No dependency,
  texture download or extra renderer loop was introduced.

Independent review and live deployment verification are recorded separately in
the release receipts. Real-device/GPU, assistive-technology and teen usability
sessions have not been performed.

The independent Antigravity T3 review
`earthsignal-default-story-review-20261111` passed all 18 focused tests and
confirmed the production mode/scroll/geometry implementation. It found one
workspace typecheck error in the ignored geometry-preview script: SVGRenderer
requires a THREE.Color argument. The coordinator applied that narrow fix and
reran typecheck successfully; no production source or broad tsconfig exclusion
was needed. This resolved finding is accepted with the review's device limits.
The report's ancillary ground-coordinate/storage-key descriptions are not
source authority; the unchanged model constants and existing store remain
authoritative.
