import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";

test("measured plus missing earn the core finding; optional footprint and GCOV proofs remain accurate", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window(),
    saved = new Map<string, PropertyDescriptor | undefined>();
  const requests: string[] = [];
  class Observer {
    observe() {}
    disconnect() {}
  }
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IntersectionObserver: Observer,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string) => {
      assert.ok(url.startsWith("/data/"));
      assert.ok(!url.includes(".."));
      requests.push(url);
      return new Response(
        readFileSync(new URL("../public" + url, import.meta.url)),
      );
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  const { createRoot } = await import("react-dom/client");
  const { StoryProvider } =
    await import("../features/ground-truth/components/story/StoryProvider");
  const { DiscoveryWorld } =
    await import("../features/public-story/discovery/DiscoveryWorld");
  const { GameActivity } =
    await import("../features/public-story/quest/GameObjective");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  const findings: string[] = [],
    masks: number[] = [];
  const wait = async (selector: string) => {
    for (let i = 0; i < 150 && !host.querySelector(selector); i++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    assert.ok(host.querySelector(selector), selector);
  };
  const click = async (label: string) => {
    const b = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    assert.ok(b, label);
    await act(async () => b.click());
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          StoryProvider,
          null,
          React.createElement(
            GameActivity.Provider,
            { value: (_id, mask) => masks.push(mask) },
            React.createElement(DiscoveryWorld, {
              id: "evidence",
              onFinding: (message: string) => findings.push(message),
            }),
          ),
        ),
      ),
    );
    await wait(".ed-map-image");
    assert.equal(findings.length, 0);
    await click("Sample patch");
    await click("Find gap");
    assert.equal(
      findings.length,
      1,
      "real measured-versus-missing comparison earns the core finding",
    );
    assert.match(host.querySelector("output")!.textContent!, /No measurement/);
    await click("Inspect footprints");
    assert.ok(host.textContent!.includes("about 12 MB"));
    await click("Load checked footprint evidence");
    await wait(".ex-footprint-tray");
    const collection = JSON.parse(
      readFileSync(
        new URL(
          "../public/data/nisar/tehran-sw-2026/buildings.geojson",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const weak = collection.features.find(
      (f: { properties: { category: string } }) =>
        f.properties.category === "not_enough_evidence",
    );
    assert.ok(
      weak.properties.ground_tilt_per_year <
        2 * weak.properties.ground_tilt_sigma_per_year,
    );
    const footprint = [...host.querySelectorAll("button")].find(
      (b) =>
        b.closest(".ex-footprint-tray") &&
        b.textContent?.includes(String(weak.properties.osm_id)),
    );
    assert.ok(footprint);
    await act(async () => footprint.click());
    assert.match(
      host.querySelector(".ex-footprints")!.textContent!,
      /not enough evidence/,
    );
    assert.equal(findings.length, 1, "optional audit never awards a duplicate");
    await click("Radar images");
    await wait(".es-radar-study-stage");
    await act(async () =>
      host.querySelector(".es-radar-study-stage")!.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(findings.length, 1);
    assert.match(
      host.querySelector(".es-radar-study-inspection")!.textContent!,
      /dB/,
    );
    assert.ok(masks.includes(7));
    assert.equal(
      host.querySelectorAll('.ex-truth-audit [data-proved="true"]').length,
      3,
    );
    assert.ok(requests.some((p) => p.endsWith("buildings.geojson")));
    assert.ok(requests.some((p) => p.endsWith("values.json")));
    await click("Ground map");
    await wait(".ed-map-image");
    await click("Sample patch");
    await click("Find gap");
    assert.equal(
      findings.length,
      1,
      "repeated proof never duplicates the finding",
    );
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
