import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
async function open(page: Page) {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles("docs/0.2/examples/volume-pocket.v3d");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "11",
  );
}
async function save(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
}
const distance = (c: any) =>
  Math.hypot(...c.position.map((n: number, i: number) => n - c.target[i]));
test("orientation cube follows the real camera, preserves pan and framing, supports six views and drag without geometry or history changes", async ({
  page,
}) => {
  await open(page);
  const canvas = page.getByTestId("viewport"),
    box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    box.x + box.width * 0.5 + 40,
    box.y + box.height * 0.7 + 20,
    { steps: 5 },
  );
  await page.mouse.up({ button: "middle" });
  const before = await save(page);
  for (const view of ["top", "bottom", "front", "back", "left", "right"]) {
    await page
      .getByLabel("Стандартный вид", { exact: true })
      .selectOption(view);
    await expect(page.locator(".cube-active")).toHaveCount(1);
    const after = await save(page);
    expect(after.camera.target).toEqual(before.camera.target);
    expect(distance(after.camera)).toBeCloseTo(distance(before.camera), 6);
    expect(after.geometries).toEqual(before.geometries);
  }
  await page.getByRole("button", { name: "Тип проекции", exact: true }).click();
  const ortho = await save(page);
  expect(ortho.camera.projection).toBe("orthographic");
  expect(20 / ortho.camera.zoom).toBeCloseTo(
    (2 * distance(before.camera) * Math.tan(Math.PI / 8)) / before.camera.zoom,
    6,
  );
  await page.getByRole("button", { name: "Тип проекции", exact: true }).click();
  await page.getByRole("button", { name: "Изометрия ↗", exact: true }).click();
  const sphere = page.getByTestId("navigation-cube").locator("svg"),
    cb = (await sphere.boundingBox())!;
  const initial = await save(page);
  await page.mouse.move(cb.x + 70, cb.y + 65);
  await page.mouse.down();
  await page.mouse.move(cb.x + 110, cb.y + 85, { steps: 8 });
  await page.mouse.up();
  const dragged = await save(page);
  expect(dragged.camera.position).not.toEqual(initial.camera.position);
  expect(dragged.camera.target).toEqual(initial.camera.target);
  expect(dragged.geometries).toEqual(initial.geometries);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/alpha-navigation.png" });
});
test("paint native face, autosave, reload and recover identical topology and materials with an unsaved warning", async ({
  page,
}) => {
  await open(page);
  const box = (await page.getByTestId("viewport").boundingBox())!,
    camera = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  camera.position.set(9, 7, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new Vector3(2.8, 3, 1).project(camera);
  await page.mouse.click(
    box.x + ((point.x + 1) * box.width) / 2,
    box.y + ((1 - point.y) * box.height) / 2,
  );
  const face = await page
    .getByTestId("topology-selection")
    .getAttribute("data-entity-id");
  await page
    .getByLabel("Цвет выбранной грани", { exact: true })
    .fill("#dbad75");
  const saved = await save(page),
    g: any = Object.values(saved.geometries)[0];
  expect(saved.materials[g.faces[face!].frontMaterialId].color).toBe("#dbad75");
  await expect(page.getByTestId("recovery-status")).toHaveText("Автокопия ✓");
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.getByTestId("recovery-card")).toBeVisible();
  await page
    .getByRole("button", { name: "Восстановить проект", exact: true })
    .click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "11",
  );
  const recovered = await save(page);
  expect(recovered.geometries).toEqual(saved.geometries);
  expect(recovered.materials).toEqual(saved.materials);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".project-title")).toContainText(".v3d");
  await page.screenshot({ path: "test-results/alpha-recovered.png" });
});
test("corrupt recovery is rejected and can be discarded without preventing a new document", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("vextrio-recovery", 1);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("snapshots", "readwrite");
        tx.objectStore("snapshots").put(
          { version: 1, savedAt: Date.now(), text: "broken" },
          "latest",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("повреждена");
  await page
    .getByRole("button", { name: "Удалить автокопию", exact: true })
    .click();
  await expect(page.getByTestId("recovery-card")).toHaveCount(0);
  await page.locator(".start-card").first().click();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "0",
  );
});
