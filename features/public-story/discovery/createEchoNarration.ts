import catalog from "@/lib/echo-voice.json";
export type VoiceCue = keyof typeof catalog.cues;
export type VoiceState = "idle" | "loading" | "speaking" | "unavailable";
/** Reviewed, server-rendered Kokoro clips. No OS TTS, model, mic or arbitrary text. */
export function createEchoNarration(
  ctx: AudioContext,
  changed: (state: VoiceState) => void,
  load: typeof fetch = fetch,
) {
  let epoch = 0,
    disposed = false,
    controller: AbortController | null = null,
    node: AudioBufferSourceNode | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  gain.connect(ctx.destination);
  const stop = () => {
    epoch++;
    controller?.abort();
    controller = null;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {}
      node.disconnect();
      node = null;
    }
    if (!disposed) changed("idle");
  };
  const speak = async (cue: VoiceCue) => {
    stop();
    if (disposed || !Object.prototype.hasOwnProperty.call(catalog.cues, cue))
      return;
    const ticket = epoch;
    controller = new AbortController();
    const requestController = controller;
    const signal = requestController.signal;
    changed("loading");
    timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const response = await load(
        `/api/echo-voice?cue=${encodeURIComponent(cue)}&v=${catalog.version}`,
        { signal, credentials: "omit" },
      );
      if (!response.ok) throw Error("Voice unavailable");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 1_100_000) throw Error("Voice too large");
      if (disposed || ticket !== epoch || signal.aborted) return;
      const audio = await ctx.decodeAudioData(bytes);
      if (
        disposed ||
        ticket !== epoch ||
        signal.aborted ||
        ctx.state !== "running"
      )
        return;
      if (timeout) clearTimeout(timeout);
      timeout = null;
      node = ctx.createBufferSource();
      node.buffer = audio;
      node.connect(gain);
      const current = node;
      current.onended = () => {
        current.disconnect();
        if (ticket === epoch && !disposed) {
          node = null;
          changed("idle");
        }
      };
      current.start();
      changed("speaking");
    } catch {
      if (ticket === epoch && !disposed)
        changed(signal.aborted ? "idle" : "unavailable");
    } finally {
      if (ticket === epoch) {
        if (timeout) clearTimeout(timeout);
        timeout = null;
        controller = null;
      }
    }
  };
  return {
    speak,
    stop,
    volume: (value: number) => {
      gain.gain.value = Math.max(0, Math.min(1, value)) * 0.9;
    },
    dispose: () => {
      stop();
      disposed = true;
      gain.disconnect();
    },
  };
}
