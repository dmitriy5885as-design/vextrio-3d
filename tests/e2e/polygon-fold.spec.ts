import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import {
  tessellateFace,
  bodyVolume,
  type GeometryModel,
} from "@forma/geometry";
async function screen(page: Page, p: [number, number, number]) {
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
  const q = await screen(page, p);
  await page.mouse.click(q.x, q.y);
}
async function move(page: Page, p: [number, number, number]) {
  const q = await screen(page, p);
  await page.mouse.move(q.x, q.y, { steps: 6 });
}
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await pending).path())!, "utf8"));
}
async function finish(page: Page, text: string, coordinates = false) {
  if (coordinates)
    await page
      .getByLabel("Режим перемещения", { exact: true })
      .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toBeHidden();
}

async function polygon(page: Page, points: [number, number, number][]) {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.keyboard.press("l");
  for (const p of [...points, points[0]]) await click(page, p);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
}
test("draw a hexagon with L, fold one corner in M and retain one planar pentagon through files and history", async ({
  page,
}) => {
  await polygon(page, [
    [0, 0, 0],
    [4, 0, 0],
    [5, 0, 2],
    [4, 0, 4],
    [0, 0, 4],
    [-1, 0, 2],
  ]);
  const before = await save(page);
  await click(page, [5, 0, 2]);
  await page.keyboard.press("m");
  await click(page, [5, 0, 2]);
  await page.keyboard.press("ArrowUp");
  await move(page, [5, 1, 2]);
  await finish(page, "1000mm");
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(Object.keys(g.vertices)).toHaveLength(6);
  expect(Object.keys(g.edges)).toHaveLength(7);
  expect(Object.keys(g.faces)).toHaveLength(2);
  const areas = Object.values(g.faces)
    .map((f) => tessellateFace(g, f).area)
    .sort((a, b) => a - b);
  expect(areas[0]).toBeCloseTo(2 * Math.sqrt(2), 7);
  expect(areas[1]).toBeCloseTo(18, 7);
  expect(
    Object.values(g.faces)
      .map((f) => g.loops[f.outerLoopId].coedgeIds.length)
      .sort(),
  ).toEqual([3, 5]);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  writeFileSync(
    "test-results/polygon-fold.v3d",
    JSON.stringify(after, null, 2),
  );
  await page.screenshot({ path: "test-results/polygon-fold.png" });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "hex-fold.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("a boundary midpoint remains a real vertex when lifted into a three-region fold", async ({
  page,
}) => {
  await polygon(page, [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [2, 0, 3],
    [0, 0, 3],
  ]);
  await click(page, [2, 0, 3]);
  await page.keyboard.press("m");
  await click(page, [2, 0, 3]);
  await page.keyboard.press("ArrowUp");
  await finish(page, "1m");
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(Object.keys(g.vertices)).toHaveLength(5);
  expect(Object.keys(g.edges)).toHaveLength(7);
  expect(Object.keys(g.faces)).toHaveLength(3);
  await page.keyboard.press("Space");
  await click(page, [2, 1, 3]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "vertex",
  );
});

test("a folded six-sided prism remains a closed editable body with the correct volume", async ({
  page,
}) => {
  await polygon(page, [
    [0, 0, 0],
    [4, 0, 0],
    [5, 0, 2],
    [4, 0, 4],
    [0, 0, 4],
    [-1, 0, 2],
  ]);
  await click(page, [2, 0, 2]);
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("3m");
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "8",
  );
  await page.keyboard.press("Space");
  await click(page, [5, 3, 2]);
  await page.keyboard.press("m");
  await click(page, [5, 3, 2]);
  await page.keyboard.press("ArrowUp");
  await finish(page, "1m");
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as GeometryModel;
  expect(Object.keys(g.vertices)).toHaveLength(12);
  expect(Object.keys(g.edges)).toHaveLength(19);
  expect(Object.keys(g.faces)).toHaveLength(9);
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(60 + 2 / 3, 7);
  writeFileSync(
    "test-results/polygon-fold-solid.v3d",
    JSON.stringify(saved, null, 2),
  );
  await page.screenshot({ path: "test-results/polygon-fold-solid.png" });
});
