import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";
import { directEcho } from "../lib/echo-director";

test("Echo idle spotlight never takes focus and queued stale hints die on pause, interaction, hidden tab and unmount", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window(),
    saved = new Map<string, PropertyDescriptor | undefined>(),
    observers = new Set<object>();
  let hidden = false;
  class Observer {
    constructor(private cb: IntersectionObserverCallback) {
      observers.add(this);
    }
    observe(target: Element) {
      this.cb(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    disconnect() {
      observers.delete(this);
    }
  }
  Object.defineProperty(window.document, "visibilityState", {
    get: () => (hidden ? "hidden" : "visible"),
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: Observer,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  const { StoryProvider, useStory } =
    await import("../features/ground-truth/components/story/StoryProvider");
  const { FieldPartner } =
    await import("../features/public-story/discovery/FieldPartner");
  const { createRoot } = await import("react-dom/client");
  let story!: ReturnType<typeof useStory>;
  const reading = directEcho({
    kind: "water",
    depletion: 0,
    compacted: 0,
    returned: false,
  });
  function Fixture() {
    story = useStory();
    return React.createElement(
      "div",
      { "data-discovery": "aquifer" },
      React.createElement("input", {
        "data-affordance": "water",
        type: "range",
      }),
      React.createElement(
        FieldPartner,
        {
          hint: "Try the water handle.",
          found: false,
          reading,
        },
        "Take water out.",
      ),
    );
  }
  const nativeSet = globalThis.setTimeout,
    nativeClear = globalThis.clearTimeout;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let serial = 1_000_000;
  globalThis.setTimeout = ((fn: () => void, ms: number, ...args: unknown[]) => {
    if (ms === 12000 || ms === 1400) {
      const id = ++serial;
      timers.set(id, { fn, ms });
      return id;
    }
    return nativeSet(fn, ms, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    if (timers.has(Number(id))) timers.delete(Number(id));
    else nativeClear(id);
  }) as typeof clearTimeout;
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const latest = () =>
    [...timers.values()].filter((t) => t.ms === 12000).at(-1)!.fn;
  try {
    await act(async () =>
      root.render(
        React.createElement(StoryProvider, null, React.createElement(Fixture)),
      ),
    );
    const stale = latest();
    await act(async () => story.togglePaused());
    await act(async () => stale());
    assert.equal(host.querySelector(".ea-partner-offer"), null);
    await act(async () => story.togglePaused());
    const beforeInteraction = latest();
    await act(async () =>
      host
        .querySelector("input")!
        .dispatchEvent(new window.Event("pointerdown", { bubbles: true })),
    );
    await act(async () => beforeInteraction());
    assert.equal(host.querySelector(".ea-partner-offer"), null);
    const focus = window.document.activeElement;
    await act(async () => latest()());
    assert.ok(host.querySelector(".ea-partner-offer"));
    assert.equal(window.document.activeElement, focus);
    assert.ok(host.querySelector("[data-coach-focus=true]"));
    hidden = true;
    await act(async () =>
      window.document.dispatchEvent(new window.Event("visibilitychange")),
    );
    assert.equal(host.querySelector("[data-coach-focus=true]"), null);
    assert.equal(host.querySelector(".ea-partner-offer"), null);
    await act(async () => root.unmount());
    await act(async () => stale());
    assert.equal(observers.size, 0);
    assert.equal(timers.size, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.setTimeout = nativeSet;
    globalThis.clearTimeout = nativeClear;
    css.deregister();
    await window.happyDOM.close();
    for (const [key, d] of saved) {
      if (d) Object.defineProperty(globalThis, key, d);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
