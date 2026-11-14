import test from "node:test";
import assert from "node:assert/strict";
import { createEchoNarration } from "../features/public-story/discovery/createEchoNarration";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture() {
  const decoded: ReturnType<typeof deferred<AudioBuffer>>[] = [],
    sources: {
      started: boolean;
      stopped: boolean;
      onended: (() => void) | null;
      start: () => void;
      stop: () => void;
      connect: () => void;
      disconnect: () => void;
      buffer: unknown;
    }[] = [];
  const ctx = {
    state: "running",
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    decodeAudioData: () => {
      const d = deferred<AudioBuffer>();
      decoded.push(d);
      return d.promise;
    },
    createBufferSource: () => {
      const n = {
        started: false,
        stopped: false,
        onended: null as (() => void) | null,
        buffer: null as unknown,
        connect() {},
        disconnect() {},
        start() {
          n.started = true;
        },
        stop() {
          n.stopped = true;
        },
      };
      sources.push(n);
      return n;
    },
  };
  const requests: { url: string; signal: AbortSignal }[] = [],
    states: string[] = [];
  const load = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), signal: init!.signal as AbortSignal });
    assert.equal(init!.credentials, "omit");
    return new Response(new Uint8Array(44));
  }) as typeof fetch;
  const voice = createEchoNarration(
    ctx as unknown as AudioContext,
    (s) => states.push(s),
    load,
  );
  return { voice, ctx, decoded, sources, requests, states };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test("neural narration never autoplays and cancelled/late decodes cannot resurrect old speech", async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  const old = f.voice.speak("radar-first");
  await flush();
  assert.equal(f.decoded.length, 1);
  f.voice.stop();
  assert.equal(f.requests[0].signal.aborted, true);
  const next = f.voice.speak("radar-repeat");
  await flush();
  assert.equal(f.decoded.length, 2);
  f.decoded[0].resolve({} as AudioBuffer);
  await old;
  assert.equal(f.sources.length, 0);
  f.decoded[1].resolve({} as AudioBuffer);
  await next;
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].started, true);
  const ended = f.sources[0].onended;
  f.voice.stop();
  assert.equal(f.sources[0].stopped, true);
  ended?.();
  assert.equal(f.states.at(-1), "idle");
  const pending = f.voice.speak("water-draw");
  await flush();
  f.voice.dispose();
  f.decoded[2].resolve({} as AudioBuffer);
  await pending;
  assert.equal(f.sources.length, 1);
  assert.ok(f.requests.every((r) => r.url.startsWith("/api/echo-voice?cue=")));
});
test("missing server voice is caption-only; unknown cues cause no request and no device TTS fallback", async () => {
  const f = fixture();
  await f.voice.speak("../private" as never);
  assert.equal(f.requests.length, 0);
  f.voice.dispose();
  const states: string[] = [];
  const v = createEchoNarration(
    f.ctx as unknown as AudioContext,
    (s) => states.push(s),
    (async () => new Response("", { status: 503 })) as typeof fetch,
  );
  await v.speak("welcome");
  assert.equal(states.at(-1), "unavailable");
  assert.equal(f.sources.length, 0);
  v.dispose();
});
