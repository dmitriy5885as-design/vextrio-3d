import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
type Point = [number, number, number];
async function start(page: Page) {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await expect(page.getByTestId("viewport")).toBeVisible();
}
async function position(
  page: Page,
  p: Point,
  cameraPosition: Point = [9, 7, 10],
  target: Point = [0, 0, 0],
) {
  const box = (await page.getByTestId("viewport").boundingBox())!,
    camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.fromArray(cameraPosition);
  camera.lookAt(new Vector3(...target));
  camera.updateMatrixWorld();
  const v = new Vector3(...p).project(camera);
  return {
    x: box.x + ((v.x + 1) * box.width) / 2,
    y: box.y + ((1 - v.y) * box.height) / 2,
  };
}
async function click(page: Page, p: Point) {
  const v = await position(page, p);
  await page.mouse.click(v.x, v.y);
}
async function move(page: Page, p: Point) {
  const v = await position(page, p);
  await page.mouse.move(v.x, v.y);
}
async function download(page: Page, output?: string) {
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const file = await promise;
  if (output) await file.saveAs(output);
  return JSON.parse(readFileSync((await file.path())!, "utf8"));
}
test("drawing remains usable at 1024 pixels with the input dock outside the canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await start(page);
  await page.keyboard.press("r");
  await expect(page.getByTestId("sketch-panel")).toBeVisible();
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4000mm;3000mm");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Space");
  await click(page, [2, 0, 1]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
});
test("exact line length keeps its direction while the user focuses the dimension field", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("l");
  await click(page, [0, 0, 0]);
  await move(page, [4, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.click();
  await input.fill("2500 мм");
  await input.press("Enter");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Continue",
  );
  await page.keyboard.press("Space");
  await expect(page.getByTestId("sketch-panel")).toHaveCount(0);
  const saved = await download(page),
    g = Object.values(saved.geometries)[0] as {
      vertices: Record<string, { position: Point }>;
    };
  expect(
    Object.values(g.vertices).some(
      (v) =>
        Math.abs(v.position[0] - 2.5) < 1e-7 && Math.abs(v.position[2]) < 1e-7,
    ),
    JSON.stringify(g.vertices),
  ).toBe(true);
});
test("double-click confirmation creates one rectangle and switching tools during a held pointer cancels it", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const corner = await position(page, [4, 0, 3]);
  await page.mouse.dblclick(corner.x, corner.y);
  await expect(page.getByTestId("sketch-panel")).toContainText(
    "Щёлкните начальную точку",
  );
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  const point = await position(page, [6, 0, 0]);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.keyboard.press("l");
  await page.mouse.up();
  await expect(page.getByTestId("sketch-panel")).not.toHaveAttribute(
    "data-phase",
    "Start",
  );
  const saved = await download(page);
  expect(
    Object.keys(
      (Object.values(saved.geometries)[0] as { faces: object }).faces,
    ),
  ).toHaveLength(1);
});
test("mouse rectangle becomes a real face, diagonal splits it, Shift selects both and file reopens identically", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await page.getByTitle("Прямоугольник (R)", { exact: true }).click();
  await click(page, [0, 0, 0]);
  await move(page, [4, 0, 3]);
  await expect(page.getByTestId("sketch-preview-stats")).toContainText(
    "граней: 1",
  );
  await page.screenshot({ path: "test-results/s6-rectangle-preview.png" });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "0",
  );
  const rectangleStart = Date.now();
  await click(page, [4, 0, 3]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  const rectangleMs = Date.now() - rectangleStart;
  await page.keyboard.press("Space");
  await click(page, [2, 0, 1]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
  await page.keyboard.press("l");
  await click(page, [0, 0, 0]);
  await move(page, [4, 0, 3]);
  const diagonalStart = Date.now();
  await click(page, [4, 0, 3]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  await page.keyboard.press("Space");
  console.log(
    "S6_UI_LATENCY_MS",
    JSON.stringify({
      rectangle: rectangleMs,
      diagonal: Date.now() - diagonalStart,
    }),
  );
  await move(page, [3, 0, 1]);
  await click(page, [3, 0, 1]);
  await expect(page.getByTestId("face-area")).toContainText("6 м²");
  await page.keyboard.down("Shift");
  await click(page, [1, 0, 2]);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-count")).toContainText("2");
  const saved = await download(page, "test-results/s6-drawn-project.v3d"),
    g = Object.values(saved.geometries)[0] as { edges: object; faces: object };
  expect(Object.keys(g.edges)).toHaveLength(5);
  expect(Object.keys(g.faces)).toHaveLength(2);
  await page.screenshot({ path: "test-results/s6-drawn-diagonal.png" });
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "drawn.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const reopened = await download(page);
  expect(reopened.geometries).toEqual(saved.geometries);
  expect(errors).toEqual([]);
});
test("midpoint snaps split opposite edges and create two actual regions", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4m;3m");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("l");
  await move(page, [2, 0, 0]);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "midpoint",
  );
  await click(page, [2, 0, 0]);
  await move(page, [2, 0, 3]);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "midpoint",
  );
  await click(page, [2, 0, 3]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const saved = await download(page),
    g = Object.values(saved.geometries)[0] as {
      vertices: Record<string, { position: Point }>;
      edges: object;
    };
  expect(Object.keys(g.edges)).toHaveLength(7);
  expect(Object.keys(g.vertices)).toHaveLength(6);
});
test("drawing in a scaled group preserves neighbouring component geometry and reports physical area", async ({
  page,
}) => {
  const before = JSON.parse(
    readFileSync("tests/fixtures/v2/components.v3d", "utf8"),
  );
  before.nodes["instance/group"].transform.scale = [2, 1, 1];
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "groups.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(before)),
  });
  await expect(page.getByTestId("viewport")).toBeVisible();
  await expect(page.locator(".project-title")).toContainText(before.name);
  await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("r");
  await page.getByText("Плоскость и контекст", { exact: true }).click();
  await page
    .getByLabel("Контекст рисования", { exact: true })
    .selectOption('["instance/group"]');
  await page
    .getByLabel("Координаты рисования", { exact: true })
    .selectOption("local");
  await page.getByLabel("Ввод координат построения", { exact: true }).check();
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("0;0;0");
  await input.press("Enter");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Start",
  );
  await page.getByLabel("Ввод координат построения", { exact: true }).uncheck();
  await input.fill("4000mm;3000mm");
  await input.press("Enter");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Finish",
  );
  await page.keyboard.press("Space");
  await page
    .locator(".tree-object")
    .filter({ hasText: "Группа слева" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("face-world-area")).toContainText("12 м²");
  const after = await download(page);
  expect(after.geometries["native/geometry"]).toEqual(
    before.geometries["native/geometry"],
  );
  expect(after.nodes).toEqual(before.nodes);
  expect(Object.keys(after.geometries)).toHaveLength(2);
});
test("invalid dimensions, lost focus and pointer cancellation leave an empty document intact", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("0;3m");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await input.press("Escape");
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Idle",
  );
  await click(page, [0, 0, 0]);
  await move(page, [4, 0, 3]);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Idle",
  );
  await click(page, [0, 0, 0]);
  await move(page, [4, 0, 3]);
  await page
    .getByTestId("viewport")
    .dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(page.getByTestId("sketch-panel")).toHaveAttribute(
    "data-phase",
    "Idle",
  );
  expect((await download(page)).geometries).toEqual({});
});
test("keyboard rectangle uses exact millimetres as one history action, while Escape never commits preview", async ({
  page,
}) => {
  await start(page);
  await page
    .getByLabel("Единицы измерения", { exact: true })
    .selectOption("mm");
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4000;3000");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "0",
  );
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  const before = await download(page);
  await click(page, [6, 0, 0]);
  await move(page, [8, 0, 2]);
  await page.keyboard.press("Escape");
  const after = await download(page);
  expect(after.geometries).toEqual(before.geometries);
});
test("polyline closure and crossing strokes create editable topology; repeated click events add nothing", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("l");
  for (const p of [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [0, 0, 3],
    [0, 0, 0],
  ] as Point[]) {
    await click(page, p);
    await expect(page.getByTestId("sketch-panel")).not.toHaveAttribute(
      "data-phase",
      "Commit",
    );
  }
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Escape");
  await click(page, [2, 0, -1]);
  await click(page, [2, 0, 4]);
  await expect(page.getByTestId("sketch-panel")).not.toHaveAttribute(
    "data-phase",
    "Commit",
  );
  const before = await download(page);
  await page.keyboard.press("Escape");
  const g = Object.values(before.geometries)[0] as {
    vertices: Record<string, { position: Point }>;
    edges: object;
  };
  expect(
    Object.values(g.vertices).some(
      (v) =>
        Math.abs(v.position[0] - 2) < 1e-7 && Math.abs(v.position[2]) < 1e-7,
    ),
  ).toBe(true);
  await page.keyboard.press("r");
  const v = await position(page, [6, 0, 0]);
  await page.mouse.dblclick(v.x, v.y);
  await page.keyboard.press("Escape");
  expect((await download(page)).geometries).toEqual(before.geometries);
});
