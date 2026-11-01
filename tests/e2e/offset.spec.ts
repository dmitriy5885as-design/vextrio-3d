import {createHomeProject} from "./home-helpers";
import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import { serializeProject, occurrenceMatrix } from "@forma/document";
import {
  tessellateFace,
  transformAffine,
  type GeometryModel,
} from "@forma/geometry";
import { componentProject } from "../fixtures/v2-project";
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
  const q = await point(page, p);
  await page.mouse.click(q.x, q.y);
}
async function move(page: Page, p: [number, number, number]) {
  const q = await point(page, p);
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
async function selectTree(page: Page, name: string) {
  await page.getByRole("button", { name: "Структура", exact: true }).click();
  await page
    .locator(".structure .tree-object")
    .filter({ has: page.getByText(name, { exact: true }) })
    .locator("button")
    .first()
    .click();
}

test("Offset creates real 200 mm walls, one history command, extrusion and exact file roundtrip", async ({
  page,
}) => {
  await rectangle(page);
  const before = await save(page);
  await click(page, [2, 0, 1.5]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
  await page.keyboard.press("f");
  const panel = page.getByTestId("offset-panel"),
    input = page.getByLabel("Размер отступа", { exact: true });
  await expect(panel).toBeVisible();
  await input.fill("200mm");
  await expect(page.getByTestId("offset-preview")).toContainText("граней: 2");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const offset = await save(page),
    g = Object.values(offset.geometries)[0] as GeometryModel;
  expect(Object.keys(g.vertices)).toHaveLength(8);
  expect(Object.keys(g.edges)).toHaveLength(8);
  expect(Object.values(g.faces).map((f) => tessellateFace(g, f).area)).toEqual(
    expect.arrayContaining([expect.closeTo(2.64, 7), expect.closeTo(9.36, 7)]),
  );
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(offset.geometries);
  await page.keyboard.press("Space");
  await click(page, [2, 0, 1.5]);
  await expect(page.getByTestId("face-area")).toContainText("9.36 м²");
  await page.keyboard.press("Delete");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await click(page, [0.1, 0, 1.5]);
  await expect(page.getByTestId("face-area")).toContainText("2.64 м²");
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("3m");
  await expect(page.getByTestId("volume-preview")).toContainText("7.92 м³");
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "10",
  );
  const solid = await save(page);
  writeFileSync(
    "test-results/offset-walls.v3d",
    JSON.stringify(solid, null, 2),
  );
  await page.screenshot({ path: "test-results/offset-walls.png" });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "walls.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(solid)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "10",
  );
  expect((await save(page)).geometries).toEqual(solid.geometries);
});
test("F click-move-click previews actual contours and immediate save waits for the confirmed offset", async ({
  page,
}) => {
  await rectangle(page);
  const before = await save(page);
  await page.keyboard.press("f");
  await click(page, [0.01, 0, 1.5]);
  const panel = page.getByTestId("offset-panel");
  await expect(panel).toContainText("Переместите мышь");
  await move(page, [0.21, 0, 1.5]);
  await expect(page.getByTestId("offset-preview")).toContainText("граней: 2");
  await expect
    .poll(async () =>
      parseFloat(
        await page.getByLabel("Размер отступа", { exact: true }).inputValue(),
      ),
    )
    .toBeCloseTo(0.2, 6);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.screenshot({ path: "test-results/offset-preview.png" });
  const distance = parseFloat(
    await page.getByLabel("Размер отступа", { exact: true }).inputValue(),
  );
  const pending = page.waitForEvent("download");
  await click(page, [0.21, 0, 1.5]);
  await page.keyboard.press("Control+s");
  const doc = JSON.parse(readFileSync((await (await pending).path())!, "utf8")),
    g = Object.values(doc.geometries)[0] as GeometryModel;
  expect(Object.keys(g.faces)).toHaveLength(2);
  expect(Object.values(g.faces).map((f) => tessellateFace(g, f).area)).toEqual(
    expect.arrayContaining([
      expect.closeTo((4 - 2 * distance) * (3 - 2 * distance), 7),
    ]),
  );
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("invalid sizes, focus loss, Escape and a held pointer never write an Offset at 1024 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await rectangle(page);
  const before = await save(page);
  await click(page, [2, 0, 1.5]);
  await page.keyboard.press("Shift+f");
  await expect(page.getByTestId("offset-panel")).toHaveCount(0);
  // Camera focus remains available; frame the model before testing cancellation.
  await page
    .getByRole("button", { name: "Сбросить камеру", exact: true })
    .click();
  // Use tree selection below so no camera projection assumptions are needed.
  await selectTree(page, "Сцена");
  await page.keyboard.press("f");
  const input = page.getByLabel("Размер отступа", { exact: true }),
    panel = page.getByTestId("offset-panel");
  for (const text of ["0mm", "2000mm", "abc"]) {
    await input.fill(text);
    await input.press("Enter");
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(page.locator(".viewport-canvas")).toHaveAttribute(
      "data-topology-faces",
      "1",
    );
  }
  await input.fill("-20,0cm");
  await expect(page.getByTestId("offset-preview")).toContainText("граней: 2");
  await input.press("Escape");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await selectTree(page, "Сцена");
  await page.keyboard.press("f");
  await page.getByLabel("Размер отступа", { exact: true }).fill("200mm");
  await expect(page.getByTestId("offset-preview")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("offset-preview")).toHaveCount(0);
  expect((await save(page)).geometries).toEqual(before.geometries);
  const box = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.keyboard.press("Space");
  await page.keyboard.press("f");
  await page.mouse.up();
  await expect(page.getByTestId("offset-panel")).not.toContainText(
    "Переместите мышь и щёлкните",
  );
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "0",
  );
});
test("Offset preserves physical thickness in a scaled group and refuses a different active context", async ({
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
  await page.keyboard.press("r");
  await page.getByTestId("sketch-panel").locator("summary").click();
  await page
    .getByLabel("Контекст рисования", { exact: true })
    .selectOption(JSON.stringify([node.id]));
  await page.getByLabel("Ввод координат построения", { exact: true }).check();
  const dimensions = page.getByLabel("Размер построения", { exact: true });
  for (const text of ["=0;0;0", "=4;0;3"]) {
    await dimensions.fill(text);
    await dimensions.press("Enter");
  }
  await page
    .getByRole("button", { name: "Выделение (Space)", exact: true })
    .click();
  await selectTree(page, node.name);
  await page.keyboard.press("f");
  const input = page.getByLabel("Размер отступа", { exact: true });
  await input.fill("200mm");
  await expect(page.getByTestId("offset-preview")).toBeVisible();
  await input.press("Enter");
  const saved = await save(page),
    gid = saved.definitions[node.definitionId].geometryId,
    m = saved.geometries[gid] as GeometryModel,
    matrix = occurrenceMatrix(saved, [node.id]);
  expect(saved.geometries["native/geometry"]).toEqual(
    JSON.parse(serializeProject(doc)).geometries["native/geometry"],
  );
  expect(saved.nodes).toEqual(doc.nodes);
  const points = Object.values(m.vertices).map((v) =>
    transformAffine(v.position, matrix),
  );
  expect(
    points.some(
      (p) => Math.abs(p[0] - 0.2) < 1e-7 && Math.abs(p[2] - 0.2) < 1e-7,
    ),
  ).toBe(true);
  await selectTree(page, doc.nodes["instance/two"].name);
  await expect(
    page.getByTestId("offset-panel").getByRole("alert"),
  ).toContainText("войдите в группу");
  await page.getByLabel("Размер отступа", { exact: true }).fill("100mm");
  await page.getByLabel("Размер отступа", { exact: true }).press("Enter");
  expect((await save(page)).geometries).toEqual(saved.geometries);
});
test("shared component Offset requires explicit acknowledgement and updates only the common definition", async ({
  page,
}) => {
  const doc = componentProject(),
    node = doc.nodes["instance/two"];
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "shared.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(doc)),
  });
  await expect(page.getByTestId("viewport")).toBeVisible();
  await page.keyboard.press("r");
  await page.getByTestId("sketch-panel").locator("summary").click();
  await page
    .getByLabel("Контекст рисования", { exact: true })
    .selectOption(JSON.stringify([node.id]));
  await page
    .getByRole("button", { name: "Выделение (Space)", exact: true })
    .click();
  await selectTree(page, node.name);
  await page.keyboard.press("f");
  const input = page.getByLabel("Размер отступа", { exact: true });
  await input.fill("100mm");
  await expect(page.getByTestId("offset-preview")).toBeVisible();
  await input.press("Enter");
  await expect(
    page.getByTestId("offset-panel").getByRole("alert"),
  ).toContainText("Подтвердите");
  await page
    .getByRole("checkbox", { name: "Изменить все 2 экземпляра" })
    .check();
  await input.press("Enter");
  const saved = await save(page),
    m = saved.geometries["native/geometry"] as GeometryModel;
  expect(Object.keys(m.vertices).length).toBeGreaterThan(
    Object.keys(doc.geometries["native/geometry"].vertices).length,
  );
  expect(saved.nodes).toEqual(doc.nodes);
  expect(saved.definitions).toEqual(doc.definitions);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(
    JSON.parse(serializeProject(doc)).geometries,
  );
});
