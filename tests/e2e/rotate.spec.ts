import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
import { precisionProject } from "../fixtures/precision-project";
import { serializeProject } from "@forma/document";
import { emptyProjectV2 } from "@forma/document";
import {
  emptyGeometry,
  id,
  prepareSketch,
  validatePrepared,
} from "@forma/geometry";
function planarFaceProject() {
  const p = emptyProjectV2("Face Rotate E2E"),
    gid = id<"geometry">("rotate/face-geometry"),
    materialId = "rotate/material";
  p.materials[materialId] = {
    id: materialId,
    color: "#8796aa",
    roughness: 0.8,
    metalness: 0,
  };
  const context = {
    ownerDefinitionId: p.rootDefinitionId,
    materialIds: new Set([materialId]),
  };
  let g = emptyGeometry(gid, id(p.rootDefinitionId));
  const segments: [[number, number, number], [number, number, number]][] = [
    [
      [0, 0, 0],
      [4, 0, 0],
    ],
    [
      [4, 0, 0],
      [4, 0, 3],
    ],
    [
      [4, 0, 3],
      [0, 0, 3],
    ],
    [
      [0, 0, 3],
      [0, 0, 0],
    ],
  ];
  g = validatePrepared(
    g,
    prepareSketch(
      g,
      { kind: "insert-segments", segments, plane: null },
      context,
      id("rotate/face-seed"),
    ),
    context,
    id("rotate/face-seed"),
  );
  p.geometries[gid] = g;
  p.definitions[p.rootDefinitionId].geometryId = gid;
  p.camera = precisionProject().camera;
  return p;
}
async function load(
  page: Page,
  pick: [number, number, number] = [4, 0, 0],
  kind: "vertex" | "edge" | "face" = "vertex",
  project = precisionProject(),
) {
  const p = project;
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "rotate.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await page.getByTestId("viewport").waitFor();
  const box = (await page.getByTestId("viewport").boundingBox())!,
    camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.fromArray(p.camera.position);
  camera.lookAt(new Vector3(...p.camera.target));
  camera.updateMatrixWorld();
  const v = new Vector3(...pick).project(camera);
  await page.mouse.click(
    box.x + ((v.x + 1) * box.width) / 2,
    box.y + ((1 - v.y) * box.height) / 2,
  );
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    kind,
  );
  return p;
}
test("Q rotates a real selected topology vertex, previews, commits, undoes and roundtrips", async ({
  page,
}) => {
  const source = await load(page);
  await page.keyboard.press("q");
  await expect(page.getByTestId("rotate-panel")).toBeVisible();
  await page.getByLabel("Угол вращения", { exact: true }).fill("90");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "rotate",
  );
  await page
    .getByRole("button", { name: "Повернуть · Enter", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const saved = JSON.parse(
    readFileSync((await (await download).path())!, "utf8"),
  );
  const g = Object.values(saved.geometries)[0] as any,
    v = Object.values(g.vertices).find(
      (x: any) =>
        Math.abs(x.position[0]) < 1e-7 && Math.abs(x.position[1] - 4) < 1e-7,
    );
  expect(v).toBeTruthy();
  expect(Object.keys(g.edges)).toHaveLength(1);
  await page.keyboard.press("Control+z");
  const undone = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const original = JSON.parse(
    readFileSync((await (await undone).path())!, "utf8"),
  );
  expect(original.geometries).toEqual(source.geometries);
  await page.keyboard.press("Control+Shift+z");
  const redone = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  expect(
    JSON.parse(readFileSync((await (await redone).path())!, "utf8")).geometries,
  ).toEqual(saved.geometries);
});
test("Q rotates both endpoints of a picked real edge", async ({ page }) => {
  const source = await load(page, [2, 0, 0], "edge");
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "edge",
  );
  await page.keyboard.press("q");
  await expect(page.getByTestId("rotate-panel")).toBeVisible();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "rotate",
  );
  await page.getByRole("button", { name: "Повернуть · Enter" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const saved = JSON.parse(
    readFileSync((await (await download).path())!, "utf8"),
  );
  const before = Object.values(source.geometries)[0] as any,
    after = Object.values(saved.geometries)[0] as any;
  expect(Object.keys(after.vertices)).toEqual(Object.keys(before.vertices));
  expect(Object.keys(after.edges)).toEqual(Object.keys(before.edges));
  expect(
    Object.values(after.vertices).some(
      (v: any) =>
        Math.abs(v.position[0]) < 1e-7 && Math.abs(v.position[1] - 4) < 1e-7,
    ),
  ).toBe(true);
});
test("Q rotates the boundary vertices of a picked real face", async ({
  page,
}) => {
  const source = planarFaceProject();
  await load(page, [2, 0, 1.5], "face", source);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  await page.keyboard.press("q");
  await expect(page.getByTestId("rotate-panel")).toBeVisible();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "rotate",
  );
  await page.getByRole("button", { name: "Повернуть · Enter" }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const saved = JSON.parse(
    readFileSync((await (await download).path())!, "utf8"),
  );
  const before = Object.values(source.geometries)[0] as any,
    after = Object.values(saved.geometries)[0] as any;
  expect(Object.keys(after.vertices)).toEqual(Object.keys(before.vertices));
  expect(Object.keys(after.edges)).toEqual(Object.keys(before.edges));
  const points = Object.values(after.vertices).map((v: any) => v.position);
  for (const expected of [
    [0, 0, 0],
    [0, 4, 0],
    [0, 4, 3],
    [0, 0, 3],
  ])
    expect(
      points.some((point: number[]) =>
        point.every((value, i) => Math.abs(value - expected[i]) < 1e-7),
      ),
    ).toBe(true);
});
test("invalid Q angle preserves topology and does not create a command", async ({
  page,
}) => {
  const source = await load(page);
  await page.keyboard.press("q");
  await page.getByLabel("Угол вращения", { exact: true }).fill("NaN");
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Повернуть · Enter", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Угол");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const saved = JSON.parse(
    readFileSync((await (await download).path())!, "utf8"),
  );
  expect(saved.geometries).toEqual(source.geometries);
});
