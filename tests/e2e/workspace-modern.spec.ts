import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHomeProject } from "./home-helpers";
import { PerspectiveCamera, Vector3 } from "three";
async function start(page: Page) {
  await page.goto("/");
  await createHomeProject(page);
}
async function save(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
}
async function importFile(page: Page, name: string, buffer: Buffer) {
  await page.getByRole("button", { name: "Файл", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Импорт модели…", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/octet-stream", buffer });
  await expect(
    page.getByRole("heading", { name: "Импорт модели", exact: true }),
  ).toBeVisible();
}
async function tree(page: Page) {
  await page.getByRole("button", { name: "Структура", exact: true }).click();
}
const obj = Buffer.from(
  "v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 4 8 7 3\nf 2 3 7 6\nf 1 5 8 4\n",
);
test("dock and navigator have persistent reveal handles, controls are consolidated and help is searchable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await start(page);
  await page
    .getByRole("button", { name: "Скрыть боковую панель", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Структура", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Показать боковую панель", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Структура", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Скрыть навигатор", exact: true })
    .click();
  await expect(page.getByTestId("navigation-cube")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Показать навигатор", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Тип проекции", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".viewport-header,.reset-view")).toHaveCount(0);
  await expect(page.locator(".brand [data-testid=app-version]")).toHaveCount(0);
  await expect(
    page.locator(".statusbar [data-testid=app-version]"),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Перемещение (M)", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText("опорную точку");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Параметры", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Параметры", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Управление и справка", exact: true })
    .click();
  const helpBox = (await page
    .getByRole("dialog", { name: "Справка", exact: true })
    .boundingBox())!;
  expect(helpBox.x).toBeGreaterThan(100);
  expect(Math.abs(helpBox.x + helpBox.width / 2 - 1366 / 2)).toBeLessThan(2);
  expect(Math.abs(helpBox.y + helpBox.height / 2 - 768 / 2)).toBeLessThan(2);
  await page.getByRole("searchbox").fill("дуга");
  await expect(page.locator(".help-content")).toContainText(
    "Замкните её хордой",
  );
  await page.getByRole("tab", { name: "Горячие клавиши", exact: true }).click();
  await expect(page.locator(".help-grid")).toContainText("Delete");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Переключить проект", exact: true })
    .click();
  await expect(
    page.getByText("Нет открытых файлов", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/workspace-1366x768.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: "test-results/workspace-1920x1080.png" });
});
test("middle mouse pans a fixed view without rotation or geometry edits", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("combobox", { name: "Стандартный вид", exact: true })
    .selectOption("front");
  const before = await save(page),
    box = (await page.getByTestId("viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    box.x + box.width * 0.5 + 70,
    box.y + box.height * 0.6 + 30,
    { steps: 8 },
  );
  await page.mouse.up({ button: "middle" });
  const after = await save(page);
  expect(after.camera.target).not.toEqual(before.camera.target);
  const direction = (c: any) =>
    c.position.map((n: number, i: number) => n - c.target[i]);
  direction(before.camera).forEach((n: number, i: number) =>
    expect(direction(after.camera)[i]).toBeCloseTo(n, 7),
  );
  expect(after.geometries).toEqual(before.geometries);
});
test("OBJ import creates editable topology, edge Delete and Undo retain IDs, project roundtrips", async ({
  page,
}) => {
  await start(page);
  await importFile(page, "cube.obj", obj);
  await page.getByLabel("Единицы импортируемой модели").selectOption("m");
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(page.getByTestId("model-stats")).toContainText(
    "Грани: 6 · Рёбра: 12 · Полигоны: 12",
  );
  const before = await save(page);
  await tree(page);
  await page
    .locator(".topology-entities summary")
    .filter({ hasText: "Рёбра / отрезки" })
    .click();
  await page.getByRole("button", { name: "Ребро 1", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "4",
  );
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  const restored = await save(page);
  expect(restored.geometries).toEqual(before.geometries);
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "roundtrip.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restored)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("cube converts to 8 editable vertices, M works by physical key in Russian layout", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  await page
    .getByRole("button", { name: "Редактировать вершины", exact: true })
    .click();
  await expect(page.getByTestId("model-stats")).toContainText("Грани: 6");
  const before = await save(page);
  await tree(page);
  await page
    .locator(".topology-entities summary")
    .filter({ hasText: "Вершины" })
    .click();
  await page.getByRole("button", { name: "Вершина 7", exact: true }).click();
  await page
    .locator("body")
    .dispatchEvent("keydown", { key: "ь", code: "KeyM", bubbles: true });
  await expect(page.getByTestId("move-panel")).toBeVisible();
  const box = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  c.position.fromArray(before.camera.position);
  c.lookAt(new Vector3(...before.camera.target));
  c.zoom = before.camera.zoom;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  const point = new Vector3(1, 1, 1).project(c);
  await page.mouse.click(
    box.x + ((point.x + 1) * box.width) / 2,
    box.y + ((1 - point.y) * box.height) / 2,
  );
  const field = page.getByLabel("Размер перемещения", { exact: true });
  await expect(field).toBeVisible();
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  await field.fill("0m;0.2m;0m");
  await field.press("Enter");
  await expect(field).toBeHidden();
  const after = await save(page);
  expect(after.geometries).not.toEqual(before.geometries);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("STEP is parsed by actual local OCCT Worker and imported from Home with declared units", async ({
  page,
}) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Открыть проект", exact: true })
    .click();
  await (await chooser).setFiles("tests/fixtures/import-tetra.step");
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  await expect(page.getByTestId("model-stats")).toContainText(
    "Грани: 4 · Рёбра: 6 · Полигоны: 4",
  );
  const p = await save(page),
    g = Object.values(p.geometries)[0] as any;
  expect(Object.keys(g.vertices)).toHaveLength(4);
  expect(
    Math.max(...Object.values(g.vertices).flatMap((v: any) => v.position)),
  ).toBeCloseTo(0.01, 8);
});
test("invalid and cancelled imports preserve document and undo state", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const before = await save(page);
  await importFile(page, "broken.obj", Buffer.from("v 0 0 0\nf 1 2 99"));
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("диапазона");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect((await save(page)).nodes).toEqual(before.nodes);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("model-stats")).toContainText("Полигоны: 0");
  await page.keyboard.press("Control+y");
  expect((await save(page)).nodes).toEqual(before.nodes);
  await importFile(page, "cancel.obj", obj);
  await page.keyboard.press("Escape");
  expect((await save(page)).nodes).toEqual(before.nodes);
});

