import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import {
  bodyVolume,
  classifyBody,
  tessellateFace,
  type GeometryModel,
} from "@forma/geometry";
import { boxPolygons } from "../fixtures/solid-walls";
import { createHomeProject } from "./home-helpers";

test("M extends an imported partition end into a closed solid wall joint with history and reopening", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page, "Объёмный стык");
  const wall = boxPolygons([0, 0, 0], [4, 3, 0.2]),
    part = boxPolygons([1.9, 0, 1], [2.1, 3, 3]);
  const positions = [...wall.positions, ...part.positions],
    polygons = [
      ...wall.polygons,
      ...part.polygons.map((f) => f.map((i) => i + 8)),
    ];
  const obj = positions
    .map((v) => "v " + v.join(" "))
    .concat(polygons.map((f) => "f " + f.map((i) => i + 1).join(" ")))
    .join("\n");
  await page.locator("input[type=file]").setInputFiles({
    name: "solid-walls.obj",
    mimeType: "text/plain",
    buffer: Buffer.from(obj),
  });
  await page.getByLabel("Единицы импортируемой модели").selectOption("m");
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "12",
  );
  async function save() {
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Сохранить проект", exact: true })
      .click();
    return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
  }
  const before = await save(),
    original = Object.values(before.geometries)[0] as GeometryModel;
  expect(Object.keys(original.bodies)).toHaveLength(2);
  const cap = Object.values(original.faces).find((f) =>
    tessellateFace(original, f).positions.every(
      (v) => Math.abs(v[2] - 1) < 1e-8,
    ),
  )!;
  const index = Object.keys(original.faces).indexOf(cap.id) + 1;
  await page.getByRole("button", { name: "Структура", exact: true }).click();
  await page
    .locator(".topology-entities summary")
    .filter({ hasText: "Грани" })
    .click();
  await page
    .getByRole("button", { name: `Грань ${index}`, exact: true })
    .click();
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  const bounds = (await page.getByTestId("viewport").boundingBox())!,
    camera = new PerspectiveCamera(
      45,
      bounds.width / bounds.height,
      0.05,
      10000,
    );
  camera.position.fromArray(before.camera.position);
  camera.lookAt(new Vector3(...before.camera.target));
  camera.zoom = before.camera.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const point = new Vector3(2.1, 1.5, 2).project(camera);
  await page.keyboard.press("m");
  await page.mouse.click(
    bounds.x + ((point.x + 1) * bounds.width) / 2,
    bounds.y + ((1 - point.y) * bounds.height) / 2,
  );
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("0;0;-800mm");
  await input.press("Enter");
  await expect(input).toBeHidden();
  const after = await save(),
    g = Object.values(after.geometries)[0] as GeometryModel,
    b = Object.values(g.bodies)[0];
  expect(Object.keys(g.bodies)).toHaveLength(1);
  expect(classifyBody(g, b.id)).toBe("closed-shell");
  expect(bodyVolume(g, b.id)).toBeCloseTo(4.08, 8);
  expect(
    Object.values(g.edges).every(
      (e) =>
        Object.values(g.coedges).filter((c) => c.edgeId === e.id).length === 2,
    ),
  ).toBe(true);
  await page.keyboard.press("Control+z");
  expect((await save()).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save()).geometries).toEqual(after.geometries);
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "solid-joint.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  expect((await save()).geometries).toEqual(after.geometries);
  writeFileSync(
    "test-results/solid-wall-join.v3d",
    JSON.stringify(after, null, 2),
  );
  await page.screenshot({ path: "test-results/solid-wall-join.png" });
});
