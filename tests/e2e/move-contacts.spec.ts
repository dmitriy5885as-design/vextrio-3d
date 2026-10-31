import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import { type GeometryModel } from "@forma/geometry";
async function screen(page: Page, p: [number, number, number]) {
  const b = (await page.getByTestId("viewport").boundingBox())!,
    c = new PerspectiveCamera(45, b.width / b.height, 0.05, 10000);
  c.position.set(9, 7, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  const v = new Vector3(...p).project(c);
  return {
    x: b.x + ((v.x + 1) * b.width) / 2,
    y: b.y + ((1 - v.y) * b.height) / 2,
  };
}
async function click(page: Page, p: [number, number, number]) {
  const q = await screen(page, p);
  await page.mouse.click(q.x, q.y);
}
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await pending).path())!, "utf8"));
}

async function line(page: Page, points: [number, number, number][]) {
  await page.getByRole("button", { name: "Линия (L)", exact: true }).click();
  for (const p of points) await click(page, p);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
}
async function moveVertex(
  page: Page,
  p: [number, number, number],
  delta: string,
) {
  await click(page, p);
  await page.keyboard.press("m");
  await click(page, p);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill(delta);
  await input.press("Enter");
  await expect(input).toBeHidden();
}
async function roundtrip(page: Page, before: any, after: any, name: string) {
  await page.keyboard.press("Control+z");
  expect((await save(page)).geometries).toEqual(before.geometries);
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(after.geometries);
  writeFileSync(`test-results/${name}.v3d`, JSON.stringify(after, null, 2));
  await page.screenshot({ path: `test-results/${name}.png` });
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: `${name}.v3d`,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(after)),
    });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-edges",
    String(
      Object.keys((Object.values(after.geometries)[0] as GeometryModel).edges)
        .length,
    ),
  );
  await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
  expect((await save(page)).geometries).toEqual(after.geometries);
}
test("M joins a drawn endpoint to a real edge and keeps the T junction through history and files", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await line(page, [
    [0, 0, 0],
    [4, 0, 0],
  ]);
  await line(page, [
    [2, 0, 2],
    [2, 0, 1],
  ]);
  const before = await save(page);
  await moveVertex(page, [2, 0, 1], "0;0;-1m");
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(Object.keys(g.edges)).toHaveLength(3);
  expect(Object.keys(g.vertices)).toHaveLength(4);
  const v = Object.values(g.vertices).find(
    (v) => Math.abs(v.position[0] - 2) < 1e-7 && Math.abs(v.position[2]) < 1e-7,
  )!;
  expect(
    Object.values(g.edges).filter((e) => e.start === v.id || e.end === v.id),
  ).toHaveLength(3);
  await roundtrip(page, before, after, "move-contact-t");
});
test("M closes a drawn wire into a selectable twelve square metre face", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await line(page, [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, 3],
    [0, 0, 3],
    [0, 0, 1],
  ]);
  const before = await save(page);
  await moveVertex(page, [0, 0, 1], "0;0;-1m");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Space");
  await click(page, [2, 0, 1.5]);
  await expect(page.getByTestId("face-area")).toContainText("12 м²");
  const after = await save(page);
  await roundtrip(page, before, after, "move-contact-face");
});
