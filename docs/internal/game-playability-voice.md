# Playable missions and neural Echo — 12 November 2026

The optional game now puts the current action beside its world on desktop and
directly after it on phones. One next move replaces the expanded checklist.
Players collect the core finding through the experiment; deeper numerical and
evidence challenges remain available below it without blocking the next station.
The default scroll story and its sticky scenes remain the default experience.

## What changed

- Aquifer: pump and refill the same illustrated cross-section; see retained
  compaction before trying the optional seasonal supply puzzle.
- Street: compare equal and unequal movement, then inspect the pipe connection.
  The full invented 3D city remains available as an additional investigation.
- Radar: save the baseline, move the ground, capture the repeat, reveal the
  difference. One model supplies both the visual result and dossier telemetry.
  Its finite outgoing/returning signal shares existing motion cancellation.
  Phase ambiguity and transects remain optional challenges.
- Evidence: probe the actual verified motion raster and a missing patch. The
  uncertainty/footprint and Lake Mead backscatter investigations retain separate
  labels and units. A missing measurement never becomes zero.
- Policy: operate a new isometric city water network, including direct native
  button hotspots on the world. Monitoring adds an observation pass, not a
  physical improvement. The illustration estimates no recovery or policy rate.
- Echo derives the next action from actual station checkpoints and clears stale
  guidance on fresh experiments/replay. "Show me" targets the relevant control.
  Captions remain usable with all audio disabled.

## Voice and sound

Echo uses server-prepared Kokoro 82M int8 neural speech for 18 reviewed cues.
Only an explicit Listen action plays a cue. Pause, mute, replay, leaving the
world, hiding the page and disposal stop it; resuming does not restart speech.
Ambience ducks underneath narration. There is no browser OS speech fallback,
microphone, external speech API, public arbitrary-text synthesis or persistent
inference process. See [the host and resource notes](../../voice/README.md).

The recorded CC0 collapse stem now has more body and controlled dynamics; its
provenance and new hash are recorded in `story-audio-sources.json`. No arcade
oscillator effects were introduced.

## Adviser decisions and independent review

Chrome consultations with Kimi Instant High and Claude Sonnet 5.5 Medium informed
the direct manipulation, compact action dock and progressive extras. Gemini
Argon High was consulted after the user's correction, including one clarification
about server speech. Its finite pre-rendered cue bank and bounded CPU/memory
advice informed the actual implementation. This later timing is retained in the
team receipts; it is not represented as an earlier consultation.

Rejected suggestions included fabricated calibrated policy effects, confidence
gauges and a second radar viewing angle. Existing Perplexity/DeepSeek research
covered unchanged learning and numerical invariants; their explicit current-round
skips remain separate from fresh consultation contributions.

The bounded policy writer was pooled Codex Sol/high. The independent voice review
was pooled Codex Luna/medium; it found that a RIFF/WAVE marker alone did not prove
a valid cached file. The coordinator fixed that defect with full PCM/chunk/length
validation and a regression reproducing the malformed-file case.

## Verification

- Full Node suite: 377 passed, zero failures. Python renderer checks: 2 passed.
- Typecheck passed; lint: zero errors, 12 existing warnings. Production build
  passed, including frozen bundle, font, imagery and recorded-stem checks.
- Production browser playthrough completed all five discoveries and reached the
  field dossier with zero active worlds and five findings. The dossier retained
  actual synthetic radar telemetry and measured/missing Tehran probes separately.
- At 1366 × 768 the radar stage occupied y=236–710, its canvas y=278–602 and
  primary capture action y=403–451: model and control were visible together.
- At 390 × 844 the water model occupied y=279–650 and primary controls y=744–792;
  policy model/controls were also observed together. No horizontal overflow was
  observed in the five-station phone playthrough. Phone controls follow the world
  in normal page flow; there are no nested scrolling panels.
- Explicit production-preview Listen fetched the same-origin policy cue (253,036
  bytes, approximately 101 ms in that local run), stopped on Pause, and did not
  resume automatically. No speech request occurred before consent on the fresh
  water page. Unit tests cover delayed fetch/decode completion and provider cleanup.
- Preview screenshots inspected earlier in the run covered policy desktop/phone
  and radar. The final production screenshot tool timed out twice; final bounds
  and gameplay were checked with the shared preview DOM tools. This is not a
  physical iPhone/Safari, assistive-technology or listening-quality certification.

The maintained optional terminal browser script was updated for the new action
dock and optional challenges, but was not executed during this release: the
shared preview was used for browser acceptance.
