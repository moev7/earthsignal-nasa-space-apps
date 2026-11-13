# Guided radar investigations — 14 November 2026

Continues the unfinished work on `codex/guided-radar-investigations-20261114`,
based on `c66dab2`. The native source processor and frozen observations were
already committed in `f8402ce`. This change completes the guided experience;
it does not introduce another scientific processing method or change a source
sample, mask, physics function, published revision, license or backend setting.

## Resulting experience

- Advanced tools opens with equally visible public-evidence and analyst routes.
  The question gallery precedes native processing controls. Worked examples
  prepare editable settings; they never auto-search, select acquisitions or
  submit a job. Reproduction links require an exact reviewed revision match.
- Native public study pages now mount the completed `StudyInspection` component.
  Image selection and keyboard row/column inputs inspect original cells; A/B
  pins provide a spatial contrast. Power ratios require a single calibrated
  backscatter observation in dB. Displacement, offset, change and raw-magnitude
  products do not inherit this interpretation.
- A native-row profile scans the entire bounded row and displays at most 512
  original sample positions, preserving missing gaps even between displayed
  positions. The CSV and numeric probe retain all native values. Display
  thinning is disclosed; no measurement interpolation is introduced.
- Public JSON briefs retain exact revision, source acquisitions, units, native
  coordinates, validity and limitations. User notes are labelled unverified;
  proposed checks are labelled not performed. Downloads stay local. Private
  results separately expose quantity-specific explanations, a local brief and
  an explicit refine/recheck action.
- Wide study pages keep the preview beside the sample controls. Narrow layouts
  use normal document flow, wrapping controls and 44px minimum interactive
  targets. Preview/export URLs are revoked and pending requests invalidated.
  Failed revision verification withholds the inspector rather than reusing
  measurements from a previous study.

## Verification and limits

The numerical and component suites cover null/zero preservation, affine centres,
10 dB → 10 power ratio, reciprocal contrast, overflow/underflow withholding,
source/product gates, full-row missing gaps, revision-bound presets, stale search
and plan responses, idempotency, account expiry, local exports and URL cleanup.
The public-page integration fixture uses actual shipped manifest/value/preview
bytes and exercises load → pin → corrupt revision → withhold → retry.

Accepted bounded implementation: pooled Codex `gpt-6.1-sol`, job
`d44779d1f91045b8a23ddd64cf8687a8`; only five assigned new inspection files.
Root independently read and tested the delivered files before acceptance.

Accepted independent read-only review: pooled Codex `gpt-6-luna`, job
`9cb13a606e8a4a26b406c9df67e402b3`. No reproducible P1/P2 issues in its assigned
scope; reviewer ran typecheck, 21 focused tests and the whitespace check. Root
additionally ran the full web suite and release build. Subsequent small edits
bound notes, add the actual-page regression and retain the existing workspace
format outside the intended integration lines.

Final command results are recorded in the completion handoff. Lint retains the
12 existing warnings outside these changes. DOM tests adapt `next/image`; they
do not certify real-device visual rendering or human comprehension. No fresh
scientific source processing or live collaborator workflow is claimed for this
UI change. No browser session was launched in this continuation.

The prior coordinator's current-revision adviser receipts remain in the owned
team: Kimi, Claude, DeepSeek and Perplexity informed the guided entry and quantity
boundaries. Its Gemini Argon attempt reset without a reply and is recorded as
unavailable, not a successful consultation.

The unrelated `.impeccable/design.json` edit is intentionally excluded.
