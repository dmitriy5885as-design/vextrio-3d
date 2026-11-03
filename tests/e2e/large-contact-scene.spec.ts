import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { bodyVolume, entityTables, type GeometryModel } from "@forma/geometry";
import { largeContactScene } from "../fixtures/large-contact-scene";

test("edits a loaded recess with 650 distant faces through UI and restores exact history", async ({
  page,
}) => {
  const { p, g, distant } = largeContactScene();
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "large-scene.v3d",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await expect(page.getByTestId("viewport")).toBeVisible();
  const box = (await page.getByTestId("viewport").boundingBox())!;
  const camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.fromArray(p.camera.position);
  camera.lookAt(new Vector3(...p.camera.target));
  camera.updateMatrixWorld();
  const point = new Vector3(1.4, 1, 0.15).project(camera);
  await page.keyboard.press("Space");
  await page.mouse.click(
    box.x + ((point.x + 1) * box.width) / 2,
    box.y + ((1 - point.y) * box.height) / 2,
  );
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("-50mm");
  await height.press("Enter");
  await expect(page.getByTestId("volume-preview")).toHaveCount(0);
  async function save() {
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Сохранить проект", exact: true })
      .click();
    return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
  }
  const after = await save(),
    model = after.geometries[g.id] as GeometryModel;
  const wall = Object.values(g.bodies).find((b) => b.shellIds.length)!;
  expect(bodyVolume(model, wall.id)).toBeCloseTo(2.24, 8);
  for (const table of entityTables)
    for (const key of Object.keys(distant[table]))
      expect(model[table][key]).toEqual(g[table][key]);
  await page.keyboard.press("Control+z");
  expect((await save()).geometries).toEqual(p.geometries);
  await page.keyboard.press("Control+y");
  expect((await save()).geometries).toEqual(after.geometries);
});
