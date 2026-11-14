import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import {
  StoryStage,
  type StoryStageState,
} from "../features/public-story/StoryStage";
import {
  StoryProvider,
  useStory,
} from "../features/ground-truth/components/story/StoryProvider";

test("the real scroll stage batches updates, freezes motion, resumes and cleans its pending frame", async () => {
  const window = new Window({ url: "http://localhost/#hidden-cause" }),
    saved = new Map<string, PropertyDescriptor | undefined>(),
    frames = new Map<number, FrameRequestCallback>();
  let number = 0,
    reduced = false,
    visualHeight = 768;
  const visualViewport = new window.EventTarget();
  Object.defineProperty(visualViewport, "height", { get: () => visualHeight });
  Object.defineProperty(window, "visualViewport", {
    value: visualViewport,
    configurable: true,
  });
  const motionListeners = new Set<() => void>();
  window.matchMedia = (() => ({
    get matches() {
      return reduced;
    },
    addEventListener(_t: string, f: () => void) {
      motionListeners.add(f);
    },
    removeEventListener(_t: string, f: () => void) {
      motionListeners.delete(f);
    },
  })) as unknown as typeof window.matchMedia;
  const install = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++number, fn);
      return number;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: () => ({ top: "140px" }),
  }))
    install(key, value);
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  let controls!: ReturnType<typeof useStory>,
    pose!: StoryStageState,
    top = 140,
    stageHeight = 700;
  function Fixture() {
    controls = useStory();
    return React.createElement(StoryStage, {
      id: "hidden-cause",
      title: "Below ground",
      description: "Test story",
      evidence: "Schematic",
      beats: [
        { title: "Water", body: "First" },
        { title: "Pumping", body: "Second" },
        { title: "Compaction", body: "Third" },
      ],
      visual: (v: StoryStageState) => {
        pose = v;
        return React.createElement("output", null, v.progress);
      },
    });
  }
  const frame = async () => {
    await act(async () => {
      const list = [...frames];
      frames.clear();
      for (const [, fn] of list) fn(0);
    });
  };
  const scroll = async (value: number) => {
    top = value;
    await act(async () => window.dispatchEvent(new window.Event("scroll")));
    await frame();
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(StoryProvider, null, React.createElement(Fixture)),
      ),
    );
    const grid = host.querySelector(".es-act-grid")!,
      stage = host.querySelector(".es-story-visual")!;
    Object.defineProperty(grid, "getBoundingClientRect", {
      value: () => ({ top, bottom: top + 2100, height: 2100 }),
    });
    Object.defineProperty(stage, "offsetHeight", { get: () => stageHeight });
    await frame();
    assert.equal(pose.progress, 0);
    stageHeight = 300;
    await act(async () => window.dispatchEvent(new window.Event("resize")));
    await frame();
    assert.equal(
      stage.getAttribute("data-pin"),
      "true",
      "a fitting scene pins with reading room",
    );
    stageHeight = 900;
    await act(async () => window.dispatchEvent(new window.Event("resize")));
    await frame();
    assert.equal(
      stage.getAttribute("data-pin"),
      "false",
      "expanded controls release an oversized visual",
    );
    stageHeight = 700;
    top = -560;
    await act(async () => {
      for (let i = 0; i < 10; i++)
        window.dispatchEvent(new window.Event("scroll"));
    });
    assert.equal(frames.size, 1);
    await frame();
    assert.equal(pose.progress, 0.5);
    await act(async () => controls.togglePaused());
    await scroll(-910);
    assert.equal(pose.progress, 0.5);
    await act(async () => controls.togglePaused());
    await frame();
    assert.equal(pose.progress, 0.75);
    let unexpectedScrolls = 0;
    Object.defineProperty(grid, "scrollIntoView", {
      value: () => {
        unexpectedScrolls++;
      },
    });
    await act(async () => controls.replay());
    assert.equal(pose.progress, 0, "replay resets the visible pose");
    assert.equal(
      unexpectedScrolls,
      0,
      "replay never hijacks the page scroll position",
    );
    await scroll(-910);
    assert.equal(pose.progress, 0.75);
    await act(async () => {
      reduced = true;
      for (const f of motionListeners) f();
    });
    await scroll(-1260);
    assert.equal(pose.progress, 0.75);
    assert.equal(
      host.querySelector("[data-current] h3")!.textContent,
      "Compaction",
      "reading still reaches the final beat",
    );
    // An iPhone mini-sized *small* viewport stays fixed while browser chrome
    // changes visualViewport/innerHeight during a reversed scroll.
    await act(async () => {
      reduced = false;
      motionListeners.forEach((f) => f());
    });
    const probe = window.document.createElement("div"),
      header = window.document.createElement("header");
    probe.className = "es-viewport-probe";
    header.className = "es-header";
    let smallHeight = 635;
    probe.getBoundingClientRect = () =>
      new window.DOMRect(0, 0, 0, smallHeight);
    header.getBoundingClientRect = () => new window.DOMRect(0, 0, 375, 101);
    window.document.body.append(probe, header);
    stageHeight = 446;
    await scroll(-200);
    const beforeBars = pose.progress;
    assert.equal(stage.getAttribute("data-pin"), "true");
    for (const next of [724, 662, 635, 724, 635]) {
      visualHeight = next;
      Object.defineProperty(window, "innerHeight", {
        value: next,
        configurable: true,
      });
      await act(async () => {
        visualViewport.dispatchEvent(new window.Event("resize"));
        window.dispatchEvent(new window.Event("resize"));
      });
      await frame();
      assert.equal(
        stage.getAttribute("data-pin"),
        "true",
        "browser bars cannot flip pin eligibility",
      );
      assert.equal(
        pose.progress,
        beforeBars,
        "browser bars cannot seek the model",
      );
    }
    await scroll(-100);
    assert.ok(
      pose.progress < beforeBars,
      "reverse scrolling reverses continuously",
    );
    await scroll(113);
    assert.equal(pose.progress, 0, "reverse exit returns to the original pose");
    const details = window.document.createElement("details");
    details.open = true;
    stage.append(details);
    await scroll(-100);
    assert.equal(
      stage.getAttribute("data-pin"),
      "false",
      "expanded controls release even if a stale size still fits",
    );
    details.remove();
    smallHeight = 375;
    await act(async () => window.dispatchEvent(new window.Event("resize")));
    await frame();
    assert.equal(
      stage.getAttribute("data-pin"),
      "false",
      "true short landscape still has a safe normal-flow fallback",
    );
    await act(async () => window.dispatchEvent(new window.Event("scroll")));
    assert.equal(frames.size, 1);
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    assert.equal(motionListeners.size, 0);
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, d] of saved) {
      if (d) Object.defineProperty(globalThis, key, d);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
