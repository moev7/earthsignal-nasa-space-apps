import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import React, { act } from "react";
import { Window } from "happy-dom";

test("supporting scene help is a named, finite native dialog that preserves the scene and returns focus", async () => {
  const styles = registerHooks({ load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "export {};", shortCircuit: true } : next(url, context); } });
  const window = new Window({ url: "http://localhost/" }), saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client"); const { ContextNote } = await import("../features/public-story/ContextNote");
  const host = window.document.createElement("div"); window.document.body.append(host); const root = createRoot(host as unknown as HTMLElement);
  let renders = 0;
  const Scene = () => { renders++; return React.createElement("canvas", { "aria-label": "Measured ground motion" }); };
  try {
    await act(async () => root.render(React.createElement("section", null, React.createElement(Scene),
      React.createElement("strong", null, "Projection · if these rates continued"),
      React.createElement(ContextNote, { label: "About this projection" }, React.createElement("p", null, "Full source, reference and model assumptions.")))));
    const trigger = host.querySelector("button")!, dialog = host.querySelector("dialog")!, canvas = host.querySelector("canvas");
    assert.equal(trigger.getAttribute("aria-haspopup"), "dialog"); assert.equal(trigger.getAttribute("aria-expanded"), "false"); assert.equal(dialog.open, false);
    assert.equal(host.querySelectorAll("details").length, 0, "help cannot expand the sticky scene's document box");
    await act(async () => trigger.click());
    assert.equal(dialog.open, true); assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(window.document.activeElement?.id, dialog.getAttribute("aria-labelledby"));
    assert.equal(host.querySelector("canvas"), canvas); assert.equal(renders, 1, "help state never remounts or rerenders the scene");
    await act(async () => dialog.querySelector("button")!.click());
    assert.equal(dialog.open, false); assert.equal(trigger.getAttribute("aria-expanded"), "false"); assert.equal(window.document.activeElement, trigger);
    await act(async () => trigger.click());
    await act(async () => { dialog.close(); }); // Native Escape follows the same close event; real key behaviour belongs to the browser.
    assert.equal(window.document.activeElement, trigger);
    const css = await readFile(new URL("../features/public-story/context-note.css", import.meta.url), "utf8");
    assert.match(css, /position:fixed/); assert.match(css, /overscroll-behavior:contain/); assert.match(css, /min-height:44px/);
    assert.ok(host.querySelector("strong")?.textContent?.includes("if these rates continued"), "meaning-changing condition is outside the closed help");
  } finally {
    await act(async () => root.unmount()); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    styles.deregister(); await window.happyDOM.close();
  }
});
