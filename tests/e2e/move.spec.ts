import { test, expect, type Page } from "@playwright/test";
import { serializeProject, occurrenceMatrix } from "@forma/document";
import { componentProject } from "../fixtures/v2-project";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import {
  bodyVolume,
  transformAffine,
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
  await page.locator(".start-card").first().click();
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
test("M raises the shared roof ridge with real UI, exact size, undo and file roundtrip", async ({
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
  await page.keyboard.press("l");
  await click(page, [2, 3, 0]);
  await click(page, [2, 3, 3]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  const before = await save(page);
  await click(page, [2, 3, 1.5]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "edge",
  );
  await page.keyboard.press("m");
  await click(page, [2, 3, 1.5]);
  await page.keyboard.press("ArrowUp");
  await finish(page, "1000mm");
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(42, 7);
  expect(Object.keys(g.vertices)).toEqual(
    Object.keys(
      (Object.values(before.geometries)[0] as GeometryModel).vertices,
    ),
  );
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  writeFileSync("test-results/move-roof.v3d", JSON.stringify(after, null, 2));
  await page.screenshot({ path: "test-results/move-roof.png" });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "roof.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("M moves and Ctrl copies a face with exact relative coordinates", async ({
  page,
}) => {
  await rectangle(page);
  await click(page, [2, 0, 1.5]);
  await page.keyboard.press("m");
  await click(page, [2, 0, 1.5]);
  await finish(page, "0;1000mm;0", true);
  let p = await save(page),
    g = Object.values(p.geometries)[0] as GeometryModel;
  expect(Object.values(g.vertices).every((v) => v.position[1] === 1)).toBe(
    true,
  );
  await page.keyboard.press("Space");
  await click(page, [2, 1, 1.5]);
  await page.keyboard.press("m");
  await click(page, [2, 1, 1.5]);
  await page.keyboard.press("Control");
  await expect(page.getByLabel("Создать копию · Ctrl")).toBeChecked();
  await finish(page, "0;1m;0", true);
  p = await save(page);
  g = Object.values(p.geometries)[0] as GeometryModel;
  expect(Object.keys(g.faces)).toHaveLength(2);
  expect(Object.keys(g.vertices)).toHaveLength(8);
  expect(new Set(Object.values(g.vertices).map((v) => v.position[1]))).toEqual(
    new Set([1, 2]),
  );
});
test("M mouse preview, axis lock and immediate Ctrl S commit the actual geometry", async ({
  page,
}) => {
  await rectangle(page);
  await click(page, [4, 0, 3]);
  await page.keyboard.press("m");
  await click(page, [4, 0, 3]);
  await page.keyboard.press("ArrowRight");
  await move(page, [5, 0, 3]);
  await expect
    .poll(async () =>
      parseFloat(
        await page.getByTestId("move-panel").locator("output").innerText(),
      ),
    )
    .toBeCloseTo(1, 5);
  await click(page, [5, 0, 3]);
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const p = JSON.parse(readFileSync((await (await download).path())!, "utf8")),
    g = Object.values(p.geometries)[0] as GeometryModel;
  expect(
    Math.max(...Object.values(g.vertices).map((v) => v.position[0])),
  ).toBeCloseTo(5, 5);
  expect(Object.keys(g.vertices)).toHaveLength(4);
});
test("invalid numeric M, Escape, blur and held pointer never change the document", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await rectangle(page);
  const before = await save(page);
  await click(page, [4, 0, 3]);
  await page.keyboard.press("m");
  await click(page, [4, 0, 3]);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("0;abc;0");
  await input.press("Enter");
  await expect(page.getByTestId("move-panel").getByRole("alert")).toBeVisible();
  expect((await save(page)).geometries).toEqual(before.geometries);
  await input.press("Escape");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("m");
  await click(page, [4, 0, 3]);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(
    page.getByLabel("Размер перемещения", { exact: true }),
  ).toBeHidden();
  const q = await screen(page, [4, 0, 3]);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.keyboard.press("Space");
  await page.keyboard.press("m");
  await page.mouse.up();
  await expect(
    page.getByLabel("Размер перемещения", { exact: true }),
  ).toBeHidden();
  expect((await save(page)).geometries).toEqual(before.geometries);
});

async function selectTree(page: Page, name: string) {
  await page.getByRole("button", { name: "Структура", exact: true }).click();
  await page
    .locator(".structure .tree-object")
    .filter({ has: page.getByText(name, { exact: true }) })
    .locator("button")
    .first()
    .click();
}
test("M preserves scaled-group thickness and leaves the neighbour unchanged", async ({
  page,
}) => {
  const doc = componentProject(),
    node = doc.nodes["instance/group"];
  if (node.kind === "legacy-primitive") throw Error("fixture");
  node.transform.scale = [2, 3, 4];
  doc.camera = {
    position: [9, 7, 10],
    target: [0, 0, 0],
    projection: "perspective",
    zoom: 1,
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "groups.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    "8",
  );
  await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("r");
  await page.getByTestId("sketch-panel").locator("summary").click();
  await page
    .getByLabel("Контекст рисования", { exact: true })
    .selectOption(JSON.stringify([node.id]));
  await page.getByLabel("Ввод координат построения", { exact: true }).check();
  const input = page.getByLabel("Размер построения", { exact: true });
  for (const text of ["=0;0;0", "=4;0;3"]) {
    await input.fill(text);
    await input.press("Enter");
  }
  await page
    .getByRole("button", { name: "Выделение (Space)", exact: true })
    .click();
  await selectTree(page, node.name);
  const before = await save(page);
  await page.keyboard.press("m");
  await click(page, [2, 0, 1.5]);
  await finish(page, "0;500mm;0", true);
  const after = await save(page),
    gid = after.definitions[node.definitionId].geometryId,
    g = after.geometries[gid] as GeometryModel,
    old = before.geometries[gid] as GeometryModel,
    matrix = occurrenceMatrix(after, [node.id]);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.geometries["native/geometry"]).toEqual(
    before.geometries["native/geometry"],
  );
  for (const v of Object.values(g.vertices)) {
    const a = transformAffine(old.vertices[v.id].position, matrix),
      b = transformAffine(v.position, matrix);
    expect(b[1] - a[1]).toBeCloseTo(0.5, 8);
  }
});
test("M requires shared-component acknowledgement and preserves shared-definition Undo", async ({
  page,
}) => {
  const doc = componentProject(),
    node = doc.nodes["instance/two"];
  doc.camera = {
    position: [9, 7, 10],
    target: [0, 0, 0],
    projection: "perspective",
    zoom: 1,
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "components.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    "8",
  );
  await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("r");
  await page.getByTestId("sketch-panel").locator("summary").click();
  await page
    .getByLabel("Контекст рисования", { exact: true })
    .selectOption(JSON.stringify([node.id]));
  await page
    .getByRole("button", { name: "Выделение (Space)", exact: true })
    .click();
  await selectTree(page, node.name);
  const before = await save(page);
  await page.keyboard.press("m");
  const matrix = occurrenceMatrix(doc, [node.id]),
    world = transformAffine([2, 1.5, 0], matrix);
  await click(page, world);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("0;0;1m");
  await input.press("Enter");
  await expect(page.getByTestId("move-panel").getByRole("alert")).toContainText(
    "Подтвердите",
  );
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page
    .getByRole("checkbox", { name: "Изменить все 2 экземпляра" })
    .check();
  await input.press("Enter");
  await expect(input).toBeHidden();
  const after = await save(page);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.definitions).toEqual(before.definitions);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});

test("Shift selection moves two real vertices together with a single exact command", async ({
  page,
}) => {
  await rectangle(page);
  await click(page, [4, 0, 0]);
  await page.keyboard.down("Shift");
  await click(page, [4, 0, 3]);
  await page.keyboard.up("Shift");
  await page.keyboard.press("m");
  await click(page, [4, 0, 1.5]);
  await page.keyboard.press("ArrowRight");
  await finish(page, "1000mm");
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as GeometryModel;
  expect(Math.max(...Object.values(g.vertices).map((v) => v.position[0]))).toBe(
    5,
  );
  expect(tessellateFace(g, Object.values(g.faces)[0]).area).toBeCloseTo(15, 8);
});
