import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
async function point(page: Page, p: [number, number, number]) {
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(...p).project(c);
  return {
    x: b.x + ((v.x + 1) * b.width) / 2,
    y: b.y + ((1 - v.y) * b.height) / 2,
  };
}
async function click(page: Page, p: [number, number, number]) {
  const v = await point(page, p);
  await page.mouse.click(v.x, v.y);
}
async function move(page: Page, p: [number, number, number]) {
  const v = await point(page, p);
  await page.mouse.move(v.x, v.y, { steps: 6 });
}
async function save(page: Page) {
  const e = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await e).path())!, "utf8"));
}
async function start(page: Page) {
  await page.goto("/");
  await page.locator(".start-card").first().click();
}
test("C accepts an exact radius, creates native edges/face, extrudes and roundtrips a cylinder", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("c");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-tool",
    "circle",
  );
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("1000mm");
  await input.press("Enter");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Finish",
  );
  const circle = await save(page),
    g = Object.values(circle.geometries)[0] as any;
  expect(Object.keys(g.vertices)).toHaveLength(24);
  expect(Object.keys(g.edges)).toHaveLength(24);
  expect(Object.keys(g.faces)).toHaveLength(1);
  for (const v of Object.values(g.vertices) as any[])
    expect(Math.hypot(...v.position)).toBeCloseTo(1, 8);
  await page.keyboard.press("p");
  await click(page, [0.2, 0, 0.1]);
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("2m");
  await expect(page.getByTestId("volume-preview")).toContainText(
    "6.21165708 м³",
  );
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "26",
  );
  const saved = await save(page),
    solid = Object.values(saved.geometries)[0] as any;
  expect(Object.keys(solid.vertices)).toHaveLength(48);
  expect(Object.keys(solid.edges)).toHaveLength(72);
  writeFileSync(
    "test-results/circle-cylinder.v3d",
    JSON.stringify(saved, null, 2),
  );
  await page.screenshot({ path: "test-results/circle-cylinder.png" });
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(circle.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(saved.geometries);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "cylinder.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "26",
  );
  expect((await save(page)).geometries).toEqual(saved.geometries);
});
test("mouse circle has a complete 48-segment preview, cancels cleanly and ignores duplicate clicks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await start(page);
  await page.getByTitle("Окружность (C)", { exact: true }).click();
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("0mm");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await input.fill("48s");
  await input.press("Enter");
  await expect(
    page.getByLabel("Сегменты окружности", { exact: true }),
  ).toHaveValue("48");
  await move(page, [1, 0, 0]);
  await expect(page.getByTestId("sketch-preview-stats")).toContainText(
    "граней: 1",
  );
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-precision-preview-points",
    "49",
  );
  expect((await save(page)).geometries).toEqual({});
  await page.keyboard.press("Escape");
  expect((await save(page)).geometries).toEqual({});
  await click(page, [0, 0, 0]);
  await move(page, [1, 0, 0]);
  const v = await point(page, [1, 0, 0]);
  await page.mouse.dblclick(v.x, v.y);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as any;
  expect(Object.keys(g.edges)).toHaveLength(48);
  expect(Object.keys(g.faces)).toHaveLength(1);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual({});
});
test("draws a circular contour on a real wall and pushes a true round opening through it", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4m;0.2m");
  await input.press("Enter");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Finish",
  );
  await page.keyboard.press("p");
  await click(page, [2, 0, 0.1]);
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("3m");
  await expect(page.getByTestId("volume-preview")).toContainText("2.4 м³");
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  await page.keyboard.press("c");
  await click(page, [2, 1.5, 0.2]);
  await input.fill("50cm");
  await input.press("Enter");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Finish",
  );
  await page.keyboard.press("p");
  await click(page, [2, 1.5, 0.2]);
  await page
    .getByRole("button", {
      name: "До противоположной грани · 0.2 м",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("volume-preview")).toContainText(
    "2.24470857 м³",
  );
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "30",
  );
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as any;
  expect(Object.keys(g.vertices)).toHaveLength(56);
  expect(Object.keys(g.edges)).toHaveLength(84);
  expect(
    Object.values(g.faces).filter((f: any) => f.innerLoopIds.length === 1),
  ).toHaveLength(2);
  writeFileSync(
    "test-results/circular-window.v3d",
    JSON.stringify(saved, null, 2),
  );
  await page.screenshot({ path: "test-results/circular-window.png" });
});
