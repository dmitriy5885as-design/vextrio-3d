import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
import { emptyProjectV2, serializeProject } from "@forma/document";
import {
  emptyGeometry,
  id,
  prepareSketch,
  tessellateFace,
  validatePrepared,
  type Vec3,
} from "@forma/geometry";
import { precisionProject } from "../fixtures/precision-project";

function planarFaceProject() {
  const p = emptyProjectV2("Scale Face E2E"),
    gid = id<"geometry">("scale/face-geometry"),
    materialId = "scale/material";
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
  const segments: [Vec3, Vec3][] = [
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
  const operationId = id<"operation">("scale/face-seed");
  g = validatePrepared(
    g,
    prepareSketch(
      g,
      { kind: "insert-segments", segments, plane: null },
      context,
      operationId,
    ),
    context,
    operationId,
  );
  p.geometries[gid] = g;
  p.definitions[p.rootDefinitionId].geometryId = gid;
  p.camera = precisionProject().camera;
  return p;
}

async function load(
  page: Page,
  pick: Vec3 = [4, 0, 0],
  kind: "vertex" | "edge" | "face" = "vertex",
  project = precisionProject(),
) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "scale.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  const canvas = page.getByTestId("viewport");
  await canvas.waitFor();
  const box = (await canvas.boundingBox())!,
    camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.fromArray(project.camera.position);
  camera.lookAt(new Vector3(...project.camera.target));
  camera.updateMatrixWorld();
  const point = new Vector3(...pick).project(camera);
  await page.mouse.click(
    box.x + ((point.x + 1) * box.width) / 2,
    box.y + ((1 - point.y) * box.height) / 2,
  );
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    kind,
  );
  return project;
}

async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await pending).path())!, "utf8"));
}

test("S scales a picked topology vertex, previews, saves and restores exact geometry through Undo/Redo", async ({
  page,
}) => {
  const source = await load(page);
  await page.keyboard.press("s");
  await expect(page.getByTestId("scale-panel")).toBeVisible();
  await page.getByLabel("Масштаб X", { exact: true }).fill("2");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "scale",
  );
  await page.getByRole("button", { name: "Масштабировать · Enter" }).click();
  const scaled = await save(page),
    sourceGeometry = Object.values(source.geometries)[0] as any,
    scaledGeometry = Object.values(scaled.geometries)[0] as any;
  expect(Object.keys(scaledGeometry.vertices)).toEqual(
    Object.keys(sourceGeometry.vertices),
  );
  expect(Object.keys(scaledGeometry.edges)).toEqual(
    Object.keys(sourceGeometry.edges),
  );
  expect(
    Object.values(scaledGeometry.vertices).some(
      (vertex: any) =>
        Math.abs(vertex.position[0] - 8) < 1e-7 &&
        Math.abs(vertex.position[1]) < 1e-7,
    ),
  ).toBe(true);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(source.geometries);
  await page.keyboard.press("Control+Shift+z");
  expect((await save(page)).geometries).toEqual(scaled.geometries);
});

test("S scales both endpoints when the user selects a real edge", async ({
  page,
}) => {
  await load(page, [2, 0, 0], "edge");
  await page.keyboard.press("s");
  await expect(page.getByTestId("scale-panel")).toBeVisible();
  await page.getByLabel("Масштаб X", { exact: true }).fill("2");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "scale",
  );
  await page.getByRole("button", { name: "Масштабировать · Enter" }).click();
  const project = await save(page),
    geometry = Object.values(project.geometries)[0] as any;
  expect(
    Object.values(geometry.vertices).some(
      (vertex: any) => Math.abs(vertex.position[0] - 8) < 1e-7,
    ),
  ).toBe(true);
});

test("S scales all boundary vertices of a picked face and keeps face topology editable", async ({
  page,
}) => {
  await load(page, [2, 0, 1.5], "face", planarFaceProject());
  await page.keyboard.press("s");
  await expect(page.getByTestId("scale-panel")).toBeVisible();
  await page.getByLabel("Масштаб X", { exact: true }).fill("2");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "scale",
  );
  await page.getByRole("button", { name: "Масштабировать · Enter" }).click();
  const project = await save(page),
    geometry = Object.values(project.geometries)[0] as any;
  expect(Object.keys(geometry.faces)).toHaveLength(1);
  expect(Object.keys(geometry.vertices)).toHaveLength(4);
  expect(
    tessellateFace(geometry, Object.values(geometry.faces)[0] as any).area,
  ).toBeCloseTo(24, 7);
  expect(
    Object.values(geometry.vertices).some(
      (vertex: any) => Math.abs(vertex.position[0] - 8) < 1e-7,
    ),
  ).toBe(true);
});

test("zero scale reports an error and never changes saved topology", async ({
  page,
}) => {
  const source = await load(page);
  await page.keyboard.press("s");
  await page.getByLabel("Масштаб X", { exact: true }).fill("0");
  await expect(page.getByRole("alert")).toContainText("Масштаб");
  await page.getByRole("button", { name: "Масштабировать · Enter" }).click();
  await expect(page.getByRole("alert")).toContainText("Масштаб");
  expect((await save(page)).geometries).toEqual(source.geometries);
});
