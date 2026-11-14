import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act, useState } from "react";
import { Window } from "happy-dom";
import { MISSION_IDS } from "../lib/story-missions";

test("the real teen investigation reveals, solves five distinct tasks, updates one case file and resets without locking content", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const motionListeners = new Set<() => void>();
  let reduced = false;
  window.matchMedia = (() => ({
    get matches() {
      return reduced;
    },
    addEventListener(_type: string, listener: () => void) {
      motionListeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      motionListeners.delete(listener);
    },
  })) as unknown as typeof window.matchMedia;
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    fetch: () => {
      throw new Error("The investigation must not submit or fetch progress");
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  const { MissionProvider, MissionProgress } =
    await import("../features/public-story/missions/StoryMissions");
  const { StoryProvider, useStory } =
    await import("../features/ground-truth/components/story/StoryProvider");
  const { CaseOpening, QuestTrail, CaseFile } =
    await import("../features/public-story/quest/QuestExperience");
  const { FieldChallenge } =
    await import("../features/public-story/quest/QuestChallenges");
  const { RadarLesson } =
    await import("../features/ground-truth/components/story/radar3d/RadarLesson");
  const { StoryStage } = await import("../features/public-story/StoryStage");
  const sceneLoader = async () => ({
    createRadarScene: () => ({
      update() {},
      resize() {},
      view() {},
      dispose() {},
    }),
  });
  let controls!: ReturnType<typeof useStory>;
  function Fixture() {
    controls = useStory();
    const [model, setModel] = useState({
      sinkingCm: 18,
      observation: "compare" as "compare" | "before" | "after",
      selectedSite: "centre" as "centre" | "slope" | "edge",
    });
    return React.createElement(
      React.Fragment,
      null,
      // This component accepts a scene render function, not a React child node.
      // eslint-disable-next-line react/no-children-prop
      React.createElement(CaseOpening, {
        children: () => React.createElement("p", null, "Frozen city scene"),
      }),
      React.createElement(QuestTrail),
      React.createElement(MissionProgress, { compact: false }),
      React.createElement(StoryStage, {
        id: "test-stage",
        title: "Test chapter",
        description: "Three still states",
        evidence: "Synthetic fixture",
        stepped: true,
        beats: [
          { title: "Before", body: "Before pressure falls" },
          { title: "Change", body: "The pressure changes" },
          { title: "After", body: "The layers compact" },
        ],
        visual: ({ progress }: { progress: number }) =>
          React.createElement("output", { id: "pose" }, progress),
      }),
      React.createElement(RadarLesson, {
        sceneLoader,
        onModelChange: setModel,
      }, React.createElement(FieldChallenge, { id: 'radar', radar: model })),
      ...MISSION_IDS.filter(id => id !== 'radar').map((id) =>
        React.createElement(FieldChallenge, {
          id,
          key: id,

        }),
      ),
      React.createElement(CaseFile),
    );
  }
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const click = async (label: string, scope = host) => {
    const button = [...scope.querySelectorAll("button")].find(
      (button) =>
        button.textContent?.trim() === label ||
        button.getAttribute("aria-label") === label,
    );
    assert.ok(button, `button ${label}`);
    await act(async () => button.click());
  };
  const challenge = (id: string) =>
    host.querySelector(`#challenge-${id}`)! as typeof host;
  const score = () =>
    host.querySelector(".es-missions-progress>summary")!.textContent!;
  const feedback = (id: string) =>
    challenge(id).querySelector(".es-quest-feedback")!.textContent!;
  try {
    await act(async () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            MissionProvider,
            null,
            React.createElement(
              StoryProvider,
              null,
              React.createElement(Fixture),
            ),
          ),
        ),
      ),
    );
    assert.equal(host.querySelectorAll(".es-field-challenge").length, 5);
    assert.ok(host.querySelector('.es-radar-lesson #challenge-radar'), 'the radar task lives beside the existing controls, with one model');
    assert.equal(
      host.querySelector(".es-field-challenge")?.closest("details"),
      null,
      "no challenge is hidden in a disclosure",
    );
    assert.equal(
      host.querySelectorAll(".es-case-findings>li").length,
      5,
      "case file is open before any clue",
    );
    assert.equal(
      host.querySelector("#opening-clue")!.hasAttribute("hidden"),
      true,
    );
    await click("Reveal the hidden pattern");
    assert.equal(
      host.querySelector("#opening-clue")!.hasAttribute("hidden"),
      false,
    );
    assert.equal(
      host.querySelector(".es-case-opening")!.getAttribute("data-scan"),
      "true",
    );
    await act(async () => controls.togglePaused());
    assert.equal(
      host.querySelector(".es-case-opening")!.getAttribute("data-scan"),
      "false",
    );
    await click("Reveal the pattern again");
    assert.equal(
      host.querySelector(".es-case-opening")!.getAttribute("data-scan"),
      "false",
      "pause gives the same reveal with no motion",
    );
    await click("What happens next? →");
    assert.equal(
      host.querySelector("#pose")!.textContent,
      "0.5",
      "explicit still states work while paused",
    );
    assert.equal(
      host.querySelectorAll(".es-quest-stage article:not([hidden])").length,
      1,
    );
    await act(async () => controls.replay());
    // Visibility callback can defer a replay in offscreen stages; initial state is still available by button.
    await click("01 · Before");
    assert.equal(host.querySelector("#pose")!.textContent, "0");
    await act(async () => controls.togglePaused());
    await click("Test my chain", challenge("aquifer"));
    assert.match(feedback("aquifer"), /Start with/);
    assert.match(score(), /0\/5/);
    await click(
      "Move Pumping removes groundwater earlier",
      challenge("aquifer"),
    );
    await click("Move Water pressure falls earlier", challenge("aquifer"));
    await click("Move Water pressure falls earlier", challenge("aquifer"));
    await click("Test my chain", challenge("aquifer"));
    assert.match(score(), /1\/5 discoveries, 20 points/);
    await click("Test my chain", challenge("aquifer"));
    assert.match(score(), /20 points/);
    await click(
      "Street C25 cm ↓27 cm ↓Compare the two ends",
      challenge("uneven"),
    );
    await click("Compare my street", challenge("uneven"));
    assert.match(feedback("uneven"), /only 2 cm/);
    // Cards retain an accessible text name including values and the current comparison result.
    const streetB = [...challenge("uneven").querySelectorAll("button")].find(
      (button) => button.textContent?.startsWith("Street B"),
    )!;
    await act(async () => streetB.click());
    await click("Compare my street", challenge("uneven"));
    assert.match(score(), /2\/5 discoveries, 40 points/);
    await click(
      "The ground-motion phase difference is zero in this ideal model.",
      challenge("radar"),
    );
    await click("Check the signal", challenge("radar"));
    assert.match(feedback("radar"), /still moves/);
    await click("Reset / No sinking");
    await click("Before · t₁");
    await click("Check the signal", challenge("radar"));
    assert.match(feedback("radar"), /Compare both and Centre/);
    await click("Compare both");
    await click("Check the signal", challenge("radar"));
    assert.match(score(), /3\/5 discoveries, 60 points/);
    for (const [index, value] of [
      [0, "Measured estimate"],
      [1, "Conditional scenario"],
      [2, "Unsupported claim"],
    ] as const) {
      const group = challenge("evidence").querySelector(
        `[aria-label="Classify card ${index + 1}"]`,
      )! as typeof host;
      await click(value, group);
    }
    await click("Check my evidence", challenge("evidence"));
    assert.match(score(), /4\/5 discoveries, 80 points/);
    const planButtons = () => [
      ...challenge("tokyo")
        .querySelector(".es-plan-cards")!
        .querySelectorAll("button"),
    ];
    await act(async () => planButtons()[1].click());
    await click("Test my response", challenge("tokyo"));
    assert.match(feedback("tokyo"), /withdrawal/);
    await act(async () => planButtons()[0].click());
    await click("Test my response", challenge("tokyo"));
    assert.match(score(), /5\/5 discoveries, 100 points/);
    assert.equal(
      host.querySelectorAll(".es-case-findings>li[data-earned=true]").length,
      5,
    );
    assert.match(
      host.querySelector(".es-case-rank")!.textContent!,
      /Signal detective/,
    );
    await click("The satellite predicts which building falls next.");
    await click("File your explanation");
    assert.match(
      host.querySelector(".es-case-conclusion .es-quest-feedback")!
        .textContent!,
      /cannot diagnose/,
    );
    await click(
      "A ground-motion clue worth investigating—water use and repeat monitoring can help explain it.",
    );
    await click("File your explanation");
    assert.ok(host.querySelector(".es-case-stamp"));
    await act(async () => {
      reduced = true;
      motionListeners.forEach((listener) => listener());
    });
    assert.equal(
      host.querySelector(".es-case-stamp")!.getAttribute("data-celebrate"),
      "false",
    );
    await click("Reset progress");
    await click("Yes, reset progress");
    assert.match(score(), /0\/5 discoveries, 0 points/);
    assert.equal(
      host.querySelector(".es-case-stamp"),
      null,
      "reset clears a filed conclusion as well as receipts",
    );
    assert.equal(
      host.querySelectorAll(".es-case-findings>li").length,
      5,
      "reset does not lock or erase the story",
    );
    assert.equal(
      challenge("aquifer").querySelector(".es-quest-feedback")!.textContent,
      "",
    );
    assert.equal(
      host.querySelectorAll(".es-quest-headlines>button[aria-pressed=true]")
        .length,
      0,
    );
    await click("Hide missions");
    assert.equal(host.querySelectorAll(".es-field-challenge").length, 0);
    assert.ok(host.querySelector("#case-file"));
    await click("Show missions");
    assert.equal(host.querySelectorAll(".es-field-challenge").length, 5);
    await act(async () => root.unmount());
    assert.equal(motionListeners.size, 0);
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
