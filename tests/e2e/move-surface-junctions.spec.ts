import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { tessellateFace, type GeometryModel } from "@forma/geometry";
import { createHomeProject } from "./home-helpers";

test("M connects an imported partition to its wall with exact history and file roundtrip", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page, "Т-соединение");
  const obj =
    "v 0 0 0\nv 4 0 0\nv 4 3 0\nv 0 3 0\nv 2 0 1\nv 2 3 1\nv 2 3 2\nv 2 0 2\nf 1 2 3 4\nf 5 6 7 8\n";
  await page.locator("input[type=file]").setInputFiles({
    name: "partition.obj",
    mimeType: "text/plain",
    buffer: Buffer.from(obj),
  });
  await page.getByLabel("Единицы импортируемой модели").selectOption("m");
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  const imported = await save();
  c.position.fromArray(imported.camera.position);
  c.lookAt(new Vector3(...imported.camera.target));
  c.zoom = imported.camera.zoom;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  const v = new Vector3(2, 1.5, 1.5).project(c);
  const point = {
    x: b.x + ((v.x + 1) * b.width) / 2,
    y: b.y + ((1 - v.y) * b.height) / 2,
  };
  await page.mouse.dblclick(point.x, point.y);
  await page.keyboard.press("Space");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  async function save() {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Сохранить проект", exact: true })
      .click();
    return JSON.parse(readFileSync((await (await pending).path())!, "utf8"));
  }
  const before = await save();
  await page.keyboard.press("m");
  await page.mouse.click(point.x, point.y);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("0;0;-1m");
  await input.press("Enter");
  await expect(input).toBeHidden();
  const after = await save(),
    g = Object.values(after.geometries)[0] as GeometryModel;
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "3",
  );
  expect(Object.keys(g.bodies)).toHaveLength(1);
  expect(
    Object.values(g.faces)
      .map((f) => tessellateFace(g, f).area)
      .sort((a, b) => a - b),
  ).toEqual([3, 6, 6]);
  expect(
    Object.values(g.edges).filter(
      (e) =>
        Object.values(g.coedges).filter((co) => co.edgeId === e.id).length ===
        3,
    ),
  ).toHaveLength(1);
  await page.keyboard.press("Control+z");
  expect((await save()).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save()).geometries).toEqual(after.geometries);
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "junction.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(after)),
  });
  expect((await save()).geometries).toEqual(after.geometries);
});
