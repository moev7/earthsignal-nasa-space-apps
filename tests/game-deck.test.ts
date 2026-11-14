import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";

test("the real optional deck keeps one world, routes header/map/history, contextual hints, radar state, replay and reset in agreement", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/?mode=game#from-space" });
  const browserErrors: string[] = [];
  // happy-dom navigates download anchors as documents; keep this fixture on
  // the report while checking the real generated URL and copyable content.
  window.document.addEventListener("click", (event) => {
    if ((event.target as unknown as Element).closest?.("a[download]"))
      event.preventDefault();
  });
  window.addEventListener("error", (event) =>
    browserErrors.push(
      String((event as unknown as { message?: string }).message),
    ),
  );
  const saved = new Map<string, PropertyDescriptor | undefined>(),
    frames = new Map<number, FrameRequestCallback>(),
    motion = new Set<() => void>();
  let number = 0,
    reduced = false;
  const visibility = "visible";
  Object.defineProperty(window.document, "visibilityState", {
    get: () => visibility,
    configurable: true,
  });
  const observers = new Set<object>();
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {
      observers.delete(this);
    }
    constructor() {
      observers.add(this);
    }
  }
  window.matchMedia = (() => ({
    get matches() {
      return reduced;
    },
    addEventListener(_type: string, fn: () => void) {
      motion.add(fn);
    },
    removeEventListener(_type: string, fn: () => void) {
      motion.delete(fn);
    },
  })) as unknown as typeof window.matchMedia;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IntersectionObserver: Observer,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++number, fn);
      return number;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: window.getComputedStyle.bind(window),
    fetch: () => {
      throw Error(
        "No observation fetch or progress submission in the non-visible fixture",
      );
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  window.localStorage.setItem(
    "earthsignal:missions:preferences",
    JSON.stringify({ version: 1, enabled: false }),
  );
  const { PublicStory } = await import("../features/public-story/PublicStory");
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const click = async (label: string, scope = host) => {
    const button = [...scope.querySelectorAll("button")].find(
      (item) =>
        item.textContent?.trim() === label ||
        item.textContent?.trim().endsWith(label) ||
        item.getAttribute("aria-label") === label,
    );
    assert.ok(button, `button ${label}`);
    await act(async () => button.click());
  };
  const link = async (selector: string) => {
    const node = host.querySelector(selector);
    assert.ok(node, selector);
    await act(async () =>
      node.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
  };
  const world = (id: string) => {
    assert.equal(host.querySelectorAll("[data-world]").length, 1);
    if (id === "radar")
      assert.equal(
        host.querySelectorAll("#radar-model").length,
        1,
        "spacecraft help has one native radar target in game mode",
      );
    assert.equal(
      host.querySelector("[data-world]")?.getAttribute("data-world"),
      id,
    );
    assert.equal(host.querySelectorAll("[data-discovery]").length, 1);
    assert.equal(
      host.querySelectorAll(".es-field-challenge").length,
      0,
      "no separate exam panel",
    );
  };
  const hint = () => host.querySelector(".ed-echo")!.textContent!;
  const status = () => host.querySelector(".eg-status-ribbon")!.textContent!;
  const chapter = (id: string) =>
    host.querySelector(`[data-game-title="${id}"]`);
  const history = async (hash: string, event = "popstate") => {
    window.history.replaceState(null, "", hash);
    await act(async () => window.dispatchEvent(new window.Event(event)));
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(PublicStory, { mode: "game" }),
        ),
      ),
    );
    world("radar");
    const checkpoints = () =>
      host.querySelectorAll('.ep-objective li[data-done="true"]').length;
    assert.equal(host.querySelectorAll(".ep-route button").length, 5);
    assert.match(
      host.querySelector(".ep-objective")!.textContent!,
      /Save the first echo/,
    );
    assert.equal(checkpoints(), 0);
    assert.match(
      host.querySelector(".ep-mode-link")!.textContent!,
      /Read story/,
    );
    assert.equal(window.location.hash, "#from-space");
    assert.match(hint(), /Capture this visit|single visit/);
    await click("Show me");
    assert.match(hint(), /Capture the first echo/);
    assert.equal(
      window.document.activeElement?.getAttribute("data-affordance"),
      "capture",
      "Echo points to the first live action",
    );
    await click("Quiet Echo");
    assert.match(hint(), /Bring Echo back/);
    await click("Bring Echo back");
    assert.equal(
      window.document.activeElement?.getAttribute("aria-label"),
      "Quiet Echo",
      "restoring Echo preserves keyboard focus",
    );
    await click("Capture first echo");
    assert.equal(
      checkpoints(),
      1,
      "first actual capture updates the visible objective",
    );
    assert.match(hint(), /Slide the ground down/);
    await click("Point it out");
    assert.equal(
      window.document.activeElement?.getAttribute("aria-label"),
      "Move the ground between visits",
      "Echo points to ground movement while repeat capture is unavailable",
    );
    assert.equal(
      host
        .querySelector('.ed-pass-strip [data-saved="true"]')
        ?.textContent?.includes("First visit"),
      true,
    );
    const setRange = async (selector: string, value: string) => {
      const input = host.querySelector(selector);
      assert.ok(input, selector);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, value);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    };
    await setRange('input[aria-label="Move the ground between visits"]', "18");
    await click("Capture repeat echo");
    assert.equal(checkpoints(), 2);
    await click("Reveal the difference");
    assert.equal(checkpoints(), 3);
    assert.ok(
      host.querySelector(".ep-reward"),
      "two distinct captures and comparison earn the core discovery",
    );
    for (const selector of [
      '[data-affordance="twin-shallow"]',
      '[data-affordance="twin-deep"]',
    ])
      await act(async () =>
        (
          host.querySelector(selector) as unknown as { click: () => void }
        ).click(),
      );
    await click("Reference edge");
    await click("Cross the slope");
    await click("Target centre");
    assert.equal(
      checkpoints(),
      3,
      "optional unwrapping adds no compulsory checkpoint",
    );
    assert.match(
      host.querySelector(".ep-reward")!.textContent!,
      /Finding collected.*20/,
    );
    assert.match(host.querySelector(".ep-campaign")!.textContent!, /20/);
    assert.equal(
      host.querySelectorAll('.ep-route [data-earned="true"]').length,
      1,
    );
    await click("Dismiss finding");
    assert.equal(host.querySelector(".ep-reward"), null);
    assert.equal(
      window.document.activeElement,
      chapter("from-space"),
      "dismissing reward returns keyboard focus without moving the reader",
    );
    assert.match(status(), /1\/5/);
    assert.match(hint(), /phase clock/);
    await click("Fresh experiment");
    assert.match(hint(), /Capture this visit|single visit/);
    assert.match(status(), /1\/5/, "retry does not duplicate a finding");
    assert.equal(
      checkpoints(),
      0,
      "fresh experiment resets local checkpoints but retains artifact",
    );
    assert.match(
      host.querySelector(".ep-objective")!.textContent!,
      /Discovery kept/,
    );
    await history("#hidden-cause");
    world("aquifer");
    assert.equal(window.document.activeElement, chapter("hidden-cause"));
    await click("Pump water");
    await click("Pump water");
    await click("Pump water");
    assert.match(hint(), /Refill the well|bring the water back/);
    await click("Refill");
    await click("Refill");
    assert.match(hint(), /squeezed space did not/);
    assert.match(
      status(),
      /2\/5/,
      "pump/refill discovery earns the core finding; longer season challenge stays optional",
    );
    assert.equal(checkpoints(), 2);
    await setRange('input[aria-label="Alternative water supply valve"]', "100");
    for (const [index, pump] of [0, 10, 15, 5].entries()) {
      await setRange(
        'input[aria-label="Seasonal pumping units"]',
        String(pump),
      );
      await click(`Run dry season ${index + 1} →`);
    }
    assert.match(status(), /2\/5/);
    assert.equal(checkpoints(), 2);
    await click("Pause all story animations");
    assert.equal(
      host.querySelector(".eg-game")?.getAttribute("data-motion"),
      "still",
    );
    await click("Replay story scenes from the beginning");
    assert.match(hint(), /Pump three times/);
    assert.equal(checkpoints(), 0);
    assert.equal(host.querySelector(".ep-reward"), null);
    assert.match(
      status(),
      /2\/5/,
      "global replay resets transient experiment, not collection",
    );
    await act(async () => {
      reduced = true;
      motion.forEach((fn) => fn());
    });
    await click("Pump water");
    assert.match(hint(), /thin layer/);
    await link('.es-contents a[href="#consequences"]');
    world("uneven");
    await click("Settle together");
    assert.match(hint(), /Make one end sink farther/);
    await click("Settle unevenly");
    assert.match(hint(), /Inspect the joining pipe/);
    assert.match(
      status(),
      /2\/5/,
      "unequal presets alone do not inspect the connection",
    );
    await click("Inspect the connection");
    assert.match(status(), /3\/5/);
    await click("Show me");
    assert.match(hint(), /equal drop/);
    await click("All stations");
    await link('#eg-all-stations a[href="#observations"]');
    world("evidence");
    assert.equal(host.querySelector("#eg-all-stations"), null);
    await history("#what-we-can-do");
    world("tokyo");
    assert.equal(window.document.activeElement, chapter("what-we-can-do"));
    await click("Keep measuring");
    assert.match(
      host.querySelector(".policy-city__result")!.textContent!,
      /monitoring alone/,
    );
    assert.match(
      status(),
      /3\/5/,
      "observation alone is not the cause/action finding",
    );
    await click("Limit withdrawals");
    assert.match(
      status(),
      /4\/5/,
      "changing withdrawal and observing the result earn the core finding",
    );
    assert.ok(host.querySelector(".ep-reward"));
    await click("Act early");
    await click("Wait longer");
    assert.match(status(), /4\/5/);
    await click("Next chapter");
    assert.equal(host.querySelectorAll("[data-world]").length, 0);
    assert.equal(window.document.activeElement, chapter("case-file"));
    assert.ok(host.querySelector("#case-file"));
    assert.equal(host.querySelectorAll(".ed-report-stamps button").length, 5);
    assert.equal(
      host.querySelectorAll(".es-quest-headlines").length,
      0,
      "field report is not a final multiple-choice exam",
    );
    assert.ok(host.querySelector(".ex-dossier-readings"));
    assert.match(
      host.querySelector(".ex-dossier")!.textContent!,
      /Synthetic radar[\s\S]*LOS range/,
    );
    await click("Save my field postcard");
    assert.deepEqual(browserErrors, []);
    const postcard = host.querySelector(
      'textarea[aria-label="Your complete field postcard"]',
    );
    assert.ok(postcard, "download has a persistent copyable alternative");
    assert.match(
      (postcard as unknown as HTMLTextAreaElement).value,
      /MY FIELD POSTCARD[\s\S]*My next question:[\s\S]*provisional NISAR/,
    );
    assert.match(
      host
        .querySelector('a[download="earthsignal-field-postcard.txt"]')
        ?.getAttribute("href") ?? "",
      /^blob:/,
    );
    await click("Previous chapter");
    world("tokyo");
    await history("#from-space", "hashchange");
    world("radar");
    assert.match(
      hint(),
      /Capture this visit|single visit/,
      "revisit starts a coherent fresh capture",
    );
    await click("Reset progress");
    await click("Yes, reset progress");
    assert.match(status(), /0\/5/);
    assert.equal(checkpoints(), 0);
    assert.equal(
      JSON.parse(window.localStorage.getItem("earthsignal:field-notes:v1")!)
        .notes.length,
      0,
      "reset discards saved readings with the generation",
    );
    assert.match(host.querySelector(".ep-campaign")!.textContent!, /0/);
    assert.equal(
      host.querySelectorAll('.ep-route [data-earned="true"]').length,
      0,
    );
    await history("#opening");
    assert.ok(host.querySelector(".ed-game-opening"));
    assert.equal(host.querySelectorAll(".eg-map-node").length, 5);
    await click("All stations");
    await act(async () =>
      host
        .querySelector(".eg-game")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    assert.equal(host.querySelector("#eg-all-stations"), null);
    assert.match(
      window.document.activeElement?.textContent ?? "",
      /All stations/,
    );
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
    assert.equal(observers.size, 0);
    assert.equal(motion.size, 0);
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
