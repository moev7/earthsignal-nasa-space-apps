import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import {
  cityCanvasBudget,
  useCityViewportFit,
} from "../features/public-story/discovery/useCityViewportFit";
import { storySceneCanPin } from "../lib/story-scroll";

test("the actual city chrome failure gets a canvas budget that admits pinning, with a short-screen floor", () => {
  const oldPanel = 597.6875,
    oldCanvas = 312,
    chrome = oldPanel - oldCanvas;
  assert.equal(storySceneCanPin(oldPanel, 800, 117, false), false);
  const canvas = cityCanvasBudget(800, 105, chrome, 360);
  assert.ok(canvas >= 160);
  assert.equal(storySceneCanPin(canvas + chrome, 800, 117, false), true);
  assert.equal(cityCanvasBudget(390, 105, chrome, 360), 160);
  assert.equal(storySceneCanPin(160 + chrome, 390, 117, false), false);
  assert.equal(cityCanvasBudget(NaN, 105, chrome, 360), 160);
  const radarChrome = 646.9765625 - 312;
  assert.equal(storySceneCanPin(312 + radarChrome, 800, 117, false), false);
  assert.equal(
    storySceneCanPin(
      cityCanvasBudget(800, 105, radarChrome, 360) + radarChrome,
      800,
      117,
      false,
    ),
    true,
  );
});

test("the mounted fitter measures captions and controls, converges and releases resize frames/listeners", async () => {
  const window = new Window(),
    saved = new Map<string, PropertyDescriptor | undefined>(),
    frames = new Map<number, FrameRequestCallback>(),
    observers = new Set<() => void>();
  let seq = 0,
    chrome = 285.6875;
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const city = window.document.querySelector(".ea-city-scene") as
      import("happy-dom").HTMLElement | null;
    const canvas = Number.parseFloat(
      city?.style.getPropertyValue("--city-canvas-height") || "312",
    );
    const height = this.classList.contains("es-viewport-probe")
      ? 635
      : this.classList.contains("es-header")
        ? 105
        : this.classList.contains("es-city-stage")
          ? canvas
          : canvas + chrome;
    return new window.DOMRect(0, 0, 600, height);
  };
  class Resize {
    constructor(callback: () => void) {
      observers.add(callback);
    }
    observe() {}
    disconnect() {
      observers.clear();
    }
  }
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    ResizeObserver: Resize,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++seq, fn);
      return seq;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  function Fixture() {
    const ref = useCityViewportFit();
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("header", { className: "es-header" }),
      React.createElement(
        "div",
        { className: "es-story-visual" },
        React.createElement(
          "div",
          { className: "ea-city-scene", ref },
          React.createElement("div", { className: "es-city-stage" }),
          "Captions and controls",
        ),
      ),
    );
  }
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const draw = () =>
    act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(0));
    });
  try {
    await act(async () => root.render(React.createElement(Fixture)));
    await draw();
    const city = host.querySelector(".ea-city-scene")!;
    assert.equal(city.getAttribute("style"), "--city-canvas-height: 245px;");
    for (let i = 0; i < 4; i++) {
      observers.forEach((fn) => fn());
      await draw();
      assert.equal(city.getAttribute("style"), "--city-canvas-height: 245px;");
    }
    chrome = 350;
    observers.forEach((fn) => fn());
    await draw();
    assert.equal(city.getAttribute("style"), "--city-canvas-height: 181px;");
    const probe = window.document.createElement("div");
    probe.className = "es-viewport-probe";
    window.document.body.append(probe);
    chrome = 250;
    observers.forEach((fn) => fn());
    await draw();
    assert.equal(city.getAttribute("style"), "--city-canvas-height: 192px;");
    for (const next of [724, 635, 662, 724, 635]) {
      Object.defineProperty(window, "innerHeight", {
        value: next,
        configurable: true,
        writable: true,
      });
      window.dispatchEvent(new window.Event("resize"));
      await draw();
      assert.equal(
        city.getAttribute("style"),
        "--city-canvas-height: 192px;",
        "toolbar height cannot resize the WebGL canvas",
      );
    }
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    assert.equal(observers.size, 0);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, d] of saved) {
      if (d) Object.defineProperty(globalThis, key, d);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
