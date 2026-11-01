import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHomeProject } from "./home-helpers";
import { bodyVolume, classifyBody, type GeometryModel } from "@forma/geometry";
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
async function select(page: Page, p: [number, number, number]) {
  await page.keyboard.press("Space");
  await click(page, p);
}
async function wall(page: Page) {
  await page.goto("/");
  await createHomeProject(page, "Ниша у пола — Alpha.16");
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  await size(page, "4m;200mm");
  await select(page, [2, 0, 0.1]);
  await page.keyboard.press("p");
  await height(page, "3m");
}
async function profile(page: Page) {
  await page.keyboard.press("r");
  await click(page, [1, 0, 0.2]);
  await size(page, "800mm;2000mm");
  await select(page, [1.4, 1, 0.2]);
}
function check(p: any, expected: number) {
  const g = Object.values(p.geometries).find((g: any) =>
    Object.values(g.vertices).some(
      (v: any) => Math.abs(v.position[2] - 0.15) < 1e-8,
    ),
  ) as GeometryModel | undefined;
  expect(g).toBeDefined();
  expect(classifyBody(g!, Object.keys(g!.bodies)[0])).toBe("closed-shell");
  expect(bodyVolume(g!, Object.keys(g!.bodies)[0])).toBeCloseTo(expected, 8);
  return g!;
}
test("50mm floor recess previews, commits, restores history and reopens as identical editable topology", async ({
  page,
}) => {
  await wall(page);
  await profile(page);
  const before = await save(page);
  await page.keyboard.press("p");
  const field = page.getByLabel("Высота выдавливания", { exact: true });
  await field.fill("-50mm");
  await expect(page.getByTestId("volume-preview")).toContainText("2.32 м³");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await field.press("Enter");
  await expect(field).toBeHidden();
  const after = await save(page);
  check(after, 2.32);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  await page.bringToFront();
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/alpha16-recess.png",
    animations: "disabled",
    caret: "hide",
  });
  writeFileSync(
    "test-results/alpha16-recess.v3d",
    JSON.stringify(after, null, 2),
  );
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "recess.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  await page.getByTestId("viewport").waitFor();
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("a recess can be finished to the opposite skin using the actual Push/Pull limit button", async ({
  page,
}) => {
  await wall(page);
  await profile(page);
  await page.keyboard.press("p");
  await height(page, "-50mm");
  const before = await save(page);
  check(before, 2.32);
  await select(page, [1.4, 1, 0.15]);
  await page.keyboard.press("p");
  const limit = page.getByRole("button", { name: /До противоположной грани/ });
  await expect(limit).toContainText("0.15");
  await limit.click();
  await page.getByLabel("Высота выдавливания", { exact: true }).press("Enter");
  await expect(
    page.getByLabel("Высота выдавливания", { exact: true }),
  ).toBeHidden();
  const after = await save(page);
  const g = Object.values(after.geometries)[0] as GeometryModel;
  expect(classifyBody(g, Object.keys(g.bodies)[0])).toBe("closed-shell");
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(2.08, 8);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("grouped recess leaves an independent wall unchanged and Escape never commits its preview", async ({
  page,
}) => {
  await wall(page);
  await select(page, [2, 1, 0.2]);
  await page
    .getByRole("button", {
      name: "Сгруппировать всю геометрию сцены",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Создать связанный экземпляр", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сделать независимым", exact: true })
    .click();
  const x = page.getByLabel("Положение группы X", { exact: true });
  await x.fill("6");
  await x.press("Enter");
  const before = await save(page);
  const n = Object.values(before.nodes).find(
    (n: any) => n.transform.translation[0] === 6,
  ) as any;
  const gid = before.definitions[n.definitionId].geometryId;
  await page.keyboard.press("Space");
  // Enter the original occurrence through a real double click.
  const b = (await page.getByTestId("viewport").boundingBox())!;
  const c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(2, 1, 0.2).project(c);
  await page.mouse.dblclick(
    b.x + ((v.x + 1) * b.width) / 2,
    b.y + ((1 - v.y) * b.height) / 2,
  );
  await expect(page.getByTestId("edit-context")).toBeVisible();
  await profile(page);
  const drawn = await save(page);
  await page.keyboard.press("p");
  const field = page.getByLabel("Высота выдавливания", { exact: true });
  await field.fill("-50mm");
  await expect(page.getByTestId("volume-preview")).toContainText("2.32 м³");
  await page.keyboard.press("Escape");
  expect((await save(page)).geometries).toEqual(drawn.geometries);
  await page.keyboard.press("p");
  await click(page, [1.4, 1, 0.2]);
  await height(page, "-50mm");
  const after = await save(page);
  check(after, 2.32);
  expect(after.geometries[gid]).toEqual(before.geometries[gid]);
  expect(after.nodes).toEqual(drawn.nodes);
});
