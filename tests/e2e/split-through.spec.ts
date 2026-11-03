import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { bodyVolume, classifyBody, type GeometryModel } from "@forma/geometry";
import { createHomeProject } from "./home-helpers";

test("builds a wall, divides its back, and cuts through both opposite faces using the actual limit button", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page, "Разделённая стена");
  let camera = { position: [9, 7, 10], target: [0, 0, 0] };
  async function click(p: [number, number, number]) {
    const box = (await page.getByTestId("viewport").boundingBox())!;
    const c = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
    c.position.set(...(camera.position as [number, number, number]));
    c.lookAt(new Vector3(...camera.target));
    c.updateMatrixWorld();
    const v = new Vector3(...p).project(c);
    await page.mouse.click(
      box.x + ((v.x + 1) * box.width) / 2,
      box.y + ((1 - v.y) * box.height) / 2,
    );
  }
  async function save() {
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Сохранить проект", exact: true })
      .click();
    return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
  }
  async function size(value: string) {
    const f = page.getByLabel("Размер построения", { exact: true });
    await f.fill(value);
    await f.press("Enter");
  }
  await page.keyboard.press("r");
  await click([0, 0, 0]);
  await size("4m;200mm");
  await page.keyboard.press("Space");
  await click([2, 0, 0.1]);
  await page.keyboard.press("p");
  const height = page.getByLabel("Высота выдавливания", { exact: true });
  await height.fill("3m");
  await height.press("Enter");
  await expect(page.getByTestId("volume-preview")).toHaveCount(0);
  await page
    .getByLabel("Стандартный вид", { exact: true })
    .selectOption("back");
  camera = (await save()).camera;
  await page.keyboard.press("l");
  await click([1.5, 0, 0]);
  await click([1.5, 3, 0]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  await page
    .getByLabel("Стандартный вид", { exact: true })
    .selectOption("front");
  camera = (await save()).camera;
  await page.keyboard.press("r");
  await click([1, 1, 0.2]);
  await size("1m;1m");
  await page.keyboard.press("Space");
  await click([1.5, 1.5, 0.2]);
  await page.keyboard.press("p");
  const before = await save();
  await page
    .getByRole("button", { name: /^До противоположной грани/ })
    .click();
  await expect(page.getByTestId("volume-preview")).toContainText("2.2 м³");
  await height.press("Enter");
  await expect(page.getByTestId("volume-preview")).toHaveCount(0);
  const after = await save(),
    g = Object.values(after.geometries)[0] as GeometryModel,
    b = Object.values(g.bodies)[0];
  expect(classifyBody(g, b.id)).toBe("closed-shell");
  expect(bodyVolume(g, b.id)).toBeCloseTo(2.2, 8);
  await page.keyboard.press("Control+z");
  expect((await save()).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save()).geometries).toEqual(after.geometries);
  page.once("dialog", (d) => d.accept());
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "split-window.v3d",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(after)),
    });
  expect((await save()).geometries).toEqual(after.geometries);
});
