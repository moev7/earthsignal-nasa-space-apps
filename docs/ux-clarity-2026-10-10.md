# A clearer Place & question workspace

The 2026-10-10 refinement replaces competing launch panels with three steps: **Place → Question → Dates**, then **Explore changes**. It uses Earthsignal’s existing charcoal panels, lime actions and restrained typography. No result-like story appears before there are recorded measurements.

## What changed

- A single setup group is visible at a time. Place search, examples and drawing remain available; uploads and coordinates are optional details. Questions use ordinary language with an explanation of their scope.
- The desktop form scrolls independently while its next action stays visible. Mobile uses the normal page flow, with a direct map link. All four domains remain available.
- Completed results begin with **In simple terms**: measured change, what it means, what cannot be established, and the next useful check. Coverage is described as usable observations on both dates. Original values, counts, grids and scientific wording remain in source disclosures and exports.
- The former radar-first/story hero is replaced by an optional existing-comparison selector. Choosing a completed comparison remains explicit. Applying its area/dates remains a separate action. Differing radar/environmental contexts receive a visible warning.
- Scientific comparison, evidence, measurements, rasters, history, forecasts, scenarios and provenance remain accessible. Links into collapsed sections open the target and its ancestor disclosures.
- Editing the area, question, dates, source selection or water station marks a new draft. The recorded result retains its settings; restoring it also restores its source/station controls.
- Per-finding Gemini science help uses approved public blocks for the relevant subject. It retains payload preview and explicit consent. Private results/areas/notes are not added to requests. Explanation JSON retains the existing single `PlainResult` format plus public references.
- Print/PDF, investigation/manifest exports, snapshots, saved jobs, cancellation, source records and scientific-explorer navigation remain available.

## Verification

- Full web suite: **117 passed, 0 failed**. Includes numerical interpretation, public-AI payload, forecast/expired-estimate, ownership and geometry contracts; new checks cover source/station draft mismatch and an empty setup that must not look like a result.
- TypeScript and production build passed. Build retains the existing bundle-size advisory.
- Local desktop and 390 px mobile inspection found a below-fold next action; corrected with a separately scrolling desktop form body. No horizontal document overflow at the inspected mobile width.
- Impeccable detector run once: legacy side-accent/font warnings. Active result cards override old category accents. The incumbent typeface is intentionally retained to match the existing scientific workspace.
- Backend worker, numerical methods, source adapters, authentication, quotas and database contracts were not changed. No new classification or forecast capability is claimed.

## Consultation and participation record

Coordinator: `chat-01a11cd9-1293-7521-9e28-8475325b6ae8`; dedicated team `earthsignal-clear-ux-20261010`, implementation revision 1, final deployment checkpoint revision 2, epoch 1. It does not adopt another chat’s research team.

