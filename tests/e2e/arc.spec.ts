import {createHomeProject} from "./home-helpers";
import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import { serializeProject } from "@forma/document";
import {
  tessellateFace,
  prepareSketch,
  validatePrepared,
  entityTables,
  id,
  transformAffine,
  type GeometryModel,
} from "@forma/geometry";
import { occurrenceMatrix, geometryContext } from "@forma/document";
import { topologyProject, componentProject } from "../fixtures/v2-project";
async function screen(
  page: Page,
  p: [number, number, number],
  position: [number, number, number] = [9, 7, 10],
  target: [number, number, number] = [0, 0, 0],
) {
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.fromArray(position);
  c.lookAt(...target);
  c.updateMatrixWorld();
  const v = new Vector3(...p).project(c);
  return {
    x: b.x + ((v.x + 1) * b.width) / 2,
    y: b.y + ((1 - v.y) * b.height) / 2,
  };
}
async function click(page: Page, p: [number, number, number]) {
  const s = await screen(page, p);
  await page.mouse.click(s.x, s.y);
}
async function move(page: Page, p: [number, number, number]) {
  const s = await screen(page, p);
  await page.mouse.move(s.x, s.y, { steps: 6 });
}
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await pending).path())!, "utf8"));
}
async function start(page: Page) {
  await page.goto("/");
  await createHomeProject(page);
}