test("ASCII STL imports in millimetres and its real face extrudes into a saved prism", async ({
  page,
}) => {
  await start(page);
  const stl = Buffer.from(
    "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1000 0 0\nvertex 0 1000 0\nendloop\nendfacet\nendsolid triangle",
  );
  await importFile(page, "triangle.stl", stl);
  await expect(page.getByLabel("Единицы импортируемой модели")).toHaveValue(
    "mm",
  );
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(page.getByTestId("model-stats")).toContainText("Грани: 1");
  await tree(page);
  await page
    .locator(".topology-entities summary")
    .filter({ hasText: "Грани" })
    .click();
  await page.getByRole("button", { name: "Грань 1", exact: true }).click();
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("1m");
  await height.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "5",
  );
  const p = await save(page);
  expect(
    Object.values(p.geometries).some(
      (g: any) => Object.keys(g.faces).length === 5,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/workspace-imported-prism.png",
  });
});
test("cancelling a running CAD Worker returns to the unchanged editor", async ({
  page,
}) => {
  await start(page);
  const before = await save(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/cad/occt-import-js.wasm", async (route) => {
    await gate;
    try {
      await route.continue();
    } catch {}
  });
  await importFile(
    page,
    "cancel.step",
    readFileSync("tests/fixtures/import-tetra.step"),
  );
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Отменить импорт", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Отменить импорт", exact: true })
    .click();
  release();
  await expect(
    page.getByRole("heading", { name: "Импорт модели", exact: true }),
  ).toHaveCount(0);
  const after = await save(page);
  expect(after.geometries).toEqual(before.geometries);
  expect(after.nodes).toEqual(before.nodes);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
});
