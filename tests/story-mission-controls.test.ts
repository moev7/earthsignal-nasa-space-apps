import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";
import { MISSION_STORAGE_KEY } from "../lib/story-missions";

test("actual mission controls hydrate stored progress, award once, teach errors and reset without network", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/" }),
    saved = new Map<string, PropertyDescriptor | undefined>();
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
    fetch: () => {
      throw new Error("Missions must not fetch");
    },
  }))
    install(key, value);
  window.localStorage.setItem(
    MISSION_STORAGE_KEY + ":aquifer",
    JSON.stringify({ version: 1, generation: "initial" }),
  );
  const before = window.localStorage.getItem(MISSION_STORAGE_KEY + ":aquifer");
  const { MissionProvider, Mission, MissionProgress } =
    await import("../features/public-story/missions/StoryMissions");
  const { renderToString } = await import("react-dom/server");
  const view = () =>
    React.createElement(
      MissionProvider,
      null,
      React.createElement(MissionProgress, { compact: false }),
      React.createElement(Mission, { id: "aquifer" }),
      React.createElement(Mission, { id: "uneven" }),
    );
  assert.match(
    renderToString(view()).replace(/<!--.*?-->/g, ""),
    /0\/5 discoveries, 0 points/,
  );
  assert.equal(
    window.localStorage.getItem(MISSION_STORAGE_KEY + ":aquifer"),
    before,
  );
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find((e) => e.textContent === label)!;
  try {
    await act(async () =>
      root.render(React.createElement(React.StrictMode, null, view())),
    );
    assert.match(
      host.querySelector(".es-missions-progress > summary")!.textContent!,
      /1\/5 discoveries, 20 points/,
    );
    await act(async () => button("Yes, water always lifts it back.").click());
    assert.match(
      host.querySelector(".es-missions-feedback")!.textContent!,
      /Try again; no points lost/,
    );
    assert.match(
      host.querySelector(".es-missions-feedback")!.textContent!,
      /may not reopen/,
    );
    await act(async () => {
      button("One end sinking farther than the other.").click();
      button("One end sinking farther than the other.").click();
    });
    assert.match(
      host.querySelector(".es-missions-progress > summary")!.textContent!,
      /2\/5 discoveries, 40 points/,
    );
    await act(async () => button("Hide missions").click());
    assert.equal(host.querySelectorAll(".es-missions-question").length, 0);
    await act(async () => button("Show missions").click());
    assert.equal(host.querySelectorAll(".es-missions-question").length, 2);
    await act(async () => button("Reset progress").click());
    assert.ok(button("Yes, reset progress"));
    await act(async () => button("Yes, reset progress").click());
    assert.match(
      host.querySelector(".es-missions-progress > summary")!.textContent!,
      /0\/5 discoveries, 0 points/,
    );
    assert.equal(window.document.activeElement, button("Reset progress"));
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
