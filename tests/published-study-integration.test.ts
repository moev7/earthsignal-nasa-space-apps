import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import React, { act } from "react";
import { Window } from "happy-dom";
import { PUBLIC_STUDIES } from "../lib/public-study-registry";

test("the public page mounts one verified inspector, preserves reproduction handoff and withholds failed revisions", async () => {
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url)
    .href;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return specifier === "next/image"
        ? {
            url:
              "data:text/javascript," +
              encodeURIComponent(
                `import React from ${JSON.stringify(reactUrl)}; export default function Image({unoptimized, ...props}) { return React.createElement("img", props); }`,
              ),
            shortCircuit: true,
          }
        : next(specifier, context);
    },
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const studies = PUBLIC_STUDIES.filter((s) =>
    s.manifestUrl.startsWith("/data/sar/"),
  );
  const first = studies.find((s) => s.id === "tehran-validated-gcov-20261028")!,
    second = studies.find((s) => s.id === "radarsat-1-arctic-1996")!;
  const assets = new Map<string, Uint8Array>();
  for (const s of [first, second])
    for (const name of ["manifest.json", "preview.png", "values.json"]) {
      const path = s.manifestUrl.replace("manifest.json", name);
      assets.set(
        path,
        new Uint8Array(
          await readFile(new URL("../public" + path, import.meta.url)),
        ),
      );
    }
  const window = new Window({ url: "http://localhost/studies/tehran" }),
    saved = new Map<string, PropertyDescriptor | undefined>();
  const revoked: string[] = [],
    fetched: string[] = [];
  let urls = 0;
  class TestURL extends URL {
    static createObjectURL() {
      return `blob:fixture-${++urls}`;
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
    fetch: async (input: string, init?: RequestInit) => {
      assert.equal(init?.credentials, "omit");
      fetched.push(input);
      return new Response(new Uint8Array(assets.get(input)!));
    },
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(host as unknown as HTMLElement);
  try {
    const { PublishedSarStudy } =
      await import("../features/science/published-sar-study");
    const render = async (study: typeof first) => {
      await act(async () => {
        root.render(React.createElement(PublishedSarStudy, { study }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    };
    await render(first);
    assert.equal(host.querySelectorAll(".study-inspection").length, 1);
    assert.equal(host.querySelectorAll("img").length, 1);
    assert.equal(host.querySelectorAll(".study-inspection-profile").length, 1);
    assert.ok(
      [...host.querySelectorAll("a")].some((a) =>
        a.href.includes("investigation=tehran-echo"),
      ),
    );
    const pin = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Pin A",
    )!;
    await act(async () => pin.click());
    assert.equal(host.querySelectorAll(".study-inspection-pin").length, 1);
    assets.set(second.manifestUrl, new TextEncoder().encode("{}"));
    await render(second);
    assert.equal(
      host.querySelectorAll(".study-inspection").length,
      0,
      "a failed revision cannot reuse previous measurements",
    );
    assert.match(
      host.querySelector('[role="alert"]')!.textContent!,
      /withheld/,
    );
    assert.ok(revoked.includes("blob:fixture-1"));
    assets.set(
      second.manifestUrl,
      new Uint8Array(
        await readFile(
          new URL("../public" + second.manifestUrl, import.meta.url),
        ),
      ),
    );
    await act(async () => host.querySelector("button")!.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    assert.equal(host.querySelectorAll(".study-inspection").length, 1);
    assert.equal(
      host.querySelectorAll(".study-inspection-pin").length,
      0,
      "retry initializes the new study's pins",
    );
    assert.match(host.textContent!, /not geocoded/);
    assert.ok(
      fetched.every((path) => path.startsWith("/data/sar/")),
      "public inspection never requests a private source or processing endpoint",
    );
  } finally {
    await act(async () => root.unmount());
    assert.ok(revoked.includes(`blob:fixture-${urls}`));
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    hooks.deregister();
    await window.happyDOM.close();
  }
});
