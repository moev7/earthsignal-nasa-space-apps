import { PUBLIC_STUDIES } from "../lib/public-study-registry";
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import React, { act } from "react";
import { Window } from "happy-dom";
import { createHash } from "node:crypto";
import type { SarJob, SarRecord } from "../lib/sar-contract";
import { sarPlanSchema } from "../lib/sar-contract";

test("source discovery, preflight invalidation and account changes cannot enqueue stale science", async () => {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/workspace?view=sar" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const calls: { path: string; init?: RequestInit }[] = [];
  let delayed: ((r: Response) => void) | null = null;
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (path === "/api/sar-studies/search")
        return new Promise<Response>((resolve) => {
          delayed = resolve;
        });
      if (path === "/api/sar-studies/plan") {
        return Response.json({
          schemaVersion: "1.0",
          ready: true,
          request: JSON.parse(init!.body as string),
          method: "native-sar-study-1",
          quantity: "radar backscatter",
          unit: "dB",
          records: [],
          gates: [],
          notices: [],
          limits: { maxPixels: 262144, maxTransferBytes: 1024, maxSeconds: 30 },
        });
      }
      return Response.json({ jobs: [] });
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
  const click = async (text: string) => {
    const b = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(text),
    );
    assert.ok(b, text);
    await act(async () => b.click());
  };
  const reply = () =>
    Response.json({
      schemaVersion: "1.0",
      sourceId: "nisar",
      retrievedAt: "2026-11-13",
      status: "ready",
      notice: "Native masks remain to be checked.",
      limit: 24,
      complete: false,
      records: [
        {
          id: "nisar-scene",
          sourceId: "nisar",
          title: "Selected acquisition",
          product: "GCOV",
          acquiredAt: "2026-11-01T00:00:00Z",
          endAt: null,
          collection: "NISAR_L2_GCOV_V1",
          maturity: "validated",
          channels: ["HH"],
          bbox: null,
          scienceAssets: 1,
          referenceUrl: "https://nisar-docs.asf.alaska.edu/",
          notice: "Metadata only",
        },
      ],
    });
  try {
    const { SarWorkbench } = await import("../features/science/sar-workbench");
    await act(async () => root.render(React.createElement(SarWorkbench)));
    assert.deepEqual(
      calls.map((c) => c.path),
      ["/api/sar-studies"],
      "mount only loads owner-scoped history",
    );
    assert.equal(host.querySelectorAll(".sar-source-tabs button").length, 5);
    assert.equal(
      host.querySelectorAll(".sar-resources:last-child .sar-resource-grid article").length,
      14,
    );
    assert.equal(
      host.querySelectorAll(".sar-published-grid article").length,
      PUBLIC_STUDIES.length,
    );
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.ok(delayed);
    await click("SAOCOM");
    await act(async () => {
      delayed!(reply());
    });
    assert.equal(
      host.querySelectorAll(".sar-record").length,
      0,
      "late source response is discarded even if transport ignores abort",
    );
    assert.ok(
      calls.find((c) => c.path.endsWith("/search"))?.init?.signal?.aborted,
    );
    await click("NISAR");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await act(async () => {
      delayed!(reply());
    });
    await act(async () =>
      host
        .querySelector(".sar-record input")!
        .dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    );
    await click("Inspect processing plan");
    const run = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Run native study",
    )!;
    assert.equal(run.disabled, false);
    const channel = [...host.querySelectorAll("select")].find((s) =>
      s.parentElement?.textContent?.startsWith("Channel"),
    )!;
    await act(async () => {
      channel.value = "VV";
      channel.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.equal(run.disabled, true, "editing invalidates reviewed plan");
    await act(async () =>
      window.dispatchEvent(new window.Event("earthsignal-auth-changed")),
    );
    assert.equal(host.querySelectorAll(".sar-record").length, 0);
    assert.equal(host.querySelectorAll(".sar-plan").length, 0);
    assert.equal(
      calls.filter(
        (c) => c.path === "/api/sar-studies" && c.init?.method === "POST",
      ).length,
      0,
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    css.deregister();
    await window.happyDOM.close();
  }
});

const record: SarRecord = {
  id: "nisar-scene",
  sourceId: "nisar",
  title: "Native acquisition",
  product: "GCOV",
  acquiredAt: "2026-11-01T00:00:00Z",
  endAt: null,
  collection: "NISAR_L2_GCOV_V1",
  maturity: "validated",
  channels: ["HH"],
  bbox: null,
  scienceAssets: 1,
  referenceUrl: "https://nisar-docs.asf.alaska.edu/",
  notice: "Fixture metadata; not live processing evidence.",
};
const request = {
  schemaVersion: "1.0" as const,
  sourceId: "nisar" as const,
  operation: "backscatter-observation" as const,
  recordIds: [record.id],
  bbox: [51.25, 35.5, 51.26, 35.51] as [number, number, number, number],
  channel: "HH" as const,
};
const job: SarJob = {
  schemaVersion: "1.0",
  kind: "sar-study",
  id: "a".repeat(32),
  status: "queued",
  phase: "Waiting for the shared worker",
  createdAt: "2026-11-13T00:00:00Z",
  updatedAt: "2026-11-13T00:00:00Z",
  request,
  result: null,
  error: null,
};
const searchResponse = () =>
  Response.json({
    schemaVersion: "1.0",
    sourceId: "nisar",
    retrievedAt: "2026-11-13",
    status: "ready",
    notice: "Metadata only.",
    limit: 24,
    complete: false,
    records: [record],
  });
const planResponse = (init?: RequestInit) =>
  Response.json({
    schemaVersion: "1.0",
    ready: true,
    request: JSON.parse(init!.body as string),
    method: "native-sar-study-2",
    quantity: "radar backscatter",
    unit: "dB",
    records: [record],
    gates: [],
    notices: [],
    limits: { maxPixels: 262144, maxTransferBytes: 1024, maxSeconds: 30 },
  });

async function scenario(
  fetcher: (path: string, init?: RequestInit) => Promise<Response>,
  run: (s: {
    host: HTMLElement;
    window: Window;
    click: (text: string) => Promise<void>;
    change: (label: string, value: string) => Promise<void>;
    search: () => Promise<void>;
    select: () => Promise<void>;
    unmount: () => Promise<void>;
    revoked: string[];
  }) => Promise<void>,
) {
  const css = registerHooks({
    load(url, context, next) {
      return url.endsWith(".css")
        ? { format: "module", source: "export {};", shortCircuit: true }
        : next(url, context);
    },
  });
  const window = new Window({ url: "http://localhost/workspace?view=sar" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const revoked: string[] = [];
  let urlNumber = 0;
  class TestURL extends URL {
    static createObjectURL() {
      return `blob:fixture-${++urlNumber}`;
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
    fetch: fetcher,
    URL: TestURL,
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
  let mounted = true;
  const unmount = async () => {
    if (mounted) {
      await act(async () => root.unmount());
      mounted = false;
    }
  };
  try {
    const { SarWorkbench } = await import("../features/science/sar-workbench");
    await act(async () => root.render(React.createElement(SarWorkbench)));
    await run({
      host: host as unknown as HTMLElement,
      window,
      revoked,
      unmount,
      click: async (text) => {
        const b = [...host.querySelectorAll("button")].find((b) =>
          b.textContent?.includes(text),
        );
        assert.ok(b, text);
        assert.equal(b.disabled, false, text);
        await act(async () => b.click());
      },
      change: async (label, value) => {
        const input = [...host.querySelectorAll("select,input")].find((e) =>
          e.parentElement?.textContent?.trim().startsWith(label),
        );
        assert.ok(input, label);
        await act(async () => {
          if (input.tagName === "INPUT")
            Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )!.set!.call(input, value);
          else (input as unknown as HTMLSelectElement).value = value;
          input.dispatchEvent(new window.Event("input", { bubbles: true }));
          input.dispatchEvent(new window.Event("change", { bubbles: true }));
        });
      },
      search: async () => {
        await act(async () =>
          host
            .querySelector("form")!
            .dispatchEvent(
              new window.Event("submit", { bubbles: true, cancelable: true }),
            ),
        );
      },
      select: async () => {
        const input = host.querySelector(".sar-record input");
        assert.ok(input);
        await act(async () =>
          input.dispatchEvent(
            new window.MouseEvent("click", { bubbles: true }),
          ),
        );
      },
    });
  } finally {
    await unmount();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    css.deregister();
    await window.happyDOM.close();
  }
}

test("operations and channels follow the source and product; known incompatible selections cannot preflight", async () => {
  let planCalls = 0;
  await scenario(
    async (path, init) => {
      if (path.endsWith("/search")) return searchResponse();
      if (path.endsWith("/plan")) {
        planCalls++;
        return planResponse(init);
      }
      return Response.json({ jobs: [] });
    },
    async ({ host, click, change, search, select }) => {
      await click("RADARSAT-1");
      assert.match(host.textContent!, /Native pixel window/);
      assert.equal(
        (
          host.querySelector(
            'select option[value="native-observation"]',
          ) as HTMLOptionElement
        ).selected,
        true,
      );
      await click("RADARSAT Constellation");
      assert.ok(host.querySelector('select option[value="RR"]'));
      assert.ok(host.querySelector('select option[value="CH"]'));
      await click("UAVSAR");
      assert.equal(host.querySelector('select option[value="RR"]'), null);
      assert.equal(
        host.querySelector('select option[value="native-observation"]'),
        null,
      );
      await click("NISAR");
      await change("Native product", "GUNW");
      assert.equal(
        host.querySelector('select option[value="backscatter-change"]'),
        null,
      );
      assert.equal(
        (
          host.querySelector(
            'select option[value="los-displacement"]',
          ) as HTMLOptionElement
        ).selected,
        true,
      );
      await change("Native product", "GCOV");
      await change("Channel", "VV");
      await search();
      await select();
      const planButton = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Inspect processing plan"),
      )!;
      assert.equal(planButton.disabled, true);
      assert.match(host.textContent!, /does not list this channel/);
      await change("Channel", "HH");
      await click("Inspect processing plan");
      assert.equal(planCalls, 1);
      await change("Crop", "51.25,35.50,51.27,35.51");
      assert.equal(host.querySelector(".sar-plan"), null);
      assert.equal(host.querySelectorAll(".sar-record").length, 0);
    },
  );
});

test("submission retries retain one idempotency key; cancellation and unmount stop stale updates without polling", async () => {
  const keys: string[] = [];
  const calls: string[] = [];
  let pendingSearch:
    { resolve: (r: Response) => void; signal: AbortSignal } | undefined;
  let searchCount = 0;
  await scenario(
    async (path, init) => {
      calls.push(path);
      if (path.endsWith("/search")) {
        if (++searchCount === 1) return searchResponse();
        return new Promise<Response>((resolve) => {
          pendingSearch = { resolve, signal: init!.signal! };
        });
      }
      if (path.endsWith("/plan")) return planResponse(init);
      if (path === "/api/sar-studies" && init?.method === "POST") {
        keys.push((init.headers as Record<string, string>)["Idempotency-Key"]);
        if (keys.length === 1)
          throw Error("Connection interrupted after submission");
        return Response.json(job);
      }
      if (path.endsWith("/cancel"))
        return Response.json({
          ...job,
          status: "cancelled",
          phase: "Cancelled",
        });
      if (path.endsWith(job.id)) return Response.json(job);
      return Response.json({ jobs: [] });
    },
    async ({ host, click, search, select, unmount }) => {
      await search();
      await select();
      await click("Inspect processing plan");
      await click("Run native study");
      assert.match(host.textContent!, /Connection interrupted/);
      const runButton = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Run native study",
      )!;
      await act(async () => {
        runButton.click();
        runButton.click();
      });
      assert.equal(
        keys.length,
        2,
        "rapid duplicate clicks issue one submission",
      );
      await click("Run native study");
      assert.equal(new Set(keys).size, 1);
      assert.ok(keys[0].length >= 8);
      assert.equal(host.querySelectorAll(".sar-job-list button").length, 1);
      await click("Refresh status");
      await click("Cancel study");
      assert.match(
        host.querySelector(".sar-active-job")!.textContent!,
        /Cancelled/,
      );
      assert.equal(
        [...host.querySelectorAll("button")].some((b) =>
          b.textContent?.includes("Cancel study"),
        ),
        false,
      );
      await search();
      assert.ok(pendingSearch);
      const callCount = calls.length;
      await unmount();
      assert.equal(pendingSearch.signal.aborted, true);
      await act(async () => pendingSearch!.resolve(searchResponse()));
      assert.equal(
        calls.length,
        callCount,
        "no automatic polling or hidden post-unmount fetches",
      );
    },
  );
});

test("expired authentication removes reviewed plans and private data while public studies stay usable", async () => {
  let expired = false;
  await scenario(
    async (path, init) => {
      if (expired) return Response.json({ error: "Expired" }, { status: 401 });
      if (path.endsWith("/search")) return searchResponse();
      if (path.endsWith("/plan")) return planResponse(init);
      return Response.json({ jobs: [job] });
    },
    async ({ host, click, search, select }) => {
      await search();
      await select();
      await click("Inspect processing plan");
      expired = true;
      await click("Refresh history");
      assert.match(host.textContent!, /session expired/);
      assert.equal(host.querySelector(".sar-plan"), null);
      assert.equal(
        host.querySelectorAll(".sar-record,.sar-job-list button").length,
        0,
      );
      assert.equal(
        host.querySelectorAll(".sar-published-grid article").length,
        PUBLIC_STUDIES.length,
      );
    },
  );
});

test("native values preserve zero and missing cells, expose source metadata and downloads, and release artifact URLs", async () => {
  // Fixture bytes test rendering/integrity boundaries, never live scientific execution.
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const values = new TextEncoder().encode(
    JSON.stringify({ width: 2, height: 1, values: [0, null], unit: "dB" }),
  );
  const artifact = (bytes: Uint8Array) => ({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const completed: SarJob = {
    ...job,
    status: "completed",
    phase: "Complete",
    result: {
      schemaVersion: "1.0",
      kind: "sar-study",
      method: "native-sar-study-2",
      sourceId: "nisar",
      operation: "backscatter-observation",
      channel: "HH",
      quantity: "radar backscatter",
      unit: "dB",
      grid: {
        width: 2,
        height: 1,
        crs: "EPSG:32639",
        transform: [1, 10, 0, 2, 0, -10],
      },
      coverage: { total: 2, valid: 1, fraction: 0.5 },
      stats: { min: 0, median: 0, max: 0 },
      records: [record],
      notices: ["Display stretch only."],
      artifacts: {
        "preview.png": artifact(png),
        "values.json": artifact(values),
      },
      published: false,
      processedAt: "2026-11-13T00:00:00Z",
    },
  };
  await scenario(
    async (path) => {
      if (path.endsWith("preview.png")) return new Response(png);
      if (path.endsWith("values.json")) return new Response(values);
      return Response.json({ jobs: [completed] });
    },
    async ({ host, click, change, unmount, revoked }) => {
      await click("backscatter observation");
      for (
        let attempt = 0;
        attempt < 40 && !host.querySelector("output,[role='alert']");
        attempt++
      )
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      assert.match(host.querySelector("output")!.textContent!, /0.0000 dB/);
      await change("Column", "1");
      assert.match(
        host.querySelector("output")!.textContent!,
        /Unknown · no valid observation/,
      );
      assert.ok(host.querySelector('img[alt*="Native radar backscatter"]'));
      assert.match(
        host.querySelector(".sar-source-evidence")!.textContent!,
        /Native acquisition/,
      );
      assert.match(
        host.querySelector(".sar-source-evidence")!.textContent!,
        /2026-11-01/,
      );
      assert.ok(host.querySelector('a[download="values.json"][href^="blob:"]'));
      assert.ok(host.querySelector('a[download="preview.png"][href^="blob:"]'));
      await unmount();
      assert.equal(revoked.length, 2);
    },
  );
  await scenario(
    async (path) => {
      if (path.endsWith("preview.png")) return new Response(png);
      if (path.endsWith("values.json"))
        return new Response(new TextEncoder().encode("corrupt"));
      return Response.json({ jobs: [completed] });
    },
    async ({ host, click }) => {
      await click("backscatter observation");
      for (
        let attempt = 0;
        attempt < 40 && !host.querySelector("[role='alert']");
        attempt++
      )
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      assert.match(
        host.querySelector('[role="alert"]')!.textContent!,
        /integrity check failed/,
      );
      assert.equal(host.querySelector(".sar-result img"), null);
      assert.equal(host.querySelector('a[download="values.json"]'), null);
      assert.match(host.textContent!, /verification failed/);
    },
  );
  await scenario(
    async (path) =>
      path.includes("/artifacts/")
        ? Response.json({ error: "Expired" }, { status: 401 })
        : Response.json({ jobs: [completed] }),
    async ({ host, click }) => {
      await click("backscatter observation");
      assert.match(host.textContent!, /session expired/);
      assert.equal(host.querySelector(".sar-result"), null);
      assert.equal(host.querySelector(".sar-job-list"), null);
    },
  );
});

test("a mismatched ready plan and blank crop cannot authorize processing; empty discovery stays explicit", async () => {
  let empty = false;
  let searchCount = 0;
  await scenario(
    async (path, init) => {
      if (path.endsWith("/search")) {
        searchCount++;
        return empty
          ? Response.json({
              schemaVersion: "1.0",
              sourceId: "nisar",
              retrievedAt: "2026-11-13",
              status: "ready",
              notice: "No acquisitions in this window.",
              limit: 24,
              complete: true,
              records: [],
            })
          : searchResponse();
      }
      if (path.endsWith("/plan")) {
        const body = sarPlanSchema.parse(await planResponse(init).json());
        return Response.json({
          ...body,
          request: { ...body.request, channel: "VV" },
        });
      }
      return Response.json({ jobs: [] });
    },
    async ({ host, search, select, click, change }) => {
      await search();
      await select();
      await click("Inspect processing plan");
      assert.match(host.textContent!, /returned plan does not match/);
      const run = [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Run native study",
      )!;
      assert.equal(run.disabled, true);
      await change("Crop", ",35.50,0.01,35.51");
      await search();
      assert.equal(
        searchCount,
        1,
        "an empty coordinate is not silently coerced to zero",
      );
      empty = true;
      await change("Crop", "51.25,35.50,51.26,35.51");
      await search();
      assert.match(host.textContent!, /not evidence of no change/);
      assert.equal(host.querySelectorAll(".sar-record").length, 0);
    },
  );
});