test("mouse arc closes into an editable face, extrudes and roundtrips exact topology", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("a");
  const panel = page.getByTestId("sketch-panel");
  await expect(panel).toHaveAttribute("data-tool", "arc");
  await click(page, [0, 0, 0]);
  await click(page, [2, 0, 0]);
  await expect(panel).toHaveAttribute("data-stage", "bulge");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    "0",
  );
  await move(page, [1, 0, 1]);
  await expect(page.getByTestId("sketch-preview-stats")).toContainText(
    "Геометрия проверена",
  );
  await expect(page.getByTestId("arc-measurements")).toContainText("R 1");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-precision-preview-points",
    "13",
  );
  await page.screenshot({ path: "test-results/arc-preview.png" });
  await click(page, [1, 0, 1]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    "12",
  );
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "0",
  );
  await page.keyboard.press("l");
  await click(page, [2, 0, 0]);
  await click(page, [0, 0, 0]);
  await page.keyboard.press("Space");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  const closed = await save(page);
  await click(page, [1, 0, 0.3]);
  await expect(page.getByTestId("face-area")).toContainText("1.55291427");
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("2m");
  await expect(page.getByTestId("volume-preview")).toContainText(
    "3.10582854 м³",
  );
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "15",
  );
  const solid = await save(page),
    g = Object.values(solid.geometries)[0] as GeometryModel;
  expect(Object.keys(g.vertices)).toHaveLength(26);
  expect(Object.keys(g.edges)).toHaveLength(39);
  expect(Object.keys(g.faces)).toHaveLength(15);
  writeFileSync("test-results/arc-solid.v3d", JSON.stringify(solid, null, 2));
  await page.screenshot({ path: "test-results/arc-solid.png" });
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(closed.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(solid.geometries);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "arc-solid.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(solid)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "15",
  );
  expect((await save(page)).geometries).toEqual(solid.geometries);
});
test("A accepts exact chord and signed bulge, changes segments, recovers from invalid input and cancels atomically at 1024 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await start(page);
  await page.getByRole("button", { name: "Дуга (A)", exact: true }).click();
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true }),
    panel = page.getByTestId("sketch-panel");
  await input.fill("2000mm");
  await input.press("Enter");
  await expect(panel).toHaveAttribute("data-stage", "bulge");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    "0",
  );
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  await input.fill("0mm");
  await input.press("Enter");
  await expect(panel.getByRole("alert")).toBeVisible();
  await input.fill("129s");
  await input.press("Enter");
  await expect(panel.getByRole("alert")).toBeVisible();
  await input.fill("24s");
  await input.press("Enter");
  await expect(page.getByLabel("Сегменты дуги", { exact: true })).toHaveValue(
    "24",
  );
  await move(page, [1, 0, 1]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-precision-preview-points",
    "25",
  );
  await page.keyboard.press("Escape");
  expect((await save(page)).geometries).toEqual({});
  await click(page, [0, 0, 0]);
  await input.fill("2m");
  await input.press("Enter");
  await input.fill("-100,0cm");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    "24",
  );
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as GeometryModel;
  expect(Object.keys(g.vertices)).toHaveLength(25);
  expect(Object.keys(g.faces)).toHaveLength(0);
  expect(
    Math.min(...Object.values(g.vertices).map((v) => v.position[2])),
  ).toBeCloseTo(-1, 8);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual({});
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(saved.geometries);
});
test("arc snaps to existing endpoints, divides a real face once and preserves IDs through Undo", async ({
  page,
}) => {
  const doc = topologyProject(false),
    original = Object.values(doc.geometries)[0],
    blank = {
      ...original,
      ...Object.fromEntries(entityTables.map((k) => [k, {}])),
    } as GeometryModel,
    context = geometryContext(doc, original.id),
    segments: [
      import("@forma/geometry").Vec3,
      import("@forma/geometry").Vec3,
    ][] = [
      [
        [0, 0, 0],
        [4, 0, 0],
      ],
      [
        [4, 0, 0],
        [4, 3, 0],
      ],
      [
        [4, 3, 0],
        [0, 3, 0],
      ],
      [
        [0, 3, 0],
        [0, 0, 0],
      ],
    ],
    change = prepareSketch(
      blank,
      { kind: "insert-segments", segments, plane: null },
      context,
      id("arc-fixture"),
    ),
    before = validatePrepared(blank, change, context, id("arc-fixture"));
  doc.geometries[before.id] = before;
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "face.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(page.getByTestId("viewport")).toBeVisible();
  await page.keyboard.press("a");
  const point = async (p: [number, number, number]) =>
    screen(page, p, doc.camera.position, doc.camera.target);
  for (const p of [
    [0, 0, 0],
    [4, 0, 0],
  ] as [number, number, number][]) {
    const q = await point(p);
    await page.mouse.move(q.x, q.y, { steps: 6 });
    await expect(page.getByTestId("snap-marker")).toBeVisible();
    await page.mouse.click(q.x, q.y);
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  for (const p of [
    [0, 0, 0],
    [4, 0, 0],
  ] as [number, number, number][]) {
    const q = await point(p);
    await page.mouse.click(q.x, q.y);
  }
  const q = await point([2, 1, 0]);
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await expect(page.getByTestId("sketch-preview-stats")).toContainText(
    "граней: 2",
  );
  await page.mouse.dblclick(q.x, q.y);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const after = await save(page),
    g = after.geometries[before.id] as GeometryModel;
  for (const [id, v] of Object.entries(before.vertices))
    expect(g.vertices[id]).toEqual(v);
  expect(
    Object.values(g.faces).reduce(
      (sum, f) => sum + tessellateFace(g, f).area,
      0,
    ),
  ).toBeCloseTo(12, 8);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(
    JSON.parse(serializeProject(doc)).geometries,
  );
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("arc numeric construction inside a scaled group leaves the independent neighbour unchanged", async ({
  page,
}) => {
  const doc = componentProject(),
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "groups.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(page.getByTestId("viewport")).toBeVisible();
  await page.keyboard.press("a");
  const panel = page.getByTestId("sketch-panel");
  await panel.locator("summary").click();
  await page
    .getByLabel("Контекст рисования", { exact: true })
    .selectOption(JSON.stringify([node.id]));
  await page.getByLabel("Ввод координат построения", { exact: true }).check();
  const input = page.getByLabel("Размер построения", { exact: true });
  for (const text of ["=0;0;0", "=2;0;0", "=1;0;1"]) {
    await input.fill(text);
    await input.press("Enter");
  }
  await expect(panel).toHaveAttribute("data-stage", "start");
  const saved = await save(page),
    gid = saved.definitions[node.definitionId].geometryId,
    g = saved.geometries[gid] as GeometryModel;
  expect(saved.geometries["native/geometry"]).toEqual(
    JSON.parse(serializeProject(doc)).geometries["native/geometry"],
  );
  expect(saved.nodes).toEqual(doc.nodes);
  expect(Object.keys(g.edges)).toHaveLength(12);
  const matrix = occurrenceMatrix(saved, [node.id]);
  for (const v of Object.values(g.vertices))
    expect(
      new Vector3(...transformAffine(v.position, matrix)).distanceTo(
        new Vector3(1, 0, 0),
      ),
    ).toBeCloseTo(1, 8);
});
