import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";
import type { LoadedBundle } from "../features/ground-truth/data/nisar";

test("the actual evidence map distinguishes a null grid value from zero, supports keyboard sampling and collects only both kinds", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window(),
    saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const { EvidenceMap } =
    await import("../features/public-story/discovery/DiscoveryWorld");
  const { StoryProvider } =
    await import("../features/ground-truth/components/story/StoryProvider");
  const { createRoot } = await import("react-dom/client");
  const bundle: LoadedBundle = {
    manifest: JSON.parse(
      readFileSync(
        new URL(
          "../public/data/nisar/tehran-sw-2026/manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    grid: JSON.parse(
      readFileSync(
        new URL(
          "../public/data/nisar/tehran-sw-2026/vertical_grid.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    imageUrl: "blob:verified-map-test",
  };
  const findings: string[] = [],
    host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const click = async (text: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    assert.ok(button);
    await act(async () => button.click());
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          StoryProvider,
          null,
          React.createElement(EvidenceMap, {
            bundle,
            onFinding: (message: string) => findings.push(message),
          }),
        ),
      ),
    );
    assert.equal(findings.length, 0);
    await click("Find gap");
    assert.match(host.querySelector("output")!.textContent!, /No measurement/);
    assert.match(
      host.querySelector(".ed-echo")!.textContent!,
      /Missing is not zero/,
    );
    assert.equal(findings.length, 0);
    await click("Sample patch");
    assert.match(host.querySelector("output")!.textContent!, /mm\/yr/);
    assert.equal(findings.length, 1);
    await click("Pin this reading");
    assert.ok(host.querySelector(".ea-kept-pin"));
    await click("Find gap");
    assert.match(
      host.querySelector(".ea-point-comparison")!.textContent!,
      /No measurement/,
    );
    assert.match(
      host.querySelector(".ea-point-comparison")!.textContent!,
      /gap cannot stand in for zero/,
    );
    assert.equal(
      findings.length,
      1,
      "repeated sampling does not duplicate discovery",
    );
    const map = host.querySelector(".ed-map-image")!;
    await act(async () =>
      map.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.ok(host.querySelector(".ed-map-pin"));
    assert.match(
      host.querySelector("figcaption")!.textContent!,
      /2026.*provisional/,
    );
    await act(async () =>
      host.querySelector("img")!.dispatchEvent(new window.Event("error")),
    );
    assert.match(host.textContent!, /could not be displayed/);
    assert.ok(host.querySelector('a[href="/explore"]'));
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
