import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
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

const model = (p: any) => Object.values(p.geometries)[0] as GeometryModel;
async function start(page: Page) {
  await page.goto("/");
  await createHomeProject(page, "Базовые инструменты");
}
async function line(
  page: Page,
  a: [number, number, number],
  b: [number, number, number],
) {
  await page.keyboard.press("l");
  await click(page, a);
  await click(page, b);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
}
async function move(page: Page, p: [number, number, number]) {
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(...p).project(c);
  await page.mouse.move(
    b.x + ((v.x + 1) * b.width) / 2,
    b.y + ((1 - v.y) * b.height) / 2,
  );
}
async function rectangle(page: Page) {
  await start(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  await size(page, "4m;3m");
  await page.keyboard.press("Space");
}
async function stroke(page: Page, points: [number, number, number][]) {
  await page
    .getByRole("button", { name: "Свободное рисование", exact: true })
    .click();
  await move(page, points[0]);
  await page.mouse.down();
  for (const p of points.slice(1)) await move(page, p);
  await page.mouse.up();
}
test("polygon creates a real six-sided prism with radius input, Undo and exact file roundtrip", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Многоугольник", exact: true })
    .click();
  await expect(page.getByLabel("Стороны многоугольника")).toHaveValue("6");
  await click(page, [0, 0, 0]);
  await size(page, "2000mm");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  let p = await save(page);
  expect(Object.keys(model(p).edges)).toHaveLength(6);
  await select(page, [0.2, 0, 0.2]);
  await page.keyboard.press("p");
  await height(page, "3m");
  const after = await save(page),
    g = model(after);
  writeFileSync(
    "test-results/basic-polygon.v3d",
    JSON.stringify(after, null, 2),
  );
  await page.screenshot({
    path: "test-results/basic-polygon.png",
    animations: "disabled",
    caret: "hide",
  });
  expect(classifyBody(g, Object.keys(g.bodies)[0])).toBe("closed-shell");
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(
    18 * Math.sqrt(3),
    7,
  );
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(p.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "polygon.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  await page.getByTestId("viewport").waitFor();
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("freehand closed stroke creates a face and solid using actual pointer drawing", async ({
  page,
}) => {
  await start(page);
  await stroke(page, [
    [0, 0, 0],
    [2, 0, 0],
    [2, 0, 2],
    [0, 0, 2],
    [0, 0, 0],
  ]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  const before = await save(page);
  await select(page, [1, 0, 1]);
  expect(
    Number(
      (await page.getByTestId("face-area").innerText()).match(
        /Площадь: ([0-9.]+)/,
      )![1],
    ),
  ).toBeCloseTo(4, 5);
  await page.keyboard.press("p");
  await height(page, "2m");
  const g = model(await save(page));
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(8, 5);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("Escape cancels a held freehand stroke without creating history or geometry", async ({
  page,
}) => {
  await start(page);
  const before = await save(page);
  await page
    .getByRole("button", { name: "Свободное рисование", exact: true })
    .click();
  await move(page, [0, 0, 0]);
  await page.mouse.down();
  await move(page, [2, 0, 0]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await save(page)).geometries).toEqual(before.geometries);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
});
test("E erases a divider into one twelve-square-metre face and Undo restores its IDs", async ({
  page,
}) => {
  await rectangle(page);
  await line(page, [0, 0, 0], [4, 0, 3]);
  const before = await save(page);
  await page.keyboard.press("e");
  await click(page, [2, 0, 1.5]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Space");
  await click(page, [1, 0, 1]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
  const after = await save(page);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("one eraser drag removes two dividers atomically and one Undo restores all regions", async ({
  page,
}) => {
  await rectangle(page);
  await line(page, [1, 0, 0], [1, 0, 3]);
  await line(page, [3, 0, 0], [3, 0, 3]);
  const before = await save(page);
  await page.keyboard.press("e");
  await move(page, [0.5, 0, 1.5]);
  await page.mouse.down();
  await move(page, [3.5, 0, 1.5]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "3",
  );
  await page.screenshot({
    path: "test-results/basic-eraser-preview.png",
    animations: "disabled",
    caret: "hide",
  });
  await page.mouse.up();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("eraser never edits a group from the outside context", async ({
  page,
}) => {
  await rectangle(page);
  await line(page, [0, 0, 0], [4, 0, 3]);
  const root = await save(page);
  await select(page, [1, 0, 1]);
  await page
    .getByRole("button", {
      name: "Сгруппировать всю геометрию сцены",
      exact: true,
    })
    .click();
  const before = await save(page);
  await page.keyboard.press("e");
  await click(page, [2, 0, 1.5]);
  const after = await save(page);
  expect(after.geometries).toEqual(before.geometries);
  expect(after.nodes).toEqual(before.nodes);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(root.geometries);
});
test("freehand draws on an existing vertical face and makes a real through opening", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  await size(page, "4m;200mm");
  await select(page, [2, 0, 0.1]);
  await page.keyboard.press("p");
  await height(page, "3m");
  await stroke(page, [
    [1, 1, 0.2],
    [2, 1, 0.2],
    [2, 2, 0.2],
    [1, 2, 0.2],
    [1, 1, 0.2],
  ]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  await select(page, [1.5, 1.5, 0.2]);
  expect(
    Number(
      (await page.getByTestId("face-area").innerText()).match(
        /Площадь: ([0-9.]+)/,
      )![1],
    ),
  ).toBeCloseTo(1, 5);
  await page.keyboard.press("p");
  await height(page, "-200mm");
  const opened = await save(page),
    g = model(opened);
  writeFileSync(
    "test-results/basic-freehand-window.v3d",
    JSON.stringify(opened, null, 2),
  );
  await page.screenshot({
    path: "test-results/basic-freehand-window.png",
    animations: "disabled",
    caret: "hide",
  });
  expect(classifyBody(g, Object.keys(g.bodies)[0])).toBe("closed-shell");
  expect(bodyVolume(g, Object.keys(g.bodies)[0])).toBeCloseTo(2.2, 7);
});

test("Escape discards an eraser stroke and modifiers never silently delete edges", async ({
  page,
}) => {
  await rectangle(page);
  await line(page, [0, 0, 0], [4, 0, 3]);
  const before = await save(page);
  await page.keyboard.press("e");
  await move(page, [2, 0, 1.5]);
  await page.mouse.down();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.down("Shift");
  await click(page, [2, 0, 1.5]);
  await page.keyboard.up("Shift");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("an open freehand stroke stays a wire and one Undo removes the entire stroke", async ({
  page,
}) => {
  await start(page);
  const before = await save(page);
  await stroke(page, [
    [0, 0, 0],
    [1, 0, 1],
    [2, 0, 0],
  ]);
  const g = model(await save(page));
  expect(Object.keys(g.edges)).toHaveLength(2);
  expect(Object.keys(g.faces)).toHaveLength(0);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("polygon accepts five sides and leaves the Circle segment setting independent", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Многоугольник", exact: true })
    .click();
  await size(page, "5s");
  await expect(page.getByLabel("Стороны многоугольника")).toHaveValue("5");
  await size(page, "2s");
  await expect(page.getByLabel("Стороны многоугольника")).toHaveValue("5");
  await click(page, [0, 0, 0]);
  await size(page, "1m");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  expect(Object.keys(model(await save(page)).edges)).toHaveLength(5);
  await page.keyboard.press("Space");
  await page.keyboard.press("c");
  await expect(page.getByLabel("Сегменты окружности")).toHaveValue("24");
});

test("idle drawing tools let Escape close the real settings dialog", async ({
  page,
}) => {
  await start(page);
  for (const tool of ["Ластик (E)", "Свободное рисование"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.getByRole("button", { name: "Параметры", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Параметры", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Параметры", exact: true }),
    ).toBeHidden();
  }
});
