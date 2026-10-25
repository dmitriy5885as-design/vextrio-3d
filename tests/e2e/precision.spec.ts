import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
import {
  serializeProject,
  parseProject,
  type ProjectV2,
} from "@forma/document";
import { precisionProject } from "../fixtures/precision-project";
import { componentProject, topologyProject } from "../fixtures/v2-project";
async function load(page: Page, p: ProjectV2) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "precision.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await expect(page.getByTestId("viewport")).toBeVisible();
}
async function screen(
  page: Page,
  p: ProjectV2,
  point: [number, number, number],
) {
  const box = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  c.position.fromArray(p.camera.position);
  c.lookAt(new Vector3(...p.camera.target));
  c.updateMatrixWorld();
  const v = new Vector3(...point).project(c);
  return {
    x: box.x + ((v.x + 1) * box.width) / 2,
    y: box.y + ((1 - v.y) * box.height) / 2,
  };
}
test("real hover snaps, exact endpoint edit, error recovery and file/Undo roundtrip", async ({
  page,
}) => {
  const p = precisionProject(),
    g = Object.values(p.geometries)[0],
    v = Object.values(g.vertices).find((v) => v.position[0] === 4)!;
  await load(page, p);
  const endpoint = await screen(page, p, [4, 0, 0]);
  await page.mouse.click(endpoint.x, endpoint.y);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "vertex",
  );
  await page.getByTitle("Точная точка", { exact: true }).click();
  await page.mouse.move(endpoint.x + 2, endpoint.y + 1);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "endpoint",
  );
  const mid = await screen(page, p, [2, 0, 0]);
  await page.mouse.move(mid.x, mid.y);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "midpoint",
  );
  const input = page.getByLabel("Точный размер", { exact: true });
  await input.fill("4000,125 мм; 0; 0");
  await input.press("Enter");
  await expect(page.getByTestId("precision-target")).toHaveAttribute(
    "data-world",
    "[4.000125,0,0]",
  );
  await input.fill("incorrect");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("precision-target")).toHaveAttribute(
    "data-world",
    "[4.000125,0,0]",
  );
  await input.fill("4000,125 мм; 0; 0");
  await input.press("Enter");
  await page
    .getByRole("button", { name: "Переместить выбранную вершину", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const download = await downloadPromise,
    saved = parseProject(
      readFileSync((await download.path())!, "utf8"),
    ) as ProjectV2;
  expect(saved.geometries[g.id].vertices[v.id].position).toEqual([
    4.000125, 0, 0,
  ]);
  await page.keyboard.press("Control+z");
  const undoPromise = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  expect(
    (
      parseProject(
        readFileSync((await (await undoPromise).path())!, "utf8"),
      ) as ProjectV2
    ).geometries,
  ).toEqual(p.geometries);
  await page.keyboard.press("Control+y");
  await page.screenshot({ path: "test-results/s5-precise-endpoint.png" });
});
test("units preserve the physical exact point, rectangle preview and axis conflict are live", async ({
  page,
}) => {
  const p = precisionProject();
  await load(page, p);
  await page.getByTitle("Точная точка", { exact: true }).click();
  const input = page.getByLabel("Точный размер", { exact: true });
  await input.fill("2,5 м; 0; 0");
  await input.press("Enter");
  await page
    .getByLabel("Единицы измерения", { exact: true })
    .selectOption("mm");
  await expect(page.getByTestId("precision-target")).toHaveAttribute(
    "data-world",
    "[2.5,0,0]",
  );
  await expect(page.getByTestId("precision-target")).toContainText("2500 mm");
  await page.getByLabel("Фиксация оси", { exact: true }).selectOption("X");
  await input.fill("1 м;1 м;0");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("противоречат");
  await page.getByLabel("Фиксация оси", { exact: true }).selectOption("free");
  await page
    .getByLabel("Вид точного ввода", { exact: true })
    .selectOption("rectangle");
  await input.fill("4 м;3 м");
  await input.press("Enter");
  await expect(page.getByTestId("precision-panel")).toContainText(
    "Прямоугольник 4000 mm × 3000 mm",
  );
  await expect(page.getByTestId("precision-target")).toHaveAttribute(
    "data-world",
    "[4,0,3]",
  );
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-precision-preview-points",
    "5",
  );
  await page.screenshot({ path: "test-results/s5-rectangle.png" });
});
test("local context input uses its placement and shared-definition edits require explicit acknowledgement", async ({
  page,
}) => {
  const p = componentProject();
  p.camera = {
    position: [2, 8, 18],
    target: [2, 1.5, 0],
    projection: "perspective",
    zoom: 1,
  };
  await load(page, p);
  const vertex = await screen(page, p, [9, 0, 0]);
  await page.mouse.click(vertex.x, vertex.y);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "vertex",
  );
  await page.getByTitle("Точная точка", { exact: true }).click();
  await page
    .getByLabel("Система координат", { exact: true })
    .selectOption("local");
  const input = page.getByLabel("Точный размер", { exact: true });
  await input.fill("4;0;0");
  await input.press("Enter");
  await expect(page.getByTestId("precision-target")).toHaveAttribute(
    "data-world",
    "[9,0,0]",
  );
  const move = page.getByRole("button", {
    name: "Переместить выбранную вершину",
    exact: true,
  });
  await expect(move).toBeDisabled();
  await page
    .getByLabel("Изменить все 2 экземпляра общего компонента", { exact: true })
    .check();
  await expect(move).toBeEnabled();
  await page
    .getByLabel("Контекст точного ввода", { exact: true })
    .selectOption("[]");
  await expect(move).toHaveCount(0);
});
test("live face, hole, axis and intersection targets come from the shared Snap Engine", async ({
  page,
}) => {
  const p = topologyProject();
  await load(page, p);
  await page.getByTitle("Точная точка", { exact: true }).click();
  await page
    .getByLabel("Рабочая плоскость", { exact: true })
    .selectOption("XY");
  const face = await screen(page, p, [3, 1.5, 0]);
  await page.mouse.move(face.x, face.y);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "face",
  );
  const hole = await screen(page, p, [1.5, 1.5, 0]);
  await page.mouse.move(hole.x, hole.y);
  await expect(page.getByTestId("snap-marker")).not.toHaveAttribute(
    "data-kind",
    "face",
  );
  await page.getByLabel("Фиксация оси", { exact: true }).selectOption("X");
  const free = await screen(page, p, [2, 1, 0]);
  await page.mouse.move(free.x, free.y);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "axis",
  );
  const point = JSON.parse(
    (await page.getByTestId("precision-target").getAttribute("data-world"))!,
  );
  expect(point[1]).toBe(0);
  expect(point[2]).toBe(0);
  const cross = precisionProject([
    [
      [-1, 0, 0],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [0, 1, 0],
    ],
  ]);
  await load(page, cross);
  await page.getByTitle("Точная точка", { exact: true }).click();
  const intersection = await screen(page, cross, [0, 0, 0]);
  await page.mouse.move(intersection.x, intersection.y);
  await expect(page.getByTestId("snap-marker")).toHaveAttribute(
    "data-kind",
    "intersection",
  );
  await page.screenshot({ path: "test-results/s5-snap-intersection.png" });
});
