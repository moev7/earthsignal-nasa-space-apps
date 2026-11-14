/** Optional real-browser release check. Uses an already-installed official
 * Playwright module and browser, never downloads or changes dependencies.
 * node scripts/verify-field-investigation.mjs /absolute/playwright/index.mjs [base URL] [WebKit executable]
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [modulePath, url = "http://127.0.0.1:5174/", executablePath] =
  process.argv.slice(2);
if (!modulePath) throw Error("Supply an installed Playwright module path");
const { webkit, devices } = await import(
  pathToFileURL(resolve(modulePath)).href
);
const browser = await webkit.launch({
  headless: true,
  ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
});
const result = {
  engine: browser.version(),
  url,
  physicalPhone: false,
  errors: [],
  missions: [],
  screenshots: [],
};
try {
  const context = await browser.newContext({
    ...devices["iPhone 13 Mini"],
    viewport: { width: 375, height: 635 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const audio = new Set(),
    privateCalls = [];
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/audio/story/")) audio.add(r.url());
    if (r.url().includes("/api/assistant")) privateCalls.push(r.url());
  });
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  const range = async (name, value) =>
    page.getByRole("slider", { name, exact: true }).evaluate((n, v) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(n, String(v));
      n.dispatchEvent(new Event("input", { bubbles: true }));
      n.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  const kept = async (id) => {
    await page.locator(".ep-reward").waitFor();
    result.missions.push(id);
    await click("Dismiss finding");
    assert.equal(await page.locator("[data-world]").count(), 1);
  };
  await page.goto(new URL("?mode=game#hidden-cause", url).href);
  await page.locator('[data-world="aquifer"]').waitFor();
  for (let i = 0; i < 3; i++) await click("Pump water");
  for (let i = 0; i < 2; i++) await click("Refill");
  await kept("aquifer");
  await page
    .getByText(
      "Extra challenge: keep a city supplied through four dry seasons",
      { exact: true },
    )
    .click();
  await range("Alternative water supply valve", 100);
  for (const [i, pump] of [0, 10, 15, 5].entries()) {
    await range("Seasonal pumping units", pump);
    await click(`Run dry season ${i + 1} →`);
  }
  assert.equal(
    await page.locator(".ep-reward").count(),
    0,
    "bonus never duplicates a discovery",
  );
  await click("Next chapter");
  await click("Settle together");
  await click("Settle unevenly");
  assert.equal(await page.locator(".ep-reward").count(), 0);
  await click("Inspect the connection");
  await kept("uneven");
  await click("Next chapter");
  await click("Capture first echo");
  await range("Move the ground between visits", 18);
  await click("Capture repeat echo");
  await click("Reveal the difference");
  await kept("radar");
  await page
    .getByText(
      "Extra challenge: two depths, one colour. Can you break the tie?",
      { exact: true },
    )
    .click();
  await page.locator('[data-affordance="twin-shallow"]').click();
  await page.locator('[data-affordance="twin-deep"]').click();
  await click("Reference edge");
  await click("Cross the slope");
  await click("Target centre");
  assert.equal(await page.locator(".ep-reward").count(), 0);
  await mkdir("output/playwright", { recursive: true });
  await page.locator(".ex-phase").scrollIntoViewIfNeeded();
  let path = "output/playwright/field-phase-mobile.png";
  await page.screenshot({ path });
  result.screenshots.push(path);
  await click("Next chapter");
  await page.locator(".ed-map-image").waitFor();
  await click("Sample patch");
  await click("Find gap");
  await kept("evidence");
  await click("Inspect footprints");
  await click("Load checked footprint evidence");
  await page.locator(".ex-footprint-tray button").nth(3).click();
  assert.match(
    await page.locator(".ex-footprints").innerText(),
    /not enough evidence/,
  );
  assert.equal(await page.locator(".ep-reward").count(), 0);
  await click("Radar images");
  await page.locator(".es-radar-study-stage").press("ArrowRight");
  assert.equal(await page.locator(".ep-reward").count(), 0);
  assert.match(
    await page.locator(".es-radar-study-inspection").innerText(),
    /dB/,
  );
  await click("Next chapter");
  await click("Keep measuring");
  await click("Limit withdrawals");
  await kept("tokyo");
  await page
    .getByText("Extra challenge: change when the city acts", { exact: true })
    .click();
  await click("Act early");
  await click("Wait longer");
  assert.equal(await page.locator(".ep-reward").count(), 0);
  await click("Next chapter");
  await page.locator(".ex-dossier[data-complete=true]").waitFor();
  assert.equal(await page.locator("[data-world]").count(), 0);
  const text = await page.locator(".ex-dossier").innerText();
  assert.match(text, /mm\/yr/);
  assert.match(text, /dB/);
  assert.match(text, /Missing \/ withheld/);
  assert.match(text, /Synthetic radar/);
  assert.match(text, /game units/);
  assert.equal(audio.size, 0, "no sound files before explicit consent");
  assert.equal(privateCalls.length, 0, "telemetry stays local");
  await page
    .locator(".ex-dossier")
    .evaluate((n) =>
      scrollTo(
        0,
        n.getBoundingClientRect().top +
          scrollY -
          document.querySelector(".es-header").offsetHeight -
          document.querySelector(".eg-status-ribbon").offsetHeight -
          16,
      ),
    );
  path = "output/playwright/field-dossier-mobile.png";
  await page.screenshot({ path });
  result.screenshots.push(path);
  assert.ok(
    (await page.locator(".eg-status-ribbon").evaluate((n) => n.offsetHeight)) <=
      80,
    "compact mobile game HUD",
  );
  const horizontal = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  assert.equal(horizontal, 0);
  const notes = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("earthsignal:field-notes:v1")),
  );
  assert.ok(notes.notes.length <= 12);
  assert.ok(notes.notes.some((n) => n.kind === "ground" && n.rate === null));
  assert.ok(notes.notes.some((n) => n.kind === "ground" && n.rate !== null));
  result.savedReadings = notes.notes.length;
  await page
    .getByRole("button", { name: "Turn optional sounds on", exact: true })
    .first()
    .click();
  await page.waitForFunction(() => document.querySelector(".ea-sound-dock"));
  for (let i = 0; i < 50 && audio.size < 5; i++) await page.waitForTimeout(100);
  assert.equal(audio.size, 5);
  await page
    .getByRole("button", { name: "Turn optional sounds off", exact: true })
    .first()
    .click();
  result.audioConsent = "5 recorded local files only after consent";
  await page.setViewportSize({ width: 1365, height: 900 });
  await page
    .locator(".ex-dossier")
    .evaluate((n) =>
      scrollTo(
        0,
        n.getBoundingClientRect().top +
          scrollY -
          document.querySelector(".es-header").offsetHeight -
          document.querySelector(".eg-status-ribbon").offsetHeight -
          16,
      ),
    );
  path = "output/playwright/field-dossier-desktop.png";
  await page.screenshot({ path });
  result.screenshots.push(path);
  await page.goto(new URL("?mode=game#consequences", url).href);
  await page.locator(".play-street .ea-partner").waitFor();
  await page.evaluate(() => scrollTo(0, 0));
  const fit = await page
    .locator(".play-stage")
    .evaluate((n) => ({
      top: n.getBoundingClientRect().top,
      bottom: n.getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
  assert.ok(
    fit.top >= 0 && fit.bottom <= fit.viewport + 2,
    "working stage and controls share the desktop viewport",
  );
  path = "output/playwright/field-street-desktop.png";
  await page.screenshot({ path });
  result.screenshots.push(path);
  result.desktopStage = fit;
  assert.deepEqual(result.errors, []);
  await writeFile(
    "output/playwright/field-investigation.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
