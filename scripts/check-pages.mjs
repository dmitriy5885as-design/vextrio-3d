import "./prepare-cad.mjs";
import { build, preview } from "vite";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
// Exercise the actual production asset paths used on project GitHub Pages.
// This catches root-absolute React images which localhost / tests cannot see.
const base = "/vextrio-3d/",
  outDir = "test-results/pages-build";
await build({ base, build: { outDir, emptyOutDir: true } });
const server = await preview({
  base,
  build: { outDir },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
});
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL,
    args: ["--use-angle=swiftshader", "--enable-webgl"],
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    }),
    failures = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => failures.push(e.message));
  const response = await page.goto("http://127.0.0.1:4174" + base);
  assert.equal(response.status(), 200);
  assert.match(await page.title(), /VEXTRIO 3D/);
  await page.locator(".start-card").first().waitFor();
  const loaded = () =>
    Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0);
  await page.waitForFunction(loaded);
  assert.equal(await page.locator("img").count(), 2);
  assert.equal(await page.locator("canvas").count(), 0);
  await page.locator(".start-card").first().click();
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await page.getByTestId("viewport").waitFor();
  await page.waitForFunction(loaded);
  // Verify the production subpath and the exact Windows CSP with real OCCT.
  const csp = JSON.parse(
    fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
  ).app.security.csp;
  await page.route("**/vextrio-3d/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  await page.reload();
  await page
    .locator("input[type=file]")
    .setInputFiles("tests/fixtures/import-tetra.step");
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".viewport-canvas")
        ?.getAttribute("data-topology-faces") === "4",
  );
  assert.match(
    await page.getByTestId("model-stats").innerText(),
    /Грани: 4 · Рёбра: 6 · Полигоны: 4/,
  );
  assert.deepEqual(failures, []);
  fs.mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pages-production.png" });
  console.log(
    "GitHub Pages production smoke: Home, editor, logos and actual STEP Worker under Windows CSP OK under " +
      base,
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.httpServer.close((e) => (e ? reject(e) : resolve())),
  );
}
