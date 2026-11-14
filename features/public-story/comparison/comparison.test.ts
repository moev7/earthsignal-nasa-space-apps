import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { Window } from "happy-dom";
import React, { act } from "react";
import { TEHRAN, TOKYO } from "@/features/ground-truth/data/cities";
import { COMPARISON_ROWS } from "@/features/ground-truth/data/comparison";
import { LEARNINGS } from "@/features/ground-truth/data/stories";
import {
  illustrationBand,
  latestMilestone,
  milestones,
  nearestYear,
  pointAtYear,
  trendYears,
} from "./model";

test("point inspection retains exact source points, missing years and illustrative bounds", () => {
  const sourceBefore = JSON.stringify([TEHRAN, TOKYO]);
  assert.equal(TEHRAN.trend.length, 11);
  assert.equal(TOKYO.trend.length, 15);
  for (const city of [TEHRAN, TOKYO]) {
    for (const point of city.trend) {
      assert.equal(pointAtYear(city, point.year), point);
      assert.deepEqual(illustrationBand(point), {
        low: Math.max(0, Math.abs(point.rateMmPerYear) - point.uncertainty),
        high: Math.abs(point.rateMmPerYear) + point.uncertainty,
      });
    }
  }
  assert.equal(
    pointAtYear(TOKYO, 1956),
    undefined,
    "a historical event year is not manufactured into a chart reading",
  );
  assert.equal(pointAtYear(TEHRAN, 1962), undefined);
  assert.equal(illustrationBand(TOKYO.trend.at(-1)!).low, 0);
  assert.equal(nearestYear(trendYears([TEHRAN, TOKYO]), 2004), 2003);
  assert.equal(JSON.stringify([TEHRAN, TOKYO]), sourceBefore);
});

test("the timeline retains both distinct Tokyo 1962 entries and preferred same-year selection", () => {
  const entries = milestones([TEHRAN, TOKYO]);
  assert.equal(entries.length, 13);
  assert.equal(new Set(entries.map((entry) => entry.key)).size, 13);
  const sameYear = entries.filter(
    (entry) => entry.city.id === "tokyo" && entry.event.year === 1962,
  );
  assert.deepEqual(
    sameYear.map((entry) => entry.event.title),
    ["Peak subsidence", "Building Water Law"],
  );
  assert.notEqual(sameYear[0].key, sameYear[1].key);
  assert.equal(latestMilestone(entries, 1962, sameYear[0].key), sameYear[0]);
  assert.equal(latestMilestone(entries, 1963, sameYear[1].key), sameYear[1]);
  assert.equal(latestMilestone(entries, 1899), undefined);
  assert.equal(latestMilestone(entries, 2020)?.city.id, "tehran");
});

