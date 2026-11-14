import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";

test("a chapter arrow resolves the actual reading position before a queued scroll render and cleans its frame", async () => {
  const css = registerHooks({
    load(url, ctx, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, ctx);
    },
  });
  const window = new Window({ url: "http://localhost/" }),
    saved = new Map<string, PropertyDescriptor | undefined>(),
    frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  const positions: Record<string, number> = {
    opening: 0,
    "hidden-cause": 1000,
    consequences: 2000,
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const top = positions[this.id] ?? 0;
    return new window.DOMRect(0, top, 100, 1000);
  };
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      frames.set(++sequence, fn);
      return sequence;
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
  const { PublicFrame } = await import("../features/public-story/PublicShell");
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(async () =>
      root.render(
        React.createElement(
          PublicFrame,
          { page: "story" } as React.ComponentProps<typeof PublicFrame>,
          ["opening", "hidden-cause", "consequences"].map((id) =>
            React.createElement("section", { key: id, id, tabIndex: -1 }, id),
          ),
        ),
      ),
    );
    positions.opening = -1000;
    positions["hidden-cause"] = 120;
    positions.consequences = 1500;
    // Deliberately leave the frame queued: React still displays the opening label.
    assert.match(
      host.querySelector(".es-contents summary")!.textContent!,
      /ground beneath/,
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.getAttribute("aria-label") === "Next chapter")!
        .click(),
    );
    assert.equal(window.location.hash, "#consequences");
    assert.equal(window.document.activeElement?.id, "consequences");
    await act(async () => root.unmount());
    assert.equal(frames.size, 0);
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
