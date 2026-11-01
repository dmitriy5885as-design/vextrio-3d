import {createHomeProject} from "./home-helpers";
import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
async function clickWorld(page: Page, p: [number, number, number]) {
  const box = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, box.width / box.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(...p).project(c);
  await page.mouse.click(
    box.x + ((v.x + 1) * box.width) / 2,
    box.y + ((1 - v.y) * box.height) / 2,
  );
}
async function rectangle(page: Page) {
  await page.goto("/");
  await createHomeProject(page);
  await page.keyboard.press("r");
  await clickWorld(page, [0, 0, 0]);
  const size = page.getByLabel("Размер построения", { exact: true });
  await size.fill("4000mm;3000mm");
  await size.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Space");
  await clickWorld(page, [2, 0, 1]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
}
async function save(page: Page) {
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const download = await promise;
  return JSON.parse(readFileSync((await download.path())!, "utf8"));
}
test("draw a real profile, preview a three metre extrusion, commit a 36 cubic metre block, save and restore it", async ({
  page,
}) => {
  await rectangle(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("volume-preview")).toContainText("36 м³");
  const before = await save(page);
  expect(
    Object.keys(
      (Object.values(before.geometries)[0] as { faces: object }).faces,
    ),
  ).toHaveLength(1);
  await page.getByLabel("Высота выдавливания", { exact: true }).press("Enter");
  await expect(page.getByTestId("body-volume")).toContainText("36 м³");
  const saved = await save(page),
    g = Object.values(saved.geometries)[0] as {
      vertices: object;
      edges: object;
      faces: object;
      shells: object;
    };
  expect(Object.keys(g.vertices)).toHaveLength(8);
  expect(Object.keys(g.edges)).toHaveLength(12);
  expect(Object.keys(g.faces)).toHaveLength(6);
  expect(Object.keys(g.shells)).toHaveLength(1);
  await page.screenshot({ path: "test-results/vextrio-volume.png" });
  writeFileSync(
    "test-results/vextrio-block.v3d",
    JSON.stringify(saved, null, 2),
  );
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Control+y");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "block.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  expect((await save(page)).geometries).toEqual(saved.geometries);
});
test("push the cap back by a precise metre and reject an inverted solid without committing preview", async ({
  page,
}) => {
  await rectangle(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("volume-preview")).toContainText("36 м³");
  await page.getByLabel("Высота выдавливания", { exact: true }).press("Enter");
  await expect(page.getByTestId("body-volume")).toContainText("36 м³");
  await page.keyboard.press("p");
  const input = page.getByLabel("Высота выдавливания", { exact: true });
  await input.fill("-1000mm");
  await expect(page.getByTestId("volume-preview")).toContainText("24 м³");
  await input.press("Enter");
  await expect(page.getByTestId("body-volume")).toContainText("24 м³");
  const before = await save(page);
  await page.keyboard.press("p");
  await input.fill("-4000mm");
  await expect(page.getByRole("alert")).toBeVisible();
  await input.press("Escape");
  expect((await save(page)).geometries).toEqual(before.geometries);
});
test("draw a bounded pocket on a real cap using mouse and exact input", async ({
  page,
}) => {
  await rectangle(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("volume-preview")).toContainText("36 м³");
  await page.getByLabel("Высота выдавливания", { exact: true }).press("Enter");
  await page.keyboard.press("r");
  await clickWorld(page, [1, 3, 1]);
  const size = page.getByLabel("Размер построения", { exact: true });
  await size.fill("1000mm;1000mm");
  await size.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  await page.keyboard.press("Space");
  await clickWorld(page, [1.5, 3, 1.5]);
  await expect(page.getByTestId("face-area")).toContainText("1 м²");
  await page.keyboard.press("p");
  const input = page.getByLabel("Высота выдавливания", { exact: true });
  await input.fill("-1m");
  await expect(page.getByTestId("volume-preview")).toContainText("35 м³");
  await input.press("Enter");
  await expect(page.getByTestId("body-volume")).toContainText("35 м³");
  await page.screenshot({ path: "test-results/vextrio-pocket.png" });
  const pocket = await save(page);
  const geometry = Object.values(pocket.geometries)[0] as {
    faces: object;
    vertices: object;
    edges: object;
  };
  expect(Object.keys(geometry.faces)).toHaveLength(11);
  expect(Object.keys(geometry.vertices)).toHaveLength(16);
  expect(Object.keys(geometry.edges)).toHaveLength(24);
  writeFileSync(
    "test-results/vextrio-pocket.v3d",
    JSON.stringify(pocket, null, 2),
  );
});
test("group, copy, make independent, move and export a real solid through visible UI", async ({
  page,
}) => {
  await rectangle(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("volume-preview")).toContainText("36 м³");
  await page.getByLabel("Высота выдавливания", { exact: true }).press("Enter");
  await page
    .getByRole("button", {
      name: "Сгруппировать всю геометрию сцены",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Создать связанный экземпляр", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сделать независимым", exact: true })
    .click();
  const x = page.getByLabel("Положение группы X", { exact: true });
  await x.fill("5");
  await x.press("Enter");
  const saved = await save(page);
  expect(Object.keys(saved.geometries)).toHaveLength(2);
  const translations = Object.values(saved.nodes).map(
    (n: any) => n.transform.translation,
  );
  expect(translations).toContainEqual([0, 0, 0]);
  expect(translations).toContainEqual([5, 0, 0]);
  await page.getByRole("button", { name: "Файл", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспорт STL (мм)…", exact: true })
    .click();
  const file = await event,
    text = readFileSync((await file.path())!, "utf8");
  expect(text.match(/facet normal/g)).toHaveLength(24);
  expect(text).toContain("solid VEXTRIO_3D");
  await page.screenshot({ path: "test-results/vextrio-components.png" });
});
