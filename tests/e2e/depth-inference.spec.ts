import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import { createHomeProject } from "./home-helpers";
import { bodyVolume, type GeometryModel } from "@forma/geometry";
async function click(page: Page, p: [number, number, number]) {
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(...p).project(c);
  await page.mouse.click(
    b.x + ((v.x + 1) * b.width) / 2,
    b.y + ((1 - v.y) * b.height) / 2,
  );
}
async function save(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
}
async function size(page: Page, value: string) {
  const field = page.getByLabel("Размер построения", { exact: true });
  await field.fill(value);
  await field.press("Enter");
}
async function height(page: Page, value: string) {
  const field = page.getByLabel("Высота выдавливания", { exact: true });
  await field.fill(value);
  await field.press("Enter");
  await expect(page.getByTestId("volume-preview")).toHaveCount(0);
}
async function setup(page: Page) {
  await page.goto("/");
  await createHomeProject(page, "Уровень Push Pull");
  await page.keyboard.press("r");
  await click(page, [4, 0, 0]);
  await size(page, "1m;1m");
  await page.keyboard.press("Space");
  await click(page, [4.5, 0, 0.5]);
  await page.keyboard.press("p");
  await height(page, "2m");
  await page.keyboard.press("Space");
  await click(page, [4.5, 2, 0.5]);
  await page
    .getByRole("button", {
      name: "Сгруппировать всю геометрию сцены",
      exact: true,
    })
    .click();
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  await size(page, "2m;2m");
  return save(page);
}
async function hoverLevel(page: Page) {
  await page.keyboard.press("p");
  await click(page, [1, 0, 1]);
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(4.5, 2, 0.5).project(c);
  await page.mouse.move(
    b.x + ((v.x + 1) * b.width) / 2,
    b.y + ((1 - v.y) * b.height) / 2,
    { steps: 8 },
  );
  await expect(page.getByTestId("depth-inference")).toContainText("2 м");
  await expect(page.getByTestId("volume-preview")).toContainText("8 м³");
}
test("P aligns a real face to a neighbouring group's level and preserves history and file roundtrip", async ({
  page,
}) => {
  const before = await setup(page);
  await hoverLevel(page);
  await page.screenshot({
    path: "test-results/alpha17-depth.png",
    animations: "disabled",
    caret: "hide",
  });
  expect((await save(page)).geometries).toEqual(before.geometries);
  await click(page, [4.5, 2, 0.5]);
  await expect(page.getByTestId("depth-inference")).toBeHidden();
  const after = await save(page);
  writeFileSync(
    "test-results/alpha17-aligned.v3d",
    JSON.stringify(after, null, 2),
  );
  const oldGid = Object.keys(before.geometries).find(
    (id) => Object.keys(before.geometries[id].faces).length === 6,
  )!;
  expect(after.geometries[oldGid]).toEqual(before.geometries[oldGid]);
  const source = Object.values(after.geometries).find(
    (g: any) => g.id !== oldGid,
  ) as GeometryModel;
  expect(bodyVolume(source, Object.keys(source.bodies)[0])).toBeCloseTo(8, 8);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "aligned.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  await page.getByTestId("viewport").waitFor();
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("numeric input overrides a depth inference and Escape discards the inferred preview", async ({
  page,
}) => {
  const before = await setup(page);
  await hoverLevel(page);
  await page.keyboard.press("Escape");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await hoverLevel(page);
  const field = page.getByLabel("Высота выдавливания", { exact: true });
  await field.fill("3m");
  await expect(page.getByTestId("depth-inference")).toBeHidden();
  await field.press("Enter");
  await expect(field).toBeHidden();
  const after = await save(page);
  const source = Object.values(after.geometries).find(
    (g: any) =>
      Object.keys(g.faces).length === 6 &&
      Math.max(...Object.values(g.vertices).map((v: any) => v.position[1])) ===
        3,
  ) as GeometryModel;
  expect(source).toBeDefined();
  expect(bodyVolume(source, Object.keys(source.bodies)[0])).toBeCloseTo(12, 8);
});

test("disabling snapping immediately removes the level guide without writing geometry", async ({
  page,
}) => {
  const before = await setup(page);
  await hoverLevel(page);
  await page
    .getByRole("button", { name: "Привязки к геометрии и сетке", exact: true })
    .click();
  await expect(page.getByTestId("depth-inference")).toBeHidden();
  await page.keyboard.press("Escape");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
