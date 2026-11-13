export type SoundCue =
  "water" | "capture" | "found" | "arrival" | "strain" | "collapse";
export const STORY_AUDIO = {
  ambience: "/audio/story/orbital-ambience.mp3",
  water: "/audio/story/water-flow.mp3",
  shift: "/audio/story/ground-shift.mp3",
  collapse: "/audio/story/collapse-materials.mp3",
  wash: "/audio/story/orbital-wash.mp3",
} as const;
type Clip = keyof typeof STORY_AUDIO;
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  lane: "bed" | "effect";
  clip: Clip;
  filter: BiquadFilterNode | null;
};

/** Recorded sustained ambience and material foley. No oscillator notes/jingles. */
export function createSoundscape(
  ctx: AudioContext,
  onError: () => void,
  load?: (url: string, signal: AbortSignal) => Promise<AudioBuffer>,
) {
  const abort = new AbortController(),
    cache = new Map<Clip, Promise<AudioBuffer>>(),
    voices = new Set<Voice>();
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  let audible = false,
    disposed = false,
    bedEpoch = 0,
    effectEpoch = 0,
    bed: Voice | null = null;
  let speaking = false;
  const bedLevel = () => speaking ? 0.055 : [...voices].some(v => v.clip === "collapse") ? 0.07 : 0.26;
  let musicCutoff = 12000;
  let releaseMusic: ReturnType<typeof setTimeout> | null = null;
  const syncBed = () => {
    if (!bed) return;
    bed.gain.gain.cancelScheduledValues(ctx.currentTime);
    bed.gain.gain.linearRampToValueAtTime(bedLevel(), ctx.currentTime + 0.12);
    if (bed.filter) {
      bed.filter.frequency.cancelScheduledValues(ctx.currentTime);
      bed.filter.frequency.linearRampToValueAtTime(musicCutoff, ctx.currentTime + 0.12);
    }
  };
  // The wash and ambience come from the same musical recording. Shape the
  // continuous bed for radar/spacecraft input; never start a second music stem.
  const resetMusic = () => {
    if (releaseMusic !== null) clearTimeout(releaseMusic);
    releaseMusic = null;
    musicCutoff = 12000;
    syncBed();
  };
  const shapeMusic = (cutoff: number) => {
    if (releaseMusic !== null) clearTimeout(releaseMusic);
    musicCutoff = cutoff;
    syncBed();
    releaseMusic = setTimeout(resetMusic, 650);
  };
  let gesture: Voice | null = null,
    gestureClip: Clip | null = null,
    gestureEpoch = 0,
    loadingGesture = false;
  let gestureState = {
    kind: "water" as "water" | "strain",
    value: 0,
  };
  let releaseGesture: ReturnType<typeof setTimeout> | null = null;
  const cancelGesture = () => {
    gestureEpoch++;
    loadingGesture = false;
    if (releaseGesture !== null) clearTimeout(releaseGesture);
    releaseGesture = null;
    if (gesture) stopVoice(gesture);
    gesture = null;
    gestureClip = null;
  };
  const buffer = (clip: Clip) => {
    let pending = cache.get(clip);
    if (!pending) {
      pending = (
        load
          ? load(STORY_AUDIO[clip], abort.signal)
          : fetch(STORY_AUDIO[clip], { signal: abort.signal })
              .then((response) => {
                if (!response.ok) throw Error("Audio unavailable");
                return response.arrayBuffer();
              })
              .then((bytes) => ctx.decodeAudioData(bytes))
      ).catch((error) => {
        cache.delete(clip);
        throw error;
      });
      cache.set(clip, pending);
    }
    return pending;
  };
  const stopVoice = (voice: Voice) => {
    try {
      voice.source.stop();
    } catch {}
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.filter?.disconnect();
    voices.delete(voice);
    if (voice === bed) bed = null;
    if (voice === gesture) gesture = null;
    syncBed();
  };
  const stopEffects = () => {
    resetMusic();
    cancelGesture();
    effectEpoch++;
    for (const voice of [...voices])
      if (voice.lane === "effect") stopVoice(voice);
    syncBed();
  };
  const stop = () => {
    resetMusic();
    cancelGesture();
    bedEpoch++;
    effectEpoch++;
    for (const voice of [...voices]) stopVoice(voice);
  };
  const voice = (audio: AudioBuffer, lane: Voice["lane"], level: number, clip: Clip) => {
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = audio;
    source.loop = lane === "bed";
    const filter =
      typeof ctx.createBiquadFilter === "function"
        ? ctx.createBiquadFilter()
        : null;
    if (filter) {
      filter.type = "lowpass";
      filter.frequency.value = 12000;
      source.connect(filter);
      filter.connect(gain);
    } else source.connect(gain);
    gain.connect(master);
    const item: Voice = { source, gain, lane, filter, clip };
    voices.add(item);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      filter?.disconnect();
      voices.delete(item);
      if (bed === item) bed = null;
      if (gesture === item) gesture = null;
      syncBed();
    };
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(
      level,
      ctx.currentTime + (lane === "bed" ? 1.4 : 0.04),
    );
    source.start();
    if (lane === "effect") {
      gain.gain.setValueAtTime(
        level,
        ctx.currentTime + Math.max(0.04, audio.duration - 0.3),
      );
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + audio.duration);
      source.stop(ctx.currentTime + audio.duration + 0.02);
    }
    return item;
  };
  const startBed = async () => {
    if (bed || !audible || disposed) return;
    const epoch = ++bedEpoch;
    try {
      const audio = await buffer("ambience");
      if (!audible || disposed || epoch !== bedEpoch) return;
      if (ctx.state !== "running") await ctx.resume();
      if (!audible || disposed || epoch !== bedEpoch || ctx.state !== "running")
        return;
      bed = voice(audio, "bed", bedLevel(), "ambience");
      if (bed.filter) bed.filter.frequency.value = musicCutoff;
    } catch {
      if (!disposed && audible && epoch === bedEpoch) onError();
    }
  };
  const setAudible = (next: boolean) => {
    if (disposed) return;
    audible = next;
    if (!next) stop();
    else void startBed();
  };
  const cue = async (kind: SoundCue, value = 0) => {
    if (!audible || disposed) return;
    if (kind === "arrival") {
      void startBed();
      return;
    }
    if (kind === "capture" || kind === "found") {
      shapeMusic(1800);
      return;
    }
    const clip: Clip =
      kind === "water"
        ? "water"
        : kind === "strain"
          ? "shift"
          : "collapse";
    // A story beat never layers or restarts a texture already audible.
    if ([...voices].some(v => v.clip === clip)) return;
    cancelGesture();
    const epoch = ++effectEpoch;
    try {
      const audio = await buffer(clip);
      if (
        !audible ||
        disposed ||
        epoch !== effectEpoch ||
        ctx.state !== "running"
      )
        return;
      if ([...voices].some(v => v.clip === clip)) return;
      const effects = [...voices].filter((v) => v.lane === "effect");
      if (effects.length >= 3) stopVoice(effects[0]);
      const level =
        kind === "collapse"
          ? 0.65
          : kind === "strain"
            ? 0.3 + Math.max(0, Math.min(30, value)) * 0.006
            : kind === "water"
              ? 0.55
              : 0.25;
      voice(audio, "effect", level, clip);
      syncBed();
    } catch {
      if (!disposed && audible && epoch === effectEpoch) onError();
    }
  };
  /** A held texture follows an action, then expires after650ms of stillness.
   * Water/material foley or filtering of the existing musical bed only.
   */
  const respond = async (
    kind: "water" | "strain" | "phase",
    intensity = 0,
    phase = 0,
  ) => {
    if (!audible || disposed || ctx.state !== "running") return;
    effectEpoch++; // New physical input invalidates any older decoding one-shot.
    const value = Number.isFinite(intensity)
      ? Math.max(0, Math.min(1, intensity))
      : 0;
    const wrapped = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
    if (kind === "phase") {
      cancelGesture();
      shapeMusic(260 + wrapped * 1000);
      return;
    }
    resetMusic();
    gestureState = { kind, value };
    const clip: Clip = kind === "water" ? "water" : "shift";
    if (gestureClip !== clip) {
      cancelGesture();
      gestureClip = clip;
    }
    const epoch = gestureEpoch;
    const tune = () => {
      if (!gesture) return;
      const { value } = gestureState;
      const level = 0.12 + value * 0.34;
      gesture.gain.gain.cancelScheduledValues(ctx.currentTime);
      gesture.gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.06);
      if (gesture.filter) {
        gesture.filter.frequency.cancelScheduledValues(ctx.currentTime);
        gesture.filter.frequency.linearRampToValueAtTime(
          220 + value * 2100,
          ctx.currentTime + 0.06,
        );
      }
      if (gesture.source.playbackRate) {
        gesture.source.playbackRate.cancelScheduledValues(ctx.currentTime);
        gesture.source.playbackRate.linearRampToValueAtTime(
          0.9 + value * 0.14,
          ctx.currentTime + 0.06,
        );
      }
    };
    if (releaseGesture !== null) clearTimeout(releaseGesture);
    releaseGesture = setTimeout(() => {
      if (epoch !== gestureEpoch) return;
      releaseGesture = null;
      const ending = gesture;
      gesture = null;
      gestureClip = null;
      gestureEpoch++;
      loadingGesture = false;
      if (ending) {
        ending.gain.gain.cancelScheduledValues(ctx.currentTime);
        ending.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
        try {
          ending.source.stop(ctx.currentTime + 0.11);
        } catch {}
      }
    }, 650);
    if (gesture) {
      tune();
      return;
    }
    if (loadingGesture) return;
    loadingGesture = true;
    try {
      const audio = await buffer(clip);
      if (
        disposed ||
        !audible ||
        epoch !== gestureEpoch ||
        ctx.state !== "running"
      )
        return;
      const effects = [...voices].filter((v) => v.lane === "effect");
      if (effects.length >= 3) stopVoice(effects[0]);
      // Transfer this clip from a story accent to the held physical input.
      for (const existing of [...voices]) if (existing.clip === clip) stopVoice(existing);
      gesture = voice(audio, "effect", 0.1, clip);
      tune();
    } catch {
      if (!disposed && audible && epoch === gestureEpoch) onError();
    } finally {
      if (epoch === gestureEpoch) loadingGesture = false;
    }
  };
  return {
    setAudible,
    duck: (next: boolean) => { speaking = next; syncBed(); },
    cue,
    respond,
    stopEffects,
    warm: () => {
      for (const key of ["water", "shift", "collapse"] as Clip[])
        void buffer(key).catch(() => {});
    },
    volume: (value: number) => {
      if (!disposed && Number.isFinite(value)) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(
          Math.max(0, Math.min(1, value)),
          ctx.currentTime,
        );
      }
    },
    dispose: () => {
      disposed = true;
      audible = false;
      stop();
      abort.abort();
      cache.clear();
      master.disconnect();
    },
  };
}
