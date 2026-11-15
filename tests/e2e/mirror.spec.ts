import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
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

function faceProject() {
  const project = emptyProjectV2("Mirror E2E"),
    geometryId = id<"geometry">("mirror/e2e-geometry"),
    materialId = "mirror/material",
    context = {
      ownerDefinitionId: project.rootDefinitionId,
      materialIds: new Set([materialId]),
    },
    segments: [Vec3, Vec3][] = [
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
  project.materials[materialId] = {
    id: materialId,
    color: "#8796aa",
    roughness: 0.8,
    metalness: 0,
  };
  let geometry = emptyGeometry(geometryId, id(project.rootDefinitionId));
  const op = id<"operation">("mirror/e2e-seed");
  geometry = validatePrepared(
    geometry,
    prepareSketch(
      geometry,
      { kind: "insert-segments", segments, plane: null },
      context,
      op,
    ),
    context,
    op,
  );
  project.geometries[geometryId] = geometry;
  project.definitions[project.rootDefinitionId].geometryId = geometryId;
  project.camera = precisionProject().camera;
  return project;
}

async function save(page: import("@playwright/test").Page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await download).path())!, "utf8"));
}

test("reflects a selected face through the editor, saves it and restores geometry with Undo/Redo", async ({
  page,
}) => {
  const original = faceProject();
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "mirror.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(original)),
  });
  const viewport = page.getByTestId("viewport");
  await viewport.waitFor();
  const box = (await viewport.boundingBox())!,
    camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.fromArray(original.camera.position);
  camera.lookAt(new Vector3(...original.camera.target));
  camera.updateMatrixWorld();
  const projected = new Vector3(2, 0, 1.5).project(camera);
  await page.mouse.click(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2,
  );
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  await page.keyboard.press("s");
  await page.getByRole("button", { name: "Отражение", exact: true }).click();
  await page.getByLabel("Координата плоскости отражения").fill("0");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-preview-owner",
    "scale",
  );
  await page.getByRole("button", { name: "Отразить · Enter" }).click();
  const reflected = await save(page),
    sourceGeometry = Object.values(original.geometries)[0] as any,
    resultGeometry = Object.values(reflected.geometries)[0] as any;
  expect(Object.keys(resultGeometry.faces)).toEqual(
    Object.keys(sourceGeometry.faces),
  );
  expect(Object.keys(resultGeometry.vertices)).toEqual(
    Object.keys(sourceGeometry.vertices),
  );
  expect(
    Object.values(resultGeometry.vertices)
      .map((vertex: any) => vertex.position[0])
      .sort((a: number, b: number) => a - b),
  ).toEqual([-4, -4, 0, 0]);
  expect(
    tessellateFace(
      resultGeometry,
      Object.values(resultGeometry.faces)[0] as any,
    ).area,
  ).toBeCloseTo(12, 7);
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(original.geometries);
  await page.keyboard.press("Control+Shift+z");
  expect((await save(page)).geometries).toEqual(reflected.geometries);
});
