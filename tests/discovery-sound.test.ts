import test from "node:test";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import {
  createSoundscape,
  STORY_AUDIO,
} from "../features/public-story/discovery/createSoundscape";

function audioFixture() {
  const sources: Array<{
    buffer: AudioBuffer | null;
    loop: boolean;
    started: boolean;
    stopped: boolean;
    disconnected: boolean;
    onended: (() => void) | null;
    connect: () => void;
    disconnect: () => void;
    start: () => void;
    stop: (at?: number) => void;
  }> = [];
  const gains: Array<{
    gain: {
      value: number;
      cancelScheduledValues: () => void;
      setValueAtTime: (value: number) => void;
      linearRampToValueAtTime: (value: number) => void;
    };
    connect: () => void;
    disconnect: () => void;
  }> = [];
  const resumes: Array<() => void> = [];
  let closed = 0,
    made = 0;
  class Audio {
    state = "suspended";
    currentTime = 0;
    destination = {};
    constructor() {
      made++;
    }
    resume() {
      return new Promise<void>((resolve) =>
        resumes.push(() => {
          this.state = "running";
          resolve();
        }),
      );
    }
    suspend() {
      this.state = "suspended";
      return Promise.resolve();
    }
    close() {
      closed++;
      this.state = "closed";
      return Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve({ duration: 6 } as AudioBuffer);
    }
    createOscillator() {
      throw Error("Arcade oscillator notes are forbidden in this soundscape");
    }
    createGain() {
      const item = {
        gain: {
          value: 0,
          cancelScheduledValues() {},
          setValueAtTime(value: number) {
            this.value = value;
          },
          linearRampToValueAtTime(value: number) {
            this.value = value;
          },
        },
        connect() {},
        disconnect() {},
      };
      gains.push(item);
      return item;
    }
    createBufferSource() {
      const item = {
        buffer: null as AudioBuffer | null,
        loop: false,
        started: false,
        stopped: false,
        disconnected: false,
        onended: null as (() => void) | null,
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
        start() {
          assert.equal(this.started, false);
          this.started = true;
        },
        stop(at?: number) {
          assert.equal(this.started, true, "Web Audio stop must follow start");
          if (at === undefined || at <= 0) this.stopped = true;
        },
      };
      sources.push(item);
      return item;
    }
  }
  return {
    Audio,
    sources,
    gains,
    resumes,
    get closed() {
      return closed;
    },
    get made() {
      return made;
    },
  };
}
const ticks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("reactive recorded textures reuse a voice, follow the latest gain/filter state and fence late decode on scene exit", async () => {
  const fixture = audioFixture(),
    ctx = new fixture.Audio();
  ctx.state = "running";
  const filters: Array<{
    frequency: {
      value: number;
      cancelScheduledValues: () => void;
      linearRampToValueAtTime: (v: number) => void;
    };
    type: string;
    connect: () => void;
    disconnect: () => void;
  }> = [];
  const context = Object.assign(ctx, {
    createBiquadFilter() {
      const f = {
        frequency: {
          value: 0,
          cancelScheduledValues() {},
          linearRampToValueAtTime(v: number) {
            this.value = v;
          },
        },
        type: "lowpass",
        connect() {},
        disconnect() {},
      };
      filters.push(f);
      return f;
    },
  });
  const pending = new Map<string, (b: AudioBuffer) => void>();
  const engine = createSoundscape(
    context as unknown as AudioContext,
    () => assert.fail("unexpected audio error"),
    async (url) => new Promise((resolve) => pending.set(url, resolve)),
  );
  engine.setAudible(true);
  pending.get(STORY_AUDIO.ambience)!({ duration: 40 } as AudioBuffer);
  await ticks();
  const old = engine.respond("water", 0.1);
  engine.stopEffects();
  pending.get(STORY_AUDIO.water)!({ duration: 5 } as AudioBuffer);
  await old;
  assert.equal(
    fixture.sources.length,
    1,
    "stale input cannot resurrect decoded water",
  );
  await engine.respond("water", 0.2);
  const count = fixture.sources.length;
  assert.equal(filters.at(-1)!.frequency.value, 640);
  await engine.respond("water", 0.9);
  assert.equal(
    fixture.sources.length,
    count,
    "scrubbing reuses the same texture",
  );
  assert.equal(filters.at(-1)!.frequency.value, 2110);
  const phase = engine.respond("phase", 0.5, 0.75);
  engine.setAudible(false);
  pending.get(STORY_AUDIO.wash)!({ duration: 5 } as AudioBuffer);
  await phase;
  assert.equal(
    fixture.sources.length,
    count,
    "mute fences a late phase texture",
  );
  assert.ok(fixture.sources.every((s) => s.stopped));
  engine.dispose();
});