test("public comparison controls and Tokyo embed retain source content and honest readings", async () => {
  // CSS is owned by the browser; omit it from this component-interaction test.
  const cssHook = registerHooks({
    load(url, context, nextLoad) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/compare" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  const resizeTargets: {
    callback: (entries: { contentRect: { width: number } }[]) => void;
  }[] = [];
  for (const [key, value] of Object.entries({
    window,
    self: window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    install(key, value);
  install(
    "ResizeObserver",
    class {
      constructor(
        readonly callback: (
          entries: { contentRect: { width: number } }[],
        ) => void,
      ) {
        resizeTargets.push(this);
      }
      observe() {
        this.callback([{ contentRect: { width: 1100 } }]);
      }
      disconnect() {}
    },
  );
  const { createRoot } = await import("react-dom/client");
  const { CityComparison } = await import("./CityComparison");
  const { TokyoStory } = await import("./TokyoStory");
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const click = async (selector: string) => {
    const button = host.querySelector(selector);
    assert.ok(button, selector);
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  };
  const changeSelect = async (selector: string, value: string) => {
    const select = host.querySelector(selector);
    assert.ok(select instanceof window.HTMLSelectElement, selector);
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  };
  const changeRange = async (selector: string, value: string) => {
    const input = host.querySelector(selector);
    assert.ok(input instanceof window.HTMLInputElement, selector);
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () => {
      root.render(React.createElement(CityComparison));
    });
    assert.equal(
      host.querySelectorAll(".ec-table tbody tr").length,
      COMPARISON_ROWS.length,
    );
    for (const city of [TEHRAN, TOKYO]) {
      for (const value of [
        ...Object.values(city.context),
        ...city.primaryCauses,
        ...city.observationSources,
        ...city.evidenceAfterIntervention,
      ])
        assert.ok(host.textContent.includes(value), value);
      for (const policy of city.policies)
        assert.ok(host.textContent.includes(policy.effect), policy.name);
      for (const phase of city.groundwater.history)
        assert.ok(host.textContent.includes(phase.detail), phase.period);
    }
    for (const lesson of LEARNINGS)
      assert.ok(host.textContent.includes(lesson.detail), lesson.title);
    assert.equal(host.querySelectorAll(".ec-trend polyline").length, 2);
    assert.equal(host.querySelectorAll(".ec-trend polygon").length, 2);
    assert.match(
      host.querySelector(".ec-point-readings")!.textContent,
      /No illustrated point in 1962/,
    );
    assert.match(host.querySelector(".ec-point-readings")!.textContent, /240/);
    await changeSelect('select[aria-label="Illustrated chart year"]', "2003");
    assert.match(host.querySelector(".ec-point-readings")!.textContent, /80/);
    assert.match(
      host.querySelector(".ec-point-readings")!.textContent,
      /No illustrated point in 2003/,
    );
    await click(".ec-series-controls button:first-child");
    assert.equal(host.querySelectorAll(".ec-trend polyline").length, 1);
    assert.equal(
      host
        .querySelector(".ec-series-controls button")!
        .getAttribute("aria-pressed"),
      "false",
    );
    await click(".ec-series-controls button:nth-child(2)");
    assert.equal(host.querySelectorAll(".ec-trend polyline").length, 0);
    assert.match(
      host.querySelector(".ec-empty")!.textContent,
      /Both series are hidden/,
    );
    await click(".ec-series-controls button:first-child");
    await click('.ec-series-controls input[type="checkbox"]');
    assert.equal(host.querySelectorAll(".ec-trend polygon").length, 0);
    await click('button[aria-label="Tokyo 1962, Impact: Peak subsidence"]');
    assert.equal(
      host.querySelector(".ec-event-detail h3")!.textContent,
      "Peak subsidence",
    );
    await click('button[aria-label="Tokyo 1962, Policy: Building Water Law"]');
    assert.equal(
      host.querySelector(".ec-event-detail h3")!.textContent,
      "Building Water Law",
    );
    await changeSelect(
      'select[aria-label="Select a historical milestone"]',
      "tokyo-0",
    );
    assert.equal(
      host.querySelector(".ec-event-detail h3")!.textContent,
      TOKYO.timeline[0].title,
    );
    assert.equal(
      host
        .querySelector('.ec-timeline input[type="range"]')!
        .getAttribute("value"),
      "1900",
    );
    await changeRange('.ec-timeline input[type="range"]', "2015");
    assert.equal(
      host.querySelector(".ec-event-detail h3")!.textContent,
      "Monitoring networks expand",
    );
    await changeRange('.ec-trend input[type="range"]', "0");
    assert.equal(host.querySelector(".ec-trend output")!.textContent, "1900");
    // Geometry responds without dropping points at narrow widths; this is not visual browser QA.
    await act(async () => {
      for (const target of resizeTargets)
        target.callback([{ contentRect: { width: 320 } }]);
    });
    assert.match(
      host.querySelector(".ec-plot svg")!.getAttribute("viewBox")!,
      /^0 0 320 350$/,
    );
    assert.ok(
      host
        .querySelector(".ec-plot svg title")!
        .textContent.includes("not measurements"),
    );
    await act(async () => {
      root.render(React.createElement(TokyoStory));
    });
    await changeSelect('select[aria-label="Tokyo historical event"]', "3");
    assert.match(
      host.querySelector(".ec-tokyo-readout")!.textContent,
      /No illustrated point in 1956/,
    );
    assert.equal(
      host.querySelector(".ec-tokyo-event h4")!.textContent,
      "Industrial Water Law",
    );
    await changeSelect('select[aria-label="Tokyo historical event"]', "4");
    assert.equal(
      host.querySelector(".ec-tokyo-event h4")!.textContent,
      "Building Water Law",
    );
    assert.equal(
      host
        .querySelector(".ec-tokyo-presets button:first-child")!
        .getAttribute("aria-pressed"),
      "false",
    );
    await click(".ec-tokyo-presets button:first-child");
    assert.equal(
      host.querySelector(".ec-tokyo-event h4")!.textContent,
      "Peak subsidence",
    );
    await click(".ec-tokyo-presets button:nth-child(2)");
    assert.equal(
      host.querySelector(".ec-tokyo-event h4")!.textContent,
      "Trend largely arrested",
    );
    assert.match(
      host.querySelector(".ec-tokyo-readout .ec-point-reading")!.textContent,
      /35/,
    );
    assert.match(
      host.querySelector(".ec-tokyo-figure figcaption")!.textContent,
      /not a measured Tokyo time series/,
    );
    await changeRange(
      '.ec-tokyo-story input[type="range"]',
      String(
        Number(
          host
            .querySelector('.ec-tokyo-story input[type="range"]')!
            .getAttribute("max"),
        ),
      ),
    );
    assert.equal(
      host.querySelector(".ec-tokyo-story output")!.textContent,
      "2023",
    );
    assert.match(
      host.querySelector(".ec-tokyo-readout .ec-point-reading")!.textContent,
      /4/,
    );
  } finally {
    await act(async () => root.unmount());
    cssHook.deregister();
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
