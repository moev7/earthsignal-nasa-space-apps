import test from "node:test";
import assert from "node:assert/strict";
import React, { act, useRef, useState } from "react";
import { Window } from "happy-dom";
import { useChapterPlayback } from "../features/public-story/quest/useChapterPlayback";

test("chapter playback has a finite clock and stale callbacks cannot resume after pause, hidden, offscreen or teardown", async () => {
  const window = new Window({ url: "http://localhost/" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0,
    hidden = false,
    bottom = 500;
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++serial, fn);
      return serial;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  let api!: ReturnType<typeof useChapterPlayback>;
  let setGate!: React.Dispatch<
    React.SetStateAction<{
      paused: boolean;
      reduced: boolean;
      visible: boolean;
    }>
  >;
  function Fixture() {
    const element = useRef<HTMLDivElement>(null);
    const [gate, update] = useState({
      paused: false,
      reduced: false,
      visible: true,
    });
    setGate = update;
    api = useChapterPlayback({ enabled: true, element, ...gate });
    return React.createElement(
      "div",
      { ref: element },
      React.createElement("output", null, api.progress),
    );
  }
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const tick = async (time: number) => {
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => callbacks.forEach((callback) => callback(time)));
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(Fixture),
        ),
      ),
    );
    Object.defineProperty(host.firstElementChild, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, bottom }),
    });
    assert.equal(frames.size, 0, "idle has no queued frame");
    await act(async () => api.play());
    assert.equal(frames.size, 1);
    await tick(1000);
    await tick(2100);
    assert.equal(api.progress, 0.5);
    await tick(3200);
    assert.equal(api.progress, 1);
    assert.equal(api.playing, false);
    assert.equal(frames.size, 0);
    for (const gate of ["paused", "reduced", "visible"] as const) {
      await act(async () => api.play());
      await tick(4000);
      const stale = [...frames.values()][0];
      const held: number | null = api.progress;
      await act(async () =>
        setGate((previous) => ({ ...previous, [gate]: gate !== "visible" })),
      );
      assert.equal(frames.size, 0);
      await act(async () => stale(5000));
      assert.equal(api.progress, held);
      assert.equal(frames.size, 0);
      await act(async () =>
        setGate({ paused: false, reduced: false, visible: true }),
      );
      assert.equal(
        frames.size,
        0,
        "permission restoration never starts a clock",
      );
    }
    await act(async () => api.play());
    await tick(6000);
    const hiddenStale = [...frames.values()][0];
    await act(async () => {
      hidden = true;
      window.document.dispatchEvent(new window.Event("visibilitychange"));
    });
    await act(async () => hiddenStale(7100));
    assert.equal(api.progress, 0);
    assert.equal(frames.size, 0);
    hidden = false;
    await act(async () => api.play());
    await tick(8000);
    bottom = -1;
    await tick(9100);
    assert.equal(api.progress, 0);
    assert.equal(api.playing, false);
    assert.equal(frames.size, 0);
    bottom = 500;
    await act(async () => api.play());
    const stale = [...frames.values()][0];
    await act(async () => api.clear());
    assert.equal(api.progress, null);
    assert.equal(frames.size, 0);
    await act(async () => stale(10000));
    assert.equal(api.progress, null);
    await act(async () => api.play());
    const unmounted = [...frames.values()][0];
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    await act(async () => unmounted(11000));
    assert.equal(frames.size, 0);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