test("recorded soundscape has one sustained bed, bounded material voices and fences late decoding without oscillator notes", async () => {
  const fixture = audioFixture(),
    ctx = new fixture.Audio();
  ctx.state = "running";
  const pending = new Map<string, (buffer: AudioBuffer) => void>();
  let errors = 0;
  let signal: AbortSignal | undefined;
  const engine = createSoundscape(
    ctx as unknown as AudioContext,
    () => errors++,
    async (url, s) => {
      signal = s;
      return new Promise((resolve) => pending.set(url, resolve));
    },
  );
  engine.setAudible(true);
  pending.get(STORY_AUDIO.ambience)!({ duration: 40 } as AudioBuffer);
  await ticks();
  assert.equal(fixture.sources.length, 1);
  assert.equal(fixture.sources[0].loop, true);
  const water = engine.cue("water");
  pending.get(STORY_AUDIO.water)!({ duration: 2.1 } as AudioBuffer);
  await water;
  assert.equal(fixture.sources.length, 2);
  assert.equal(fixture.sources[1].loop, false);
  engine.stopEffects();
  assert.equal(fixture.sources[1].stopped, true);
  assert.equal(
    fixture.sources[0].stopped,
    false,
    "leaving a scene stops its foley, not the still-visible page ambience",
  );
  const old = engine.cue("collapse");
  engine.stopEffects();
  pending.get(STORY_AUDIO.collapse)!({ duration: 6 } as AudioBuffer);
  await old;
  assert.equal(fixture.sources.length, 2, "late scene foley cannot resurrect");
  await engine.cue("collapse");
  assert.equal(fixture.sources.length, 3);
  engine.setAudible(false);
  assert.ok(fixture.sources.every((source) => source.stopped));
  engine.setAudible(true);
  await ticks();
  assert.equal(
    fixture.sources.filter((source) => !source.stopped && source.loop).length,
    1,
  );
  const late = engine.cue("capture");
  engine.dispose();
  pending.get(STORY_AUDIO.wash)!({ duration: 5 } as AudioBuffer);
  await late;
  assert.ok(
    fixture.sources.every((source) => source.stopped && source.disconnected),
  );
  assert.equal(signal?.aborted, true);
  assert.equal(errors, 0);
});

