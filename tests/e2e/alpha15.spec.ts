import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHomeProject } from "./home-helpers";
import {
  bodyVolume,
  classifyBody,
  tessellateFace,
  type GeometryModel,
} from "@forma/geometry";
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
async function floor(page: Page, name?: string) {
  await page.goto("/");
  await createHomeProject(page, name);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  await size(page, "4m;3m");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
}
async function ridge(page: Page, y = 0) {
  await page.keyboard.press("l");
  await click(page, [2, y, 0]);
  await click(page, [2, y, 3]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
}
const firstModel = (p: any) => Object.values(p.geometries)[0] as GeometryModel;
test("Delete merges a drawn divider into a 12m² face and preserves IDs through Undo, Redo and reopening", async ({
  page,
}) => {
  await floor(page);
  await ridge(page);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const before = await save(page);
  await click(page, [2, 0, 1.5]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "edge",
  );
  await page.keyboard.press("Delete");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await click(page, [1, 0, 1.5]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
  const merged = await save(page);
  expect(Object.keys(firstModel(merged).vertices)).toEqual(
    Object.keys(firstModel(before).vertices),
  );
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(merged.geometries);
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "merged.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(merged)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  expect((await save(page)).geometries).toEqual(merged.geometries);
});
test("Delete merges a real split cap and keeps the closed block's volume", async ({
  page,
}) => {
  await floor(page);
  await select(page, [1, 0, 1]);
  await page.keyboard.press("p");
  await height(page, "3m");
  await ridge(page, 3);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  const before = await save(page);
  await click(page, [2, 3, 1.5]);
  await page.keyboard.press("Delete");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  const after = await save(page),
    m = firstModel(after),
    bid = Object.keys(m.bodies)[0];
  expect(classifyBody(m, bid)).toBe("closed-shell");
  expect(bodyVolume(m, bid)).toBeCloseTo(36);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test.describe.serial("basic house built entirely through UI", () => {
  let page: Page, walls: any, house: any;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  });
  test.afterAll(async () => {
    await page?.close();
  });
  test("plan and 200mm walls", async () => {
    await floor(page, "Дом 4 × 3 м — Alpha.15");
    await select(page, [2, 0, 1.5]);
    await page.keyboard.press("f");
    const offset = page.getByLabel("Размер отступа", { exact: true });
    await offset.fill("200mm");
    await offset.press("Enter");
    await expect(page.locator(".viewport-canvas")).toHaveAttribute(
      "data-topology-faces",
      "2",
    );
    await select(page, [2, 0, 1.5]);
    await page.keyboard.press("Delete");
    await select(page, [0.1, 0, 1.5]);
    await page.keyboard.press("p");
    await height(page, "3m");
    await expect(page.locator(".viewport-canvas")).toHaveAttribute(
      "data-topology-faces",
      "10",
    );
    walls = await save(page);
    const g = firstModel(walls);
    expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(7.92, 7);
  });
  test("cuts a real window and door through the front wall", async () => {
    await page.keyboard.press("r");
    await click(page, [1, 1, 3]);
    await size(page, "1m;1m");
    await select(page, [1.5, 1.5, 3]);
    await page.keyboard.press("p");
    await height(page, "-200mm");
    let g = firstModel(await save(page));
    expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(7.72, 7);
    await page.keyboard.press("r");
    await click(page, [2.5, 0, 3]);
    await size(page, "800mm;2000mm");
    await select(page, [2.9, 1, 3]);
    await page.keyboard.press("p");
    await height(page, "-200mm");
    walls = await save(page);
    g = firstModel(walls);
    expect(classifyBody(g, Object.keys(g.bodies)[0])).toBe("closed-shell");
    expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(7.4, 7);
    await select(page, [0.5, 1, 3]);
    await page
      .getByRole("button", {
        name: "Сгруппировать всю геометрию сцены",
        exact: true,
      })
      .click();
    walls = await save(page);
  });
  test("draws an independent roof on a numeric plane and raises its ridge with M", async () => {
    await page.keyboard.press("r");
    await page.getByText("Плоскость и контекст", { exact: true }).click();
    await page
      .getByLabel("Контекст рисования", { exact: true })
      .selectOption("[]");
    await page
      .getByLabel("Плоскость рисования", { exact: true })
      .selectOption("XZ");
    await page
      .getByRole("button", {
        name: "Использовать рабочую плоскость",
        exact: true,
      })
      .click();
    const coordinates = page.getByLabel("Ввод координат построения", {
      exact: true,
    });
    await coordinates.check();
    await size(page, "0m;3m;0m");
    await coordinates.uncheck();
    await size(page, "4m;3m");
    await select(page, [1, 3, 1]);
    await page.keyboard.press("p");
    await height(page, "200mm");
    await ridge(page, 3.2);
    await click(page, [2, 3.2, 1.5]);
    await page.keyboard.press("m");
    await click(page, [2, 3.2, 1.5]);
    await page.keyboard.press("ArrowUp");
    const move = page.getByLabel("Размер перемещения", { exact: true });
    await move.fill("1m");
    await move.press("Enter");
    await expect(move).toBeHidden();
    await select(page, [1, 3.7, 1.5]);
    await page
      .getByRole("button", {
        name: "Сгруппировать всю геометрию сцены",
        exact: true,
      })
      .click();
    house = await save(page);
    expect(Object.keys(house.geometries)).toHaveLength(2);
    const volumes = Object.values(house.geometries)
      .map((g: any) => {
        const v = bodyVolume(g, Object.keys(g.bodies)[0]);
        expect(v).not.toBeNull();
        return v!;
      })
      .sort((a, b) => a - b);
    expect(volumes[0]).toBeCloseTo(7.4, 7);
    expect(volumes[1]).toBeCloseTo(8.4, 7);
    const gid = Object.keys(walls.geometries)[0];
    expect(house.geometries[gid]).toEqual(walls.geometries[gid]);
  });
  test("saves, closes and reopens the entire house with identical geometry and groups", async () => {
    page.once("dialog", (d) => d.accept());
    await page.reload();
    await page.locator("input[type=file]").setInputFiles({
      name: "alpha15-house.v3d",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(house)),
    });
    await page.getByTestId("viewport").waitFor();
    const opened = await save(page);
    expect(opened.geometries).toEqual(house.geometries);
    expect(opened.nodes).toEqual(house.nodes);
    mkdirSync("docs/0.2/images", { recursive: true });
    writeFileSync(
      "docs/0.2/examples/alpha15-house.v3d",
      JSON.stringify(opened, null, 2),
    );
    await page.bringToFront();
    await expect(page.locator(".viewport-canvas")).toHaveAttribute(
      "data-topology-faces",
      "24",
    );
    await page.screenshot({
      path: "docs/0.2/images/alpha15-house.png",
      animations: "disabled",
      caret: "hide",
    });
    for (const g of Object.values(opened.geometries) as GeometryModel[])
      expect(
        Object.values(g.faces).every((f) => tessellateFace(g, f).area > 0),
      ).toBe(true);
  });
});
