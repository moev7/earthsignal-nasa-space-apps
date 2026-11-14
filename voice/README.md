# Echo's neural voice

Kokoro 82M v1.0 int8, `af_heart`, CPU ONNX. This is neural speech synthesis,
not a language model generating scientific claims. Captions and next actions
remain deterministic. No browser voice, microphone, external voice provider or
private workspace data is used.

Only the finite reviewed `lib/echo-voice.json` cue bank can be narrated. New lines
must be reviewed, versioned and rendered before releasing the client. `render.py`
uses one ONNX thread and short clauses to bound vocoder activation memory. It
locks the output directory, checks finite samples/duration/cache size, writes
through an fsynced temporary file and atomically renames by a digest of model,
voice, speed, cue ID and exact text. The renderer exits after preparation.

The public `/api/echo-voice` route only reads these cached WAVs. It validates both
cue and version, admits at most six file reads, caps file size and returns a
caption-only 503 when audio is missing. User requests **never** start synthesis.
Browser playback requires an explicit Listen action, ducks ambience and fences
fetch/decode completion on mute, pause, replay, offscreen, hidden and unmount.

## Pinned host setup

Installed in the new isolated `/opt/earthsignal/voice-20261112` directory using
PyPI `uv==0.9.17`, managed CPython 3.13 and `kokoro-onnx==0.6.1`. System Python,
science virtual environments and existing resource caps were not changed.
Weights are from the official wrapper's `model-files-v1.0` release; first-download
SHA-256 values over HTTPS are pinned in `models.lock.json`. The model is Apache
2.0, the wrapper MIT. Notices are retained with the server installation.

Prepare the cache on the host, after copying `render.py`, `models.lock.json` and
`lib/echo-voice.json` into that directory:

```sh
systemd-run --unit=earthsignal-echo-render-v1 --wait --pipe --collect \
  -p MemoryMax=1024M -p MemorySwapMax=0 -p CPUQuota=75% \
  -p TasksMax=32 -p RuntimeMaxSec=900 -p Nice=10 \
  /opt/earthsignal/voice-20261112/venv/bin/python -u \
  /opt/earthsignal/voice-20261112/render.py \
  --catalog /opt/earthsignal/voice-20261112/echo-voice.json \
  --models /opt/earthsignal/voice-20261112/models \
  --cache /opt/earthsignal/voice-20261112/cache
```

The web process reads the default cache location above. Local preview can set
`EARTHSIGNAL_ECHO_CACHE` to a copied cache directory; missing speech leaves every
caption usable. Model weights/cache are excluded from Git and client bundles.
Do not add TTS dependencies to the science service or load a model in a web worker.

## Actual resource experiment, 12 November 2026

An initial longer sentence hit a 768 MiB cgroup cap. The bounded-clause renderer
then generated all 18 cues successfully: 3m59s wall, 2m59s CPU at 75% quota,
477.4 MiB cgroup peak, 536,004 KiB process maximum RSS, zero swap. The 88 MiB
model file is **not** a claim about runtime RAM. The model process exits after
rendering, so there is no idle inference process. This is a one-host measurement,
not a hardware-independent performance or listening-quality guarantee.

Primary references: [model](https://huggingface.co/hexgrad/Kokoro-82M),
[ONNX wrapper](https://github.com/thewh1teagle/kokoro-onnx),
[pinned model release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0).
