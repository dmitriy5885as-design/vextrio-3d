import {createHomeProject} from "./home-helpers";
import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync, writeFileSync } from "node:fs";
import {
  tessellateFace,
  type GeometryModel,
} from "@forma/geometry";
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
async function rectangle(page: Page) {
  await page.goto("/");
  await createHomeProject(page);
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("4m;3m");
  await input.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
  await page.keyboard.press("Space");
}
async function finish(page: Page, text: string, coordinates = false) {
  if (coordinates)
    await page
      .getByLabel("Режим перемещения", { exact: true })
      .selectOption("coordinates");
  const input = page.getByLabel("Размер перемещения", { exact: true });
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toBeHidden();
}

async function ring(page: Page) {
  await rectangle(page);
  await page.keyboard.press("r");
  await click(page, [1, 0, 1]);
  const input = page.getByLabel("Размер построения", { exact: true });
  await input.fill("1m;1m");
  await input.press("Enter");
  await page.keyboard.press("Space");
  await click(page, [1.5, 0, 1.5]);
  await page.keyboard.press("Delete");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
}
for (const corner of [
  [4, 0, 3],
  [2, 0, 2],
] as [number, number, number][]) {
  test(`draw a real opening and fold its ${corner[0] === 4 ? "outer" : "inner"} corner through history and files`, async ({
    page,
  }) => {
    await ring(page);
    const before = await save(page),
      source = Object.values(before.geometries)[0] as GeometryModel;
    expect(Object.keys(source.vertices)).toHaveLength(8);
    expect(Object.values(source.faces)[0].innerLoopIds).toHaveLength(1);
    await click(page, corner);
    await page.keyboard.press("m");
    await click(page, corner);
    await page.keyboard.press("ArrowUp");
    await finish(page, "1m");
    const after = await save(page),
      g = Object.values(after.geometries)[0] as GeometryModel;
    expect(Object.keys(g.faces).length).toBeGreaterThan(1);
    expect(Object.keys(g.vertices)).toHaveLength(8);
    for (const [id, edge] of Object.entries(source.edges))
      expect(g.edges[id]).toEqual(edge);
    let projected = 0;
    for (const f of Object.values(g.faces)) {
      const t = tessellateFace(g, f);
      for (let i = 0; i < t.indices.length; i += 3) {
        const [a, b, c] = t.indices.slice(i, i + 3).map((j) => t.positions[j]);
        projected +=
          Math.abs(
            (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]),
          ) / 2;
      }
    }
    expect(projected).toBeCloseTo(11, 7);
    await page.keyboard.press("Control+z");
    expect((await save(page)).geometries).toEqual(before.geometries);
    await page.keyboard.press("Control+y");
    expect((await save(page)).geometries).toEqual(after.geometries);
    writeFileSync(
      `test-results/holed-fold-${corner[0]}.v3d`,
      JSON.stringify(after, null, 2),
    );
    await page.screenshot({ path: `test-results/holed-fold-${corner[0]}.png` });
    page.on("dialog", (d) => d.accept());
    await page.reload();
    await page
      .locator("input[type=file]")
      .setInputFiles({
        name: "holed-fold.v3d",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(after)),
      });
    await expect(page.locator(".viewport-canvas")).toHaveAttribute(
      "data-topology-faces",
      String(Object.keys(g.faces).length),
    );
    await expect(page.locator(".app")).toHaveAttribute("aria-busy", "false");
    expect((await save(page)).geometries).toEqual(after.geometries);
  });
}
