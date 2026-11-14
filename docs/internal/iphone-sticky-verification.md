# iPhone mini sticky repair — 12 November 2026

The user's physical iPhone13mini/iOS18 report disproved the earlier assurance.
A390×844 desktop viewport was not physical-phone verification. This receipt
supersedes those earlier mobile claims. No access to the user's phone is claimed.

## Reproduced defects

At375×635 the deployed header wrapped to161px. Water372px, city496px and radar405px
all failed pin admission. A more-specific mobile city rule ignored the fitted
canvas-height variable. The fixed144px reading reserve also excluded otherwise
usable compact portrait layouts. Fit and admission depended on visualViewport,
so browser-bar changes could resize canvases and toggle pinning on reverse scroll.

## Repair

The375px header now stays101px high, retaining accessible home navigation. Final
scene selectors outrank the older mobile rules. All three scenes use the fitted
canvas budget. Fit and admission share a hidden CSS100svh probe outside chapters,
which remains stable as browser bars retract; genuine orientation and geometry
changes still recalculate. Compact reading clearance varies64–144px, with the
same value in sizing and admission. Expanded details explicitly release pinning,
and the chapter opts out of scroll anchoring. No renderer, data, game or audio
model was replaced.

Primary support: [WebKit Safari15.4 viewport units](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
and [MDN viewport lengths](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length).
These establish SVH support/stability, not physical-device correctness.

## Evidence and limits

350 root tests pass; updated production-component fixtures cover a stable635px
probe with visualViewport/innerHeight635→724→662→635, no canvas/pin/progress
change, exact bounded reversal, expanded controls, short landscape and cleanup.
TypeScript/build pass; lint0errors/12baselinewarnings.

Playwright WebKit27.2 and iOS18-era WebKit18.2 were exercised with iPhone13mini
preset and375×635 viewport. Both passed all3chapters' forward/reverse traversal;
WebKit18.2 also passed synthetic toolbar API changes, expanded/closed instruments,
landscape and reduced motion. Header101px; pinned top113px; water372px and city/
radar446px panels; no horizontal overflow. Full receipts and screenshot are under
output/playwright/sticky-webkit-18.2.{json,png}. Repro runner:
scripts/verify-story-sticky.mjs (uses an already installed official Playwright,
no runtime dependency/install in the app).

Older official Playwright1.49.1 downloaded WebKit18.2 but its Node26 extractor
stalled. Only that task-owned installer was stopped; its complete official ZIP
passed unzip CRC verification and was extracted into the ignored test-artifact
directory, then launched with the matching1.49.1driver. No security settings,
quarantine flags, accounts or approvals were bypassed. Modern CLI session closed.

The test runs macOS WebKit, not an iPhone's UIKit browser chrome/touch compositor.
Toolbar transitions are explicitly synthetic. Hardware rubber-banding, the user's
exact iOS18 minor version, LowPower/ReduceMotion settings and physical Safari
remain unverified. A cold lazy city can still need its first fit frame; the
repeat reverse checks wait for its actual layout, rather than claiming a cold
network timing test. Independent core review and live release hashes are saved
with outputs/releases evidence after acceptance/deployment.
