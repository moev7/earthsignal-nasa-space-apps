import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import React, { act, useState } from "react";
import {
  Window,
  type HTMLButtonElement as HappyButton,
  type HTMLElement as HappyElement,
} from "happy-dom";
import { freshPlan, type CityPlan } from "../lib/discovery-play";

async function loadCity() {
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.endsWith(".css")) {
        return {
          url: "data:text/javascript,export default {}",
          shortCircuit: true,
        };
      }
      return next(specifier, context);
    },
  });
  try {
    return (await import("../features/public-story/discovery/PolicyCity"))
      .PolicyCity;
  } finally {
    hooks.deregister();
  }
}

async function fixture(
  run: (context: {
    City: Awaited<ReturnType<typeof loadCity>>;
    host: HappyElement;
    render: (node: React.ReactNode) => Promise<void>;
  }) => Promise<void>,
  viewport = { width: 1024, height: 768 },
) {
  const City = await loadCity();
  const window = new Window({ url: "http://localhost/", ...viewport });
  const saved = new Map<string, PropertyDescriptor | undefined>();
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
  const { createRoot } = await import("react-dom/client");
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await run({
      City,
      host,
      render: async (node) => {
        await act(async () => root.render(node));
      },
    });
  } finally {
    await act(async () => root.unmount());
    await window.happyDOM.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("PolicyCity exposes accessible controlled routes without mutating the supplied plan", async () => {
  await fixture(async ({ City, host, render }) => {
    const plan = Object.freeze(freshPlan());
    const changes: (keyof CityPlan)[] = [];
    await render(
      React.createElement(City, { plan, onChange: (key) => changes.push(key) }),
    );
    const routes = [
      ["limits", "Limit withdrawals"],
      ["supply", "Use other water supplies"],
      ["monitor", "Keep measuring"],
    ] as const;
    for (const [key, label] of routes) {
      const button = host.querySelector<HappyButton>(
        `button[data-route-key="${key}"]`,
      )!;
      assert.ok(button, `${key} has a native button`);
      assert.equal(button.getAttribute("type"), "button");
      assert.equal(button.getAttribute("aria-label"), label);
      assert.equal(button.getAttribute("aria-pressed"), "false");
      assert.equal(button.dataset.affordance, "route");
      await act(async () => button.click());
      assert.equal(
        button.getAttribute("aria-pressed"),
        "false",
        "only the parent changes selected state",
      );
    }
    assert.deepEqual(changes, ["limits", "supply", "monitor"]);
    assert.deepEqual(plan, freshPlan());
    assert.equal(host.querySelectorAll('[data-current="true"]').length, 1);
    assert.equal(
      host
        .querySelector('[data-current="true"]')
        ?.getAttribute("data-route-key"),
      "limits",
    );
    assert.match(host.textContent, /Illustration—not a forecast/);
  });
});

test("parent-controlled toggles reroute supply, reduce well draw, observe and fully reset", async () => {
  await fixture(async ({ City, host, render }) => {
    function Parent() {
      const [plan, setPlan] = useState(freshPlan);
      return React.createElement(City, {
        plan,
        onChange: (key) =>
          setPlan((previous) => ({ ...previous, [key]: !previous[key] })),
      });
    }
    await render(React.createElement(Parent));
    const initialSupply = host
      .querySelector('[data-water-route="supply"]')!
      .getAttribute("d");
    const initialWell = host
      .querySelector('[data-water-route="well"]')!
      .getAttribute("stroke-width");
    async function toggle(key: keyof CityPlan) {
      await act(async () =>
        host.querySelector<HappyButton>(`[data-route-key="${key}"]`)!.click(),
      );
    }
    await toggle("supply");
    assert.equal(
      host
        .querySelector('[data-route-key="supply"]')!
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.notEqual(
      host.querySelector('[data-water-route="supply"]')!.getAttribute("d"),
      initialSupply,
    );
    assert.ok(
      Number(
        host
          .querySelector('[data-water-route="well"]')!
          .getAttribute("stroke-width"),
      ) < Number(initialWell),
    );
    assert.equal(
      host
        .querySelector('[data-current="true"]')!
        .getAttribute("data-route-key"),
      "monitor",
    );
    await toggle("limits");
    assert.equal(
      host
        .querySelector('[data-water-route="well"]')!
        .getAttribute("data-flow"),
      "limited",
    );
    await toggle("monitor");
    assert.ok(host.querySelector('[data-observation="beam"]'));
    assert.equal(host.querySelectorAll('[data-current="true"]').length, 0);
    assert.match(
      host.querySelector('[role="status"]')!.textContent,
      /lost height does not simply return/,
    );
    for (const key of ["limits", "supply", "monitor"] as const)
      await toggle(key);
    assert.equal(
      host.querySelectorAll('button[aria-pressed="true"]').length,
      0,
    );
    assert.equal(
      host.querySelector('[data-water-route="supply"]')!.getAttribute("d"),
      initialSupply,
    );
    assert.equal(
      host
        .querySelector('[data-water-route="well"]')!
        .getAttribute("stroke-width"),
      initialWell,
    );
    assert.equal(host.querySelector('[data-observation="beam"]'), null);
    assert.match(
      host.querySelector('[role="status"]')!.textContent,
      /Start with the well/,
    );
    // A second cycle confirms replay does not depend on stale internal state.
    await toggle("limits");
    await toggle("monitor");
    assert.match(
      host.querySelector('[role="status"]')!.textContent,
      /You acted on groundwater use/,
    );
  });
});

test("monitoring alone leaves every physical water/ground element unchanged in all policy combinations", async () => {
  await fixture(async ({ City, host, render }) => {
    let ground: string | undefined;
    for (const limits of [false, true]) {
      for (const supply of [false, true]) {
        const plan = { limits, supply, monitor: false };
        await render(React.createElement(City, { plan, onChange: () => {} }));
        const physical = {
          ground: host.querySelector("[data-ground]")!.outerHTML,
          well: host.querySelector(".policy-city__well")!.outerHTML,
          supply: host.querySelector('[data-water-route="supply"]')!.outerHTML,
          route: host.querySelector('[data-water-route="well"]')!.outerHTML,
        };
        ground ??= physical.ground;
        assert.equal(
          physical.ground,
          ground,
          "no policy restores ground height",
        );
        await render(
          React.createElement(City, {
            plan: { ...plan, monitor: true },
            onChange: () => {},
          }),
        );
        assert.equal(
          host.querySelector("[data-ground]")!.outerHTML,
          physical.ground,
        );
        assert.equal(
          host.querySelector(".policy-city__well")!.outerHTML,
          physical.well,
        );
        assert.equal(
          host.querySelector('[data-water-route="supply"]')!.outerHTML,
          physical.supply,
        );
        assert.equal(
          host.querySelector('[data-water-route="well"]')!.outerHTML,
          physical.route,
        );
        assert.ok(host.querySelector('[data-observation="beam"]'));
        const description = host.querySelector("desc")!.textContent;
        assert.match(
          description,
          /Monitoring observes change; it does not reduce withdrawals or restore lost ground height/,
        );
        assert.doesNotMatch(
          description,
          /\b(safe|risk-free|recovered|mm|cm|percent)\b/i,
        );
        if (!limits && !supply) {
          assert.match(
            host.querySelector('[role="status"]')!.textContent,
            /monitoring alone does not reduce withdrawal/,
          );
          assert.match(
            host.querySelector("figcaption")!.textContent,
            /Well draw unchanged/,
          );
          assert.equal(
            host
              .querySelector('[data-current="true"]')!
              .getAttribute("data-route-key"),
            "limits",
          );
        }
      }
    }
  });
});

test("each city has its own SVG description and a polite result region", async () => {
  await fixture(async ({ City, host, render }) => {
    await render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(City, { plan: freshPlan(), onChange: () => {} }),
        React.createElement(City, {
          plan: { limits: true, supply: true, monitor: true },
          onChange: () => {},
        }),
      ),
    );
    const ids: string[] = [];
    for (const svg of host.querySelectorAll('svg[role="img"]')) {
      const references = svg.getAttribute("aria-labelledby")!.split(" ");
      for (const id of references) {
        assert.ok(host.ownerDocument.getElementById(id));
        assert.ok(
          !ids.includes(id),
          "descriptions must not collide across mounted cities",
        );
        ids.push(id);
      }
    }
    assert.equal(ids.length, 4);
    for (const status of host.querySelectorAll('[role="status"]')) {
      assert.equal(status.getAttribute("aria-live"), "polite");
      assert.equal(status.getAttribute("aria-atomic"), "true");
    }
  });
});