test("actual provider creates and fetches only on consent; pause, tab/page visibility, mute and unmount stop the bed and never replay old foley", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window(),
    saved = new Map<string, PropertyDescriptor | undefined>(),
    fixture = audioFixture();
  let hidden = false,
    fetches = 0;
  const observers = new Map<
    object,
    { callback: IntersectionObserverCallback; target: Element | null }
  >();
  class Observer {
    constructor(callback: IntersectionObserverCallback) {
      observers.set(this, { callback, target: null });
    }
    observe(target: Element) {
      observers.get(this)!.target = target;
    }
    disconnect() {
      observers.delete(this);
    }
  }
  Object.defineProperty(window, "AudioContext", { value: fixture.Audio });
  Object.defineProperty(window.document, "visibilityState", {
    get: () => (hidden ? "hidden" : "visible"),
  });
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: Observer,
    fetch: async () => {
      fetches++;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { StoryProvider, useStory } =
    await import("../features/ground-truth/components/story/StoryProvider");
  const { DiscoverySound, useDiscoverySound } =
    await import("../features/public-story/discovery/DiscoverySound");
  const { DiscoveryWorld } =
    await import("../features/public-story/discovery/DiscoveryWorld");
  const { createRoot } = await import("react-dom/client");
  let sound!: ReturnType<typeof useDiscoverySound>,
    story!: ReturnType<typeof useStory>;
  function Fixture() {
    sound = useDiscoverySound();
    story = useStory();
    return React.createElement(DiscoveryWorld, { id: "aquifer" });
  }
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const flush = () =>
    act(async () => {
      fixture.resumes.splice(0).forEach((fn) => fn());
      await ticks();
    });
  const active = () => fixture.sources.filter((source) => !source.stopped);
  try {
    await act(async () =>
      root.render(
        React.createElement(
          StoryProvider,
          null,
          React.createElement(
            DiscoverySound,
            null,
            React.createElement(Fixture),
          ),
        ),
      ),
    );
    assert.equal(fixture.made, 0);
    assert.equal(fetches, 0);
    sound.cue("capture");
    assert.equal(fixture.made, 0);
    await act(async () => sound.toggle());
    assert.equal(fixture.made, 1);
    assert.equal(fixture.sources.length, 0);
    await flush();
    assert.equal(active().length, 1);
    assert.equal(active()[0].loop, true);
    assert.equal(fetches, 5, "all local clips warm only after consent");
    await act(async () => {
      sound.speak("radar-first");
      await ticks();
    });
    assert.equal(sound.voiceState, "speaking");
    assert.equal(
      active().filter((source) => !source.loop).length,
      1,
      "cached neural voice uses the same consent boundary",
    );
    await act(async () => story.togglePaused());
    assert.equal(sound.voiceState, "idle");
    assert.equal(
      active().length,
      0,
      "pause stops neural narration as well as ambience",
    );
    await act(async () => story.togglePaused());
    await ticks();
    assert.equal(
      active().filter((source) => !source.loop).length,
      0,
      "resume does not replay the old voice",
    );

    await act(async () => {
      sound.cue("water");
      await ticks();
    });
    assert.equal(active().filter((source) => !source.loop).length, 1);
    await act(async () => sound.silence());
    assert.equal(active().length, 1);
    assert.equal(active()[0].loop, true);
    await act(async () => story.togglePaused());
    assert.equal(active().length, 0);
    sound.cue("collapse");
    await ticks();
    assert.equal(active().length, 0);
    await act(async () => story.togglePaused());
    await ticks();
    assert.equal(active().filter((source) => source.loop).length, 1);
    hidden = true;
    await act(async () =>
      window.document.dispatchEvent(new window.Event("visibilitychange")),
    );
    assert.equal(active().length, 0);
    hidden = false;
    await act(async () =>
      window.document.dispatchEvent(new window.Event("visibilitychange")),
    );
    hidden = true;
    await act(async () =>
      window.document.dispatchEvent(new window.Event("visibilitychange")),
    );
    await flush();
    assert.equal(
      active().length,
      0,
      "a late resume from the old visible period cannot restart the bed",
    );
    hidden = false;
    await act(async () =>
      window.document.dispatchEvent(new window.Event("visibilitychange")),
    );
    await flush();
    assert.equal(active().filter((source) => source.loop).length, 1);
    const surface = [...observers.entries()].find(([, o]) =>
      o.target?.classList.contains("ea-sound-surface"),
    )!;
    await act(async () =>
      surface[1].callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        surface[0] as IntersectionObserver,
      ),
    );
    assert.equal(active().length, 0);
    await act(async () =>
      surface[1].callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        surface[0] as IntersectionObserver,
      ),
    );
    await ticks();
    assert.equal(active().filter((source) => source.loop).length, 1);
    await act(async () => sound.toggle());
    assert.equal(active().length, 0);
    assert.equal(sound.enabled, false);
    await act(async () => sound.listen("collapse"));
    await flush();
    assert.equal(sound.enabled, true);
    assert.equal(
      active().filter((source) => !source.loop).length,
      1,
      "explicit listen unlocks the requested recorded foley",
    );
    await act(async () => story.replay());
    await ticks();
    assert.equal(
      active().filter((source) => !source.loop).length,
      0,
      "replay does not resurrect old effects",
    );
    await act(async () => root.unmount());
    assert.equal(active().length, 0);
    assert.equal(fixture.closed, 1);
    assert.equal(observers.size, 0);
    await flush();
    assert.equal(active().length, 0);
  } finally {
    await act(async () => root.unmount());
    css.deregister();
    await window.happyDOM.close();
    for (const [key, d] of saved) {
      if (d) Object.defineProperty(globalThis, key, d);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
