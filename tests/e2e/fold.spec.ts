import {createHomeProject} from "./home-helpers";
import { test, expect, type Page } from "@playwright/test";
import { serializeProject } from "@forma/document";
import { topologyProject } from "../fixtures/v2-project";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import {
  bodyVolume,
  tessellateFace,
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
async function rectangle(page: Page) {
  await page.goto("/");
  await createHomeProject(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4m;3m");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Space");
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

test("M previews and commits a real quad fold with lineage, picking, Undo and project roundtrip", async ({
  page,
}) => {
  await rectangle(page);
  const before = await save(page);
  await click(page, [4, 0, 3]);
  await page.keyboard.press("m");
  await click(page, [4, 0, 3]);
  await move(page, [4, 1, 3]);
  await page.keyboard.press("ArrowUp");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("1m");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(Object.keys(g.edges)).toHaveLength(5);
  expect(
    Object.values(g.faces)
      .map((f) => tessellateFace(g, f).area)
      .sort((a, b) => a - b),
  ).toEqual([6, 6.5]);
  expect(
    after.provenance.some(
      (l: { kind: string; reason: string }) =>
        l.kind === "face" && l.reason === "split",
    ),
  ).toBe(true);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  await page.keyboard.press("Space");
  await click(page, [2, 0, 1.5]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "edge",
  );
  writeFileSync("test-results/fold-sheet.v3d", JSON.stringify(after, null, 2));
  await page.screenshot({ path: "test-results/fold-sheet.png" });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "fold.v3d",
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
test("raising a closed block corner folds its cap and preserves a 38 cubic metre editable shell", async ({
  page,
}) => {
  await rectangle(page);
  await click(page, [2, 0, 1.5]);
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("3m");
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  await page.keyboard.press("Space");
  await click(page, [4, 3, 3]);
  await page.keyboard.press("m");
  await click(page, [4, 3, 3]);
  await page.keyboard.press("ArrowUp");
  await finish(page, "1000mm");
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as GeometryModel;
  expect(Object.keys(g.faces)).toHaveLength(7);
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(38, 7);
  writeFileSync("test-results/fold-solid.v3d", JSON.stringify(saved, null, 2));
  await page.screenshot({ path: "test-results/fold-solid.png" });
});
test("collapsing a boundary of a holed face is rejected without changing document or history", async ({
  page,
}) => {
  const doc = topologyProject();
  doc.camera = {
    position: [9, 7, 10],
    target: [0, 0, 0],
    projection: "perspective",
    zoom: 1,
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "hole.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
  const before = await save(page);
  await click(page, [4, 3, 0]);
  await page.keyboard.press("m");
  await click(page, [4, 3, 0]);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("0;-3m;0");
  await input.press("Enter");
  await expect(page.getByTestId("move-panel").getByRole("alert")).toBeVisible();
  expect((await save(page)).geometries).toEqual(before.geometries);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
});
