import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { Window } from "happy-dom";
import { PUBLIC_STUDIES } from "../lib/public-study-registry";
import { publishedSarSchema } from "../lib/public-sar-study";

test("native inspection pins exact cells, exposes numeric controls, keeps notes local, and releases download URLs", async () => {
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url)
    .href;
  const css = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "next/image")
        return {
          url:
            "data:text/javascript," +
            encodeURIComponent(
              `import React from ${JSON.stringify(reactUrl)}; export default function Image({unoptimized, ...props}) { return React.createElement("img", props); }`,
            ),
          shortCircuit: true,
        };
      return next(specifier, context);
    },
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/studies/fixture" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const blobs: Blob[] = [],
    revoked: string[] = [],
    requested: { href: string; name: string }[] = [];
  let failDownload = false,
    networkCalls = 0;
  class TestURL extends URL {
    static createObjectURL(blob: Blob) {
      if (failDownload) throw Error("Fixture download failure");
      blobs.push(blob);
      return `blob:local-${blobs.length}`;
    }
    static revokeObjectURL(url: string) {
      revoked.push(url);
    }
  }
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    URL: TestURL,
    fetch: async () => {
      networkCalls++;
      throw Error("Network is outside this component contract");
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const oldClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {
    requested.push({ href: this.href, name: this.download });
  };
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(host as unknown as HTMLElement);
  let mounted = true;
  const click = async (text: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    assert.ok(button, text);
    assert.equal(button.disabled, false);
    await act(async () => button.click());
  };
  const change = async (label: string, value: string) => {
    const node = [...host.querySelectorAll("input,textarea,select")].find(
      (n) => {
        const l = host.querySelector(`label[for="${n.id}"]`);
        return l?.textContent?.startsWith(label);
      },
    );
    assert.ok(node, label);
    await act(async () => {
      (node as unknown as HTMLElement).focus();
      const proto =
        node.tagName === "INPUT"
          ? window.HTMLInputElement.prototype
          : node.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
      node.dispatchEvent(new window.Event("input", { bubbles: true }));
      node.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  };
  try {
    const { StudyInspection } =
      await import("../features/science/study-inspection");
    const original = PUBLIC_STUDIES.find(
      (s) => s.id === "tehran-validated-gcov-20261028",
    )!;
    const source = publishedSarSchema.parse(
      JSON.parse(
        readFileSync(
          new URL(`../public${original.manifestUrl}`, import.meta.url),
          "utf8",
        ),
      ),
    );
    const study = { ...original, coverageFraction: 7 / 8 };
    const manifest = {
      ...source,
      grid: {
        width: 4,
        height: 2,
        crs: "SOURCE_PIXEL_GRID (not geocoded)",
        transform: [3700, 1, 0, 5600, 0, 1],
      },
      coverage: { total: 8, valid: 7, fraction: 7 / 8 },
    };
    const values = [0, 10, null, -10, 2, 3, 4, 5];
    const props = {
      study,
      manifest,
      values,
      imageUrl: "blob:verified-original",
    };
    await act(async () =>
      root.render(
        React.createElement(StudyInspection, {
          ...props,
          key: `${study.id}:${study.revision}`,
        }),
      ),
    );
    assert.match(host.querySelector("output")!.textContent!, /0 dB/);
    assert.match(host.textContent!, /2026-10-28T01:46:24Z/);
    assert.match(host.textContent!, /not latitude or longitude/);
    for (const input of host.querySelectorAll("input")) {
      assert.equal(input.type, "number");
      assert.equal(input.step, "1");
      assert.equal(input.min, "0");
    }
    assert.equal(host.querySelector("input")!.max, "1");
    await click("Pin A");
    await click("Pin B");
    assert.equal(
      host.querySelector(".study-inspection-pin")!.textContent,
      "A/B",
    );
    assert.match(
      host.querySelector(".study-inspection-comparison")!.textContent!,
      /same cell/,
    );
    await change("Column", "1");
    await click("Pin B");
    assert.equal(host.querySelectorAll(".study-inspection-pin").length, 2);
    assert.match(
      host.querySelector(".study-inspection-comparison")!.textContent!,
      /B − A = 10 dB/,
    );
    assert.match(
      host.querySelector(".study-inspection-comparison")!.textContent!,
      /Backscatter power B\/A: 10/,
    );
    await change("Column", "2");
    await click("Pin B");
    assert.match(
      host.querySelector("output")!.textContent!,
      /No valid measurement \(null\)/,
    );
    assert.match(
      host.querySelector(".study-inspection-comparison")!.textContent!,
      /Contrast withheld/,
    );
    assert.equal(
      host.querySelectorAll(".study-inspection-profile polyline").length,
      2,
      "row trace splits at missing cell",
    );

    // A container could have padding; only the actual image bounds determine the selected cell.
    const image = host.querySelector("img")!;
    Object.defineProperty(image, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 80, top: 120, width: 200, height: 100 }),
    });
    await act(async () =>
      image.dispatchEvent(
        new window.MouseEvent("click", {
          bubbles: true,
          clientX: 255,
          clientY: 195,
        }),
      ),
    );
    assert.match(
      host.querySelector("output")!.textContent!,
      /Row 1, column 3: 5 dB/,
    );
    await act(async () =>
      image.dispatchEvent(
        new window.MouseEvent("click", {
          bubbles: true,
          clientX: 70,
          clientY: 195,
        }),
      ),
    );
    assert.match(
      host.querySelector("output")!.textContent!,
      /Row 1, column 3: 5 dB/,
    );
    await click("Pin B");
    await change(
      "My interpretation",
      "My tentative idea <script>unverified</script>",
    );
    await change("Proposed next check", "source-quality");
    assert.equal(host.querySelector("script"), null);
    assert.match(host.textContent!, /Why: Read source masks/);
    await click("Download investigation JSON");
    const brief = JSON.parse(await blobs[0].text());
    assert.equal(brief.pins.A.sample.value, 0);
    assert.equal(brief.pins.B.sample.value, 5);
    assert.deepEqual(brief.pins.B.sample.nativeCentre, {
      x: 3703.5,
      y: 5601.5,
    });
    assert.equal(
      brief.interpretation.text,
      "My tentative idea <script>unverified</script>",
    );
    assert.equal(brief.interpretation.verification, "unverified");
    assert.equal(brief.evidence.manifestSha256, study.manifestSha256);
    assert.equal(brief.nextCheck.status, "proposed; not performed");
    assert.ok(requested[0].name.endsWith("investigation.json"));
    assert.equal(
      window.document.querySelectorAll("a[download]").length,
      0,
      "temporary anchor is removed",
    );

    await click("Download native row CSV");
    assert.deepEqual(
      revoked,
      ["blob:local-1"],
      "next request releases earlier URL immediately",
    );
    assert.match(await blobs[1].text(), /1,3,5,true,3703\.5,5601\.5/);
    assert.ok(requested[1].name.endsWith("row-1.csv"));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.deepEqual(
      revoked,
      ["blob:local-1", "blob:local-2"],
      "completed request expires its object URL",
    );
    await click("Clear comparison");
    assert.equal(host.querySelectorAll(".study-inspection-pin").length, 0);
    await click("Download investigation JSON");
    assert.equal(
      JSON.parse(await blobs[2].text()).pins.A.status,
      "not-selected",
    );
    await act(async () =>
      root.render(
        React.createElement(StudyInspection, {
          ...props,
          key: "new-study-revision",
        }),
      ),
    );
    assert.equal(
      host.querySelector("textarea")!.value,
      "",
      "root key resets local hypothesis",
    );
    assert.deepEqual(
      revoked,
      ["blob:local-1", "blob:local-2", "blob:local-3"],
      "key change cleans pending URL and timer",
    );
    await change("My interpretation", "Retain this if download fails");
    failDownload = true;
    await click("Download investigation JSON");
    assert.match(host.textContent!, /Download could not be created/);
    assert.equal(
      host.querySelector("textarea")!.value,
      "Retain this if download fails",
    );
    failDownload = false;
    await click("Download investigation JSON");
    await act(async () => root.unmount());
    mounted = false;
    assert.deepEqual(
      revoked,
      ["blob:local-1", "blob:local-2", "blob:local-3", "blob:local-4"],
      "unmount releases remaining download",
    );
    assert.equal(
      new Set(revoked).size,
      revoked.length,
      "cancelled timers do not double revoke",
    );
    assert.equal(networkCalls, 0);
  } finally {
    if (mounted) await act(async () => root.unmount());
    window.HTMLAnchorElement.prototype.click = oldClick;
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    css.deregister();
    await window.happyDOM.close();
  }
});
