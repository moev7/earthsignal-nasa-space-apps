import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { renderToString } from "react-dom/server";
import { Window } from "happy-dom";
import { storyExperience } from "../lib/story-experience";

test("the actual home route defaults to sticky scroll story and exposes the investigation only by explicit URL choice", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/" });
  try {
    const { PublicStory } =
      await import("../features/public-story/PublicStory");
    const { default: Home } = await import("../app/page");
    const read = (node: React.ReactNode) => {
      const host = window.document.createElement("div");
      host.innerHTML = renderToString(node);
      return host;
    };
    const assertStory = (host: ReturnType<typeof read>) => {
      assert.equal(
        host
          .querySelector("[data-experience]")
          ?.getAttribute("data-experience"),
        "story",
      );
      for (const selector of [
        ".es-field-challenge",
        ".es-quest-trail",
        ".es-case-opening",
        "#case-file",
        ".es-missions-progress",
        ".es-quest-stage",
      ])
        assert.equal(host.querySelectorAll(selector).length, 0, selector);
      assert.equal(host.querySelectorAll(".ed-story-chapter").length, 2);
      assert.equal(
        host.querySelectorAll(".es-story-beat[hidden]").length,
        0,
        "no story content is hidden behind a game step",
      );
      assert.equal(
        host.querySelectorAll(".es-scroll-act").length,
        3,
        "three live chapters restore scroll-driven visuals",
      );
      assert.ok(host.querySelector(".es-scroll-journey"));
      assert.equal(
        host.querySelectorAll("[data-discovery]").length,
        2,
        "real observations and city choices stay interactive",
      );
      assert.ok(
        host.querySelector("[data-water-level]"),
        "live default mounts the linked scroll-water scene",
      );
      assert.equal(
        host.querySelectorAll('.ed-sound[aria-pressed="true"]').length,
        0,
        "sound never starts automatically",
      );
      assert.equal(
        host.querySelector(".es-story-mode-link")?.getAttribute("href"),
        "/?mode=game#opening",
      );
      assert.ok(
        host.querySelector(".es-optional-game"),
        "the alternative is easy to find",
      );
    };
    assertStory(read(React.createElement(PublicStory)));
    for (const value of [undefined, "story", "GAME", "", ["game"]]) {
      assert.equal(storyExperience(value), "story");
      assertStory(
        read(await Home({ searchParams: Promise.resolve({ mode: value }) })),
      );
    }
    assert.equal(storyExperience("game"), "game");
    const game = read(
      await Home({ searchParams: Promise.resolve({ mode: "game" }) }),
    );
    assert.equal(
      game.querySelector("[data-experience]")?.getAttribute("data-experience"),
      "game",
    );
    assert.equal(game.querySelectorAll(".es-field-challenge").length, 0);
    assert.equal(game.querySelectorAll(".es-quest-trail").length, 0);
    assert.equal(game.querySelectorAll(".es-quest-stage").length, 0);
    assert.ok(game.querySelector(".ed-game-opening"));
    assert.equal(game.querySelectorAll(".eg-map-node").length, 5);
    assert.equal(
      game.querySelector(".es-story-mode-link")?.getAttribute("href"),
      "/#opening",
    );
    assert.equal(game.querySelector(".es-water-controls"), null);
  } finally {
    css.deregister();
    await window.happyDOM.close();
  }
});