- Codex `gpt-6.1-sol` High builder `d49fa884d0b74477bfac428a398beff8`: disjoint EnvironmentalStory presentation only; independently inspected and accepted by coordinator. The integrated Gemini/export/draft changes belong to the coordinator, not the builder.
- Codex checker jobs `d9a7ddc6b4d741d4a473cd99ce95e723` and `55e40e0352344d44ae161648b63a8a27`: interrupted before inference, no review returned. Startup heartbeat failure persisted despite a recovered live dispatcher; no provider switch or third unchanged launch. **Integrated independent code review remains unavailable.**
- [Claude design consultation](https://claude.ai/chat/d5c36413-9e61-41af-a596-9d8ee0e4bbed), Free / Sonnet 5.5 Medium: accepted persistent recorded-result attribution, three-stage setup and meaning/limits/next. Rejected wording suggesting a new job updates an immutable saved result. Mobile suggestions adapted to incumbent map/result links.
- Kimi Academic Data: actual capacity/subscription gate; no returned scholar result. [Existing gate record](research/academic-data-2026-10-10/REPORT.md). No unchanged retry/purchase.
- Perplexity and browser DeepSeek: concrete skips for a fully specified UI refinement with no new source or algorithm claim. No completed earlier browser answer is claimed in this release.
- Gemini CLI: actual earlier 403 eligibility gate; no retry/rotation. Cursor/Grok/DeepSeek Harness: no distinct useful assignment for this bounded UI refinement; none counted as contributions.

Coverage inspected before delivery. Initial browser receipt metadata used the wrong schema; corrected receipts were appended without deleting history or backdating. The audit retains invalid/late-receipt and missing independent-check flags; **coverage is not green**. These limitations are retained rather than replaced with invented reviews.

Final coverage inspection also reports incomplete workflow/time ordering. Three role-context messages remain unread after workers ended or failed to start. There are no outstanding jobs or pending reviews. The coordinator cannot acknowledge messages on a worker's behalf; the team remains open rather than claiming a fully verified handoff.

The deployment checkpoint advances the metadata revision; its current participation plan explicitly carries forward the earlier assignments without re-accepting or backdating them. Coverage at revision 2 reports historical acceptance and missing current receipts/jobs, plus incomplete workflow. This is not new contributor work or a green audit.

## Remaining validation

This is a reversible UI refinement, not a completed comprehension or operational reliability study. The planned representative-user sessions, 80% task-completion target and full WCAG 2.2 AA audit remain unperformed. Scientists’ source/method records stay available; satellite proxy changes still do not establish deforestation, flood danger, damage or causes on their own.

## Production confirmation

Activated `20261010T145446Z-45635ea` on `nasa.r8volt.com`; previous release `20261010-environment-27c56ba` retained. Local auth health passed; systemd active, 106,586,112 bytes current web memory under the unchanged 201,326,592-byte limit. This is a point-in-time check, not a concurrent load test.

Live confirmation used existing saved results, with no processing submissions or Gemini inference calls:
- Reload shows the three setup steps and no empty result story.
- Selecting the recorded water result restores its 2021–2025 request window, source and station. Native date editing and unchecking the source both show the new-draft warning; Restore returns the original controls.
- In simple terms exposes meaning, limits and next checks. Its link to measurements opens the closed analysis ancestor and reveals the exact table/history and withheld forecast records.
- Gemini preview contains only the reviewed public question/explanation blocks, with unchecked consent and disabled submit. It does not contain the job's value, geometry, station ID or artifacts.
- Selecting the prepared radar comparison retains 1.0002 km², 93.34% usable coverage and the original 2026-06-26/2026-09-30 dates; a differing-context warning is visible beside its explanation. Selection does not submit processing.
- Live wording inspection found a duplicated article in a jargon substitution; corrected in the final release.

Final release `20261010T150406Z-1379400` activated successfully after a fresh SSH connection (the first connection timed out waiting for authentication). Auth health passed; systemd reported active with 43,511,808 bytes current web memory, retaining the 201,326,592-byte limit. Previous release `20261010T145446Z-45635ea` is retained for rollback. A fresh production reload confirmed the guided setup and matching charcoal/lime layout. GitHub contains both implementation commits.

Live mobile result inspection used an actual 390 × 844 viewport; document width was 390 px with no horizontal page overflow. Local proof images are retained under `outputs/ux-clarity/`, without publishing private-result screenshots to GitHub.

Scientific storage/jobs are preserved by the web-only atomic deployment. Existing numerical/source behavior is unchanged. Rollback remains the prior release symlink and service restart.

## Native dropdown contrast correction

The reported place/question menus inherited pale text while their OS popup stayed white. Native selects now request a light popup and give options/option groups explicit dark text on white; closed controls retain their existing dark colors. The rule also covers radar, history and public-science question menus. Native keyboard selection of a place and a question was checked, and DOM-resolved option colors were checked on desktop and at an actual 390 px width (no horizontal document overflow). Production build and diff checks pass. This small CSS-only correction was handled directly; no scientific or selection logic changed. Page screenshots do not capture the OS popup, so the contrast check uses its resolved option styles rather than claiming a photographed native menu.

Deployed `20261010T151820Z-11c2a2c`; auth health passed and the previous release is retained. Fresh live inspection confirms #202224 option text on #ffffff (15.96:1 contrast), with pale text retained on closed dark controls. Local development remains available at port 5173. Source and deployment notes are pushed to the private repository.

Follow-up spacing correction: single-value native selects use a 16 px chevron inset 14 px from the edge, 44 px text-end padding and an inset focus outline. Guided setup labels have a 12 px gap and selects are 48 px tall. The desktop scrolling body reserves an additional 8 px so overlay scrollbars cannot cover the control edge. Desktop focused-control inspection confirms a complete outline; 390 px inspection confirms the same spacing and no horizontal page overflow. Native menus, option contrast and selection contracts are retained, with a native-arrow fallback for forced-color mode.

Spacing correction deployed as `20261010T162227Z-a097197`; local auth health passed, web service active under the unchanged memory limit, previous contrast-fix release retained. Fresh production inspection confirms the corrected focused control. Build and diff checks passed; no new mathematical or job changes.

## Dark workspace menus and repository introduction

The guided place, question, radar and public-science menus now reuse the Scientific Explorer's Radix select. Their open popups use charcoal, pale text and lime/olive selection styling, with an inset chevron and a separate highlighted selection indicator. Remaining native pickers request a dark color scheme and explicit dark option colors. This supersedes the earlier white native-popup workaround; the primary setup popups are now rendered by the application rather than relying on OS option styling.

Existing selection callbacks and AI privacy/consent boundaries are retained. Local checks confirmed place selection updates the area, question selection updates the summary and helper text, and clearing the public-science question disables payload preview. At 390 × 844, document width is 390 px; the open question menu fits inside the viewport (left 28, right 361) and has an actual rgb(39, 41, 43) background. Escape returns DOM focus to the question trigger. The accessibility snapshot occasionally lagged the DOM after keyboard input; callback confirmation used the visible selected label and corresponding summary rather than assuming a keystroke succeeded.

Verification: existing web tests 117/117 passed; TypeScript, production build and diff checks passed. Existing asset-resolution and bundle-size advisories remain. No new science processing or Gemini inference was submitted. Full comprehension/accessibility studies remain outstanding.

README presentation is being refreshed around the current Place → Question → Dates flow, plain-language results and a fresh live setup capture, with detailed methods and status retained in expandable sections. Repository description is updated; privacy and ownership remain unchanged.

Bounded README delegate `fea4ab57f5e4422592bfafc41df0cfcb` failed at startup before inference (heartbeat lost; no provider/model or execution history). No partial README edits existed; the coordinator took ownership and completed the edit. This is not an accepted contribution. No unchanged retry or provider rotation was attempted. Browser-adviser skips apply to this fully specified styling/documentation follow-up with no new scientific or architecture claim. Global bridge coverage was inspected; it reports activity only and does not establish a green project audit.

## Continuation: science-question alignment

The previous continuation left the dark-menu implementation committed but not activated, and the README refresh uncommitted with a missing setup screenshot. The reported science-guide offset reproduces in production: the workspace's generic label rule adds 16 px of bottom margin, so the review button aligns below the question control. The guide now resets the question label and Radix trigger margins locally. The trigger retains a 48 px height and its existing dark popup; scientific calculations, selection callbacks and per-call consent are unchanged.

Local native-browser checks confirm equal trigger/button top and bottom coordinates at 1280 px, both 48 px high. At 390 px they stack at equal 296 px widths with a 12 px gap, and the document width remains 390 px. Selecting the coverage question opens the public-only review; consent starts unchecked and submission remains disabled. TypeScript and the production build pass. Existing build advisories remain. No science processing or Gemini inference was submitted.

A bounded read-only Codex routine review (`d12cb6328aec44668dcadf20f472bb46`) stopped before inference with a lost startup heartbeat; no independent review or provider contribution is claimed, and no unchanged retry was launched. Bridge health used the installed Python 3.14 runtime after the system Python lacked `tomllib`. Global coverage was inspected; it does not certify this continuation. Each of Kimi, Perplexity, browser DeepSeek and Claude is skipped for this fully specified margin correction and completion of the inherited documentation, with no new source, scientific-method or architecture decision. The earlier substantial UX consultation and its limits remain recorded above. Deployment and the final README asset checks follow below.

Activated `20261010T164509Z-cdaec29`, retaining `20261010T162227Z-a097197` for rollback. The local session health check and nginx configuration test pass; web, API and worker are active. The unchanged web memory limit is 201,326,592 bytes. Fresh production checks with the science disclosure confirmed open show aligned 48 px desktop controls and, at 390 px, equal 296 px widths with a 12 px vertical gap and no horizontal document overflow. Live screenshots sometimes failed at the preview client; DOM measurements and the successful desktop capture are separate evidence. Existing science jobs/results, authentication and per-call approvals were not changed.

The full web suite passes 117/117 in this continuation. README completion includes a genuine production question-menu capture, cropped to exclude account information and saved-result panels. All 32 relative Markdown targets exist, five image targets resolve, expandable sections balance, and GitHub's Markdown API renders the refresh. Repository description/homepage/private visibility already match the prior continuation; they were verified without changing visibility or grants. Publication and CI results are recorded separately rather than assumed here.

## Exact study rectangles — 16 October 2026

The Place step now offers **Choose your own area → Enter a rectangle** with
separate west/south/east/north fields. People can select an exact area using a
keyboard without drawing or writing GeoJSON. Editing keeps the selected map
boundary intact; **Use this rectangle** (or Enter in a coordinate field) applies
it explicitly. Reset restores the selected bounds. Applying replaces any holes
or irregular boundary with the rectangle, as disclosed beside the action.

Signed decimal degrees retain the selected numerical coordinates without display
rounding. The editor uses the existing longitude ±180° and latitude ±85° limits,
rejects blank/reversed/degenerate inputs and rectangles at least 180° wide, and
does not silently sort coordinates or wrap across the date line. Existing
GeoJSON/drawing tools retain their broader geometry support. Server validation
and processing budgets remain authoritative; selecting a valid boundary does
not establish that observations or enough processing capacity exist for it.

All four inputs have stable labels, linked errors and visible focus. Failed
application focuses the first invalid field; successful application preserves
keyboard focus. Replacing the selected geometry, even with another polygon
having identical outer bounds, discards the old coordinate draft. Account
changes discard it as well. Nothing is stored in browser persistence or sent
to a new service, and the editor itself submits no processing job.

This local continuation uses its own team
`earthsignal-workflow-continuation-20261016`, owner
`t3-0b65205c-continuation-20261016`, epoch1, with work assigned at revision1
and the final status checkpoint at revision2. It does not adopt the
separate scientific-build team's ownership or narrow its outstanding E1–E6
goal. Accepted Codex Luna scout `34a34937702e435fb90b77063e6e9263` identified
the keyboard-entry opportunity. Accepted Sol reviewer
`fce014708c464f5695122f5be555457a` reproduced stale same-bounds drafts,
exponent-notation initialization and thin-edge admission issues. Coordinator
fixes address all three. Accepted Luna follow-up
`4637fa0562514fc58758e04aa840dd21` checked the fixes, six focused tests, strict
types and three existing server geometry tests. All reviews are scoped software
evidence, not field or human-study validation.

The full frontend suite passes **225/225**; TypeScript and the production build
pass. New modules pass scoped ESLint. Linting the integration file still reports
the existing `currentSearchIdentity.current` assignment during render and unused
`QUESTION_LABELS`, both present in the baseline. Browser checks confirm exact
GeoJSON, explicit application, error focus/descriptions, reset, keyboard order,
same-bounds geometry changes, preservation of holes until application, repeat
application of `0.0000001` and identity reset. At 1366, 390 and 320 px, document
width matches the viewport; coordinate controls remain inside it and exceed
44 px high. Actual mobile and desktop images were visually inspected. This is
not a complete screen-reader or WCAG conformance study.

The shared preview loaded the application but became intermittent. Kimi
snapshot/evaluation timed out twice; Claude and DeepSeek redirected to login;
Perplexity displayed a challenge page followed by a lost automation host.
Individual gates and the nine-surface plan are recorded; no adviser reply is
claimed. Local browser verification used an isolated Playwright CLI session
after the shared preview failures. Screenshots are ignored local QA artifacts
under `output/playwright/`.

Coverage metadata is not a green workflow certificate: the coordinator wrote
the feature directly, one progress receipt used an unsupported `build` stage,
and formal adviser receipts were added after the earlier inspected gates.
Those records and ordering warnings are preserved. Actual accepted jobs,
deterministic checks and browser evidence are recorded separately above.
No deployment or remote publication is performed in this continuation.
