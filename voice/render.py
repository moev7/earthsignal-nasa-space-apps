"""Operator-only Kokoro renderer. No listener, arbitrary public text or cloud calls.

Render the finite reviewed manifest before releasing the client; cache reads never
launch inference. Run under the checked-in systemd resource limits.
"""
import argparse
import gc
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import tempfile
import time
import wave

MAX_CHARS = 180
# The reviewed bank's longest sentence is 62 characters. Reject longer future
# sentences instead of silently cutting a phrase and resetting its prosody.
MAX_SENTENCE = 64
MAX_AUDIO_SECONDS = 22
MAX_CACHE_BYTES = 32 * 1024 * 1024


def cue_digest(catalog, cue):
    return hashlib.sha256("\n".join([catalog['version'], catalog['model'], catalog['voice'], catalog['speed'], cue, catalog['cues'][cue]]).encode()).hexdigest()


def chunks(text):
    """Synthesize whole sentences: a character budget must never end a phrase.

    Commas and semicolons stay with their surrounding sentence. A period inside
    a number is not followed by whitespace, so it is not a sentence boundary.
    This is a finite, reviewed English cue bank, not arbitrary public text.
    """
    return re.split(r'(?<=[.!?])\s+', ' '.join(text.split()))


def validate(catalog):
    assert set(catalog) == {'version', 'model', 'voice', 'speed', 'cues'}
    assert catalog['model'] == 'kokoro-v1.0.int8' and catalog['voice'] == 'af_heart'
    assert catalog['speed'] == '1.04'
    assert 1 <= len(catalog['cues']) <= 40
    for cue, text in catalog['cues'].items():
        assert re.fullmatch('[a-z]+(?:-[a-z]+)*', cue) and len(cue) < 48
        assert isinstance(text, str) and 0 < len(text) <= MAX_CHARS and text.isascii()
        assert all(len(p) <= MAX_SENTENCE for p in chunks(text)), 'Review or shorten the full sentence; never split it mid-phrase'


def render(catalog_path, model_dir, cache_dir):
    catalog = json.loads(Path(catalog_path).read_text()); validate(catalog)
    cache = Path(cache_dir); cache.mkdir(parents=True, exist_ok=True)
    pending = [(cue, cue_digest(catalog, cue)) for cue in catalog['cues'] if not (cache / (cue_digest(catalog, cue) + '.wav')).exists()]
    if not pending:
        print(json.dumps({'cached': len(catalog['cues']), 'generated': 0})); return
    lock_path = Path(__file__).with_name('models.lock.json')
    locked = json.loads(lock_path.read_text())
    for name, spec in locked.items():
        actual = hashlib.sha256((Path(model_dir) / name).read_bytes()).hexdigest()
        if actual != spec['sha256']: raise ValueError('Voice model hash mismatch')
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    opts = ort.SessionOptions(); opts.intra_op_num_threads = 1; opts.inter_op_num_threads = 1
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.enable_cpu_mem_arena = False; opts.enable_mem_pattern = False
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    session = ort.InferenceSession(str(Path(model_dir) / 'kokoro-v1.0.int8.onnx'), sess_options=opts, providers=['CPUExecutionProvider'])
    engine = Kokoro.from_session(session, str(Path(model_dir) / 'voices-v1.0.bin'))
    # Admit the longest sentence first so the cold resource peak is visible
    # before preparing the rest of the bank under the same cgroup limit.
    pending.sort(key=lambda item: max(map(len, chunks(catalog['cues'][item[0]]))), reverse=True)
    for cue, digest in pending:
        started = time.monotonic(); frames = []
        for part in chunks(catalog['cues'][cue]):
            audio, rate = engine.create(part, voice=catalog['voice'], speed=float(catalog['speed']), lang='en-us')
            if rate != 24000 or not np.isfinite(audio).all(): raise ValueError('Invalid synthesized audio')
            frames.append(np.clip(audio, -1, 1).astype(np.float32))
            frames.append(np.zeros(int(rate * .1), dtype=np.float32))
            del audio
            gc.collect()
        samples = np.concatenate(frames)
        if not 0.2 <= len(samples) / rate <= MAX_AUDIO_SECONDS: raise ValueError('Audio duration outside budget')
        peak = float(np.max(np.abs(samples)))
        if peak < .001: raise ValueError('Silent synthesis')
        # Peak headroom is deterministic; no unverified loudness/quality guarantee.
        samples *= min(2.0, .88 / peak)
        pcm = (samples * 32767).astype('<i2').tobytes()
        if sum(p.stat().st_size for p in cache.glob('*.wav')) + len(pcm) > MAX_CACHE_BYTES: raise ValueError('Cache budget exceeded')
        fd, tmp = tempfile.mkstemp(prefix='.render-', suffix='.wav', dir=cache)
        try:
            with os.fdopen(fd, 'wb') as raw:
                with wave.open(raw, 'wb') as output:
                    output.setnchannels(1); output.setsampwidth(2); output.setframerate(rate); output.writeframes(pcm)
                raw.flush(); os.fsync(raw.fileno())
            os.chmod(tmp, 0o644); os.replace(tmp, cache / (digest + '.wav'))
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
        print(json.dumps({'cue': cue, 'digest': digest, 'audio_seconds': len(samples)/rate, 'render_seconds': time.monotonic()-started, 'max_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}), flush=True)
        del samples, frames, pcm
        gc.collect()


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--catalog', required=True); p.add_argument('--models', required=True); p.add_argument('--cache', required=True)
    args = p.parse_args(); Path(args.cache).mkdir(parents=True, exist_ok=True)
    with open(Path(args.cache) / '.render.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        render(args.catalog, args.models, args.cache)