test("local controls retain responsive sizing and selected contrast under exhibition CSS", async () => {
  for (const width of [1440, 1366, 375, 390]) {
    await fixture(
      async ({ City, host, render }) => {
        // Shared CSS deliberately comes last. Fresh windows avoid happy-dom's
        // cached computed styles on resize; this checks cascade, not layout.
        host.className = "es-public";
        const document = host.ownerDocument;
        const globals = document.createElement("style");
        globals.textContent = readFileSync(
          new URL("../app/globals.css", import.meta.url),
          "utf8",
        );
        const local = document.createElement("style");
        local.textContent = readFileSync(
          new URL(
            "../features/public-story/discovery/policy-city.css",
            import.meta.url,
          ),
          "utf8",
        );
        const shared = document.createElement("style");
        shared.textContent = readFileSync(
          new URL(
            "../features/public-story/discovery/discovery.css",
            import.meta.url,
          ),
          "utf8",
        );
        document.head.append(globals, local, shared);
        await render(
          React.createElement(
            "div",
            { className: "ed-world" },
            React.createElement(City, {
              plan: { limits: true, supply: false, monitor: false },
              onChange: () => {},
            }),
          ),
        );
        const selected = host.querySelector<HappyButton>(
          '[data-route-key="limits"]',
        )!;
        const computed = document.defaultView!.getComputedStyle(selected);
        assert.equal(
          computed.minHeight,
          width < 540 ? "48px" : "66px",
          `controls exceed 44px at ${width}px`,
        );
        assert.equal(computed.justifyContent, "flex-start");
        assert.equal(
          computed.color,
          "#f1eee7",
          "selected control stays light on its dark surface",
        );
        assert.equal(
          computed.backgroundColor,
          "#293c36",
          "selected text keeps its dark background",
        );
        const legend = host.querySelector("figcaption")!;
        assert.ok(
          parseFloat(document.defaultView!.getComputedStyle(legend).fontSize) >= 13,
          "evidence captions remain readable on every viewport",
        );
        const dock = host.querySelector(".policy-city__controls")!;
        const columns =
          document.defaultView!.getComputedStyle(dock).gridTemplateColumns;
        if (width < 540) assert.equal(columns, "minmax(0, 1fr)");
        else assert.match(columns, /^repeat\(3,/);
        assert.equal(
          document.defaultView!.getComputedStyle(
            host.querySelector(".policy-city__art")!,
          ).maxHeight,
          "330px",
        );
      },
      { width, height: width === 1366 ? 768 : 900 },
    );
  }
});