test("the real aquifer visual recedes with scroll, reverses, freezes, and keeps explicit water control until Follow the story", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/" });
  const saved = new Map<string, PropertyDescriptor | undefined>(),
    frames = new Map<number, FrameRequestCallback>(),
    motions = new Set<() => void>();
  let frameId = 0,
    top = 132,
    reduced = false;
  window.matchMedia = (() => ({
    get matches() {
      return reduced;
    },
    addEventListener(_type: string, fn: () => void) {
      motions.add(fn);
    },
    removeEventListener(_type: string, fn: () => void) {
      motions.delete(fn);
    },
  })) as unknown as typeof window.matchMedia;
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++frameId, fn);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: () => ({ top: "132px" }),
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
  const { StoryStage } = await import("../features/public-story/StoryStage");
  const { JourneyWater } =
    await import("../features/public-story/discovery/NarrativeScenes");
  let controls!: ReturnType<typeof useStory>;
  function Fixture() {
    controls = useStory();
    return React.createElement(StoryStage, {
      id: "water-test",
      title: "Water",
      description: "Scroll to explore",
      evidence: "Schematic",
      beats: [
        { title: "Before", body: "Water held" },
        { title: "Change", body: "Pressure falls" },
        { title: "After", body: "Layers compact" },
      ],
      visual: ({ progress }) => React.createElement(JourneyWater, { progress }),
    });
  }
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const draw = async () => {
    const list = [...frames.values()];
    frames.clear();
    await act(async () => list.forEach((fn) => fn(0)));
  };
  const scroll = async (value: number) => {
    top = value;
    await act(async () => window.dispatchEvent(new window.Event("scroll")));
    await draw();
  };
  const waterY = () =>
    Number(
      host.querySelector('rect[fill="url(#gt-water)"]')!.getAttribute("y"),
    );
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    );
    assert.ok(button, label);
    await act(async () => button.click());
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
      value: () => ({ top, bottom: top + 2000, height: 2000 }),
    });
    Object.defineProperty(stage, "offsetHeight", { value: 500 });
    await draw();
    const follow = host.querySelector(".es-follow-story")!;
    assert.equal(follow.getAttribute("aria-hidden"), "true");
    assert.equal(follow.hasAttribute("disabled"), true);
    assert.equal(follow.getAttribute("tabindex"), "-1");
    const controlCount = host.querySelectorAll(".ea-still-controls button").length;
    const full = waterY();
    await scroll(-618);
    const midway = waterY();
    assert.ok(midway > full, "water surface moves down as the reader scrolls");
    await scroll(132);
    assert.equal(
      waterY(),
      full,
      "ordinary reverse scroll restores the earlier still",
    );
    await scroll(-618);
    await act(async () => controls.togglePaused());
    await scroll(-1368);
    assert.equal(waterY(), midway);
    await act(async () => controls.togglePaused());
    await draw();
    assert.ok(
      Number(
        host
          .querySelector("[data-compaction]")!
          .getAttribute("data-compaction"),
      ) > 0.7,
      "late story retains compaction even while water returns",
    );
    await act(async () => {
      reduced = true;
      motions.forEach((fn) => fn());
    });
    await click("Return water");
    assert.equal(
      host
        .querySelector("[data-water-level]")!
        .getAttribute("data-water-level"),
      "0.000",
      "manual water controls remain usable during reduced motion",
    );
    await act(async () => {
      reduced = false;
      motions.forEach((fn) => fn());
    });
    assert.equal(host.querySelector(".es-follow-story"), follow, "manual input reuses the reserved button rather than adding layout chrome");
    assert.equal(host.querySelectorAll(".ea-still-controls button").length, controlCount);
    assert.equal(follow.getAttribute("aria-hidden"), null);
    assert.equal(follow.getAttribute("data-available"), "true");
    assert.equal(follow.hasAttribute("disabled"), false);
    assert.equal(follow.getAttribute("tabindex"), "0");
    const manualY = waterY();
    await scroll(-618);
    assert.equal(
      waterY(),
      manualY,
      "scroll cannot overwrite a manual experiment",
    );
    await click("Follow the story");
    assert.equal(waterY(), midway);
    await click("Draw water");
    await act(async () => controls.replay());
    assert.equal(
      host.querySelector(".es-follow-story")?.getAttribute("data-available"),
      "false",
      "replay clears the manual override while reserving its control space",
    );
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    assert.equal(motions.size, 0);
  } finally {
    await act(async () => root.unmount());
    css.deregister();
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
