# Optional investigation: mission deck and Echo

The regular `/` experience remains the sticky scroll story. `/?mode=game` explicitly opens the alternate investigation. This supersedes the earlier article-shaped game UI; the same five scientific graders and local once-only receipts remain in use.

The game has a code-native illustrated field-station map, short Echo transmissions, one active mission world, optional prediction cards, progressive manual hints, contextual attempt expressions, a visible evidence pocket and a final case file. The existing aquifer, city, synthetic radar, spacecraft and Tokyo-history components supply the worlds. The orbital station switches between the spacecraft and radar, mounting one tool at a time. There is one playable radar model and its actual state feeds the challenge. Photographs retain their source/credit disclosures. The field map is schematic, not a geographic or measured map.

`GameDirector` owns chapter selection. Native header/map controls use the same navigation action; browser hash/popstate events only read the URL. SSR and first hydration render the opening, then recognize a valid mission hash. Explicit navigation focuses the new heading. Sources remain mounted. The case-file chapter has working previous/next controls. Echo can be hidden/restored, is reachable through the sticky “Ask Echo” control, and supplies three increasingly specific hints without timers, score penalties or automatic interruptions. The guide occupies a reserved desktop rail and an in-flow mobile panel. Narrow navigation wraps rather than putting the new help control over the mission nodes.

Replay remounts the current world, form and hints while retaining collected findings. Reset rotates the existing progress generation and clears findings and ephemeral state. No new persistence keys, dependencies or network progress submission were introduced. Navigation/reward/companion motion is finite and uses the existing pause, reduced-motion, visibility and offscreen cancellation mechanism. Aquifer playback reuses the existing finite chapter clock, with manual still states during pause/reduced motion.

## Evidence

- Full root suite: **335 passed**, zero failed/skipped/cancelled. Typecheck and production build passed. Root lint: zero errors, the same 12 existing warnings; none in new game code. Subsequent header/map-ID/mobile CSS refinements received focused checks; final release build reruns packaging verification.
- `tests/game-deck.test.ts` mounts the actual PublicStory under StrictMode, including the header, director, guide, real challenge components and radar numeric model. It covers direct mission entry, one active world, header/trail/map/history-event selection, heading focus, hint ladder/cap/hide/restore, actual radar solve, receipt idempotency, fresh model on revisit, paused/manual/reduced states, replay, reset, case-file navigation and observer/listener/frame cleanup. Offscreen Three scenes are deliberately not constructed in this DOM fixture.
- Existing tests still verify all five graders, finite animation cancellation, radar/spacecraft Three geometry/resource lifecycle, default-story aquifer scroll/reversal/manual override and measured-city scroll authority.
- No live GPU, responsive browser screenshot, screen-reader or moderated teen playtest is claimed. DOM/state/scene-graph tests cannot establish visual rendering quality or learning efficacy.

## Consultation decisions

All five replies were inspected in the user's open Chrome, preserving profile and account. No project files were uploaded.

- [Kimi, Instant High](https://www.kimi.ai/chat/1a1c97d8-9732-8bad-8000-09e376296ad7?chat_enter_method=home): adopted a coherent mystery and distinct verbs. Used a schematic field-station map rather than inventing geographic/measurement evidence.
- [Claude, Free Sonnet 5.5 Medium Chat](https://claude.ai/chat/8672914a-51b3-4856-98ef-87c8418f0f56): adopted focused world, reserved rail/mobile flow, prediction and finite evidence rewards. Rejected numeric “confidence” inferred from collected points and idle animation loops.
- [Gemini, visible Argon](https://gemini.google.com/u/2/app/3e456069e5dcbff2): adopted one navigation source, hydration-safe routing and separate replay/reset semantics. Retained the existing disposed demand-rendered scenes instead of a broad shared-renderer rewrite.
- [DeepSeek, ordinary chat](https://chat.deepseek.com/a/chat/s/85e7cfd4-4075-4dee-990f-7c7a6da34767): used stale radar/route/reset counterexamples for tests. Rejected the suggestion to erase receipts on replay; only reset does that.
- [Perplexity, Free Search](https://www.perplexity.ai/session/b24c069c-13a5-473e-a232-ccdda5e1de22): primary W3C guidance checked directly. Focused tasks and controllable hints are design applications, not demonstrated learning effects. No unverified gamification meta-analysis claim was used.

Primary checks: [W3C manageable quantity](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p03-manageable-quantity/) and [W3C animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). The independent review and actual deployment receipt are recorded after they occur.

## Independent release review

T3 Antigravity review `earthsignal-immersive-game-review-20261111` completed on 2026-11-11 at 07:43:31 UTC with **ACCEPT**, no release blockers. Requested model was `gemini-3.8-flash-medium`; T3's separate executed-model metadata was null. It reviewed source commit `baf79746ca8fcb051d0c99bd8cb66d3b41adf097`, reran the six focused suites (**18 passed**) and typecheck (**passed**), and made no source changes. The coordinator inspected the actual final report and checked it against the implementation and existing parent evidence. This is an external T3 review, not an accepted native bridge job. Live GPU, assistive-technology and teen playtest limits remain as stated above.
