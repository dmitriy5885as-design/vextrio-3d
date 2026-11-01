import {createHomeProject} from "./home-helpers";
import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import { tessellateFace, type GeometryModel } from "@forma/geometry";
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
  await page.locator("input[type=file]").setInputFiles({
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

async function rectangle(page: Page) {
  await page.goto("/");
  await createHomeProject(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4m;3m");
  await input.press("Enter");
  await page.keyboard.press("Space");
}
test("M attaches a free endpoint to a real face boundary and preserves its face ID through history and files", async ({
  page,
}) => {
  await rectangle(page);
  await line(page, [
    [5, 0, 1.5],
    [6, 0, 1.5],
  ]);
  const before = await save(page),
    source = Object.values(before.geometries)[0] as GeometryModel,
    fid = Object.keys(source.faces)[0];
  await moveVertex(page, [5, 0, 1.5], "-1m;0;0");
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(g.faces[fid]).toBeDefined();
  expect(g.loops[g.faces[fid].outerLoopId].coedgeIds).toHaveLength(5);
  expect(tessellateFace(g, g.faces[fid]).area).toBeCloseTo(12, 8);
  await roundtrip(page, before, after, "surface-contact-boundary");
});
test("M translates a free line onto a face and produces two selectable six square metre regions", async ({
  page,
}) => {
  await rectangle(page);
  await line(page, [
    [-5, 0, 1.5],
    [-1, 0, 1.5],
  ]);
  const before = await save(page);
  expect(
    Object.keys((Object.values(before.geometries)[0] as GeometryModel).edges),
  ).toHaveLength(5);
  await click(page, [-3, 0, 1.5]);
  await page.keyboard.press("m");
  await click(page, [-3, 0, 1.5]);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("5m;0;0");
  await input.press("Enter");
  await expect(input).toBeHidden();
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "2",
  );
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  for (const f of Object.values(g.faces))
    expect(tessellateFace(g, f).area).toBeCloseTo(6, 8);
  await page.keyboard.press("Space");
  await click(page, [2, 0, 0.75]);
  await expect(page.getByTestId("face-area")).toContainText("6 м²");
  await click(page, [2, 0, 2.25]);
  await expect(page.getByTestId("face-area")).toContainText("6 м²");
  await roundtrip(page, before, after, "surface-contact-split");
});

test("a moved chord splits a holed surface while picking still passes through the opening", async ({
  page,
}) => {
  await rectangle(page);
  await page
    .getByRole("button", { name: "Прямоугольник (R)", exact: true })
    .click();
  await click(page, [1, 0, 1]);
  const size = page.getByLabel("Размер построения", { exact: true });
  await size.fill("1m;1m");
  await size.press("Enter");
  await page.keyboard.press("Space");
  await click(page, [1.5, 0, 1.5]);
  await page.keyboard.press("Delete");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await line(page, [
    [-5, 0, 1.5],
    [-1, 0, 1.5],
  ]);
  const before = await save(page);
  await click(page, [-3, 0, 1.5]);
  await page.keyboard.press("m");
  await click(page, [-3, 0, 1.5]);
  await page
    .getByLabel("Режим перемещения", { exact: true })
    .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill("5m;0;0");
  await input.press("Enter");
  await expect(input).toBeHidden();
  const after = await save(page),
    g = Object.values(after.geometries)[0] as GeometryModel;
  expect(Object.keys(g.faces)).toHaveLength(2);
  expect(
    Object.values(g.faces).reduce((n, f) => n + tessellateFace(g, f).area, 0),
  ).toBeCloseTo(11, 8);
  await page.keyboard.press("Space");
  await click(page, [3, 0, 0.75]);
  await expect(page.getByTestId("topology-selection")).toHaveAttribute(
    "data-kind",
    "face",
  );
  await click(page, [1.5, 0, 1.75]);
  await expect(page.getByTestId("topology-selection")).toHaveCount(0);
  await roundtrip(page, before, after, "surface-contact-hole");
});
