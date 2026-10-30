import { test, expect, type Page } from "@playwright/test";
import { PerspectiveCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
async function point(page: Page, p: [number, number, number]) {
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
  const v = await point(page, p);
  await page.mouse.click(v.x, v.y);
}
async function move(page: Page, p: [number, number, number]) {
  const v = await point(page, p);
  await page.mouse.move(v.x, v.y, { steps: 8 });
}
async function save(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, "utf8"));
}
async function profile(page: Page) {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.keyboard.press("r");
  await click(page, [0, 0, 0]);
  const size = page.getByLabel("Размер построения", { exact: true });
  await size.fill("4m;0.2m");
  await size.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "1",
  );
}
async function wall(page: Page) {
  await profile(page);
  await page.keyboard.press("p");
  await click(page, [2, 0, 0.1]);
  await move(page, [2, 3, 0.1]);
  await expect(
    page.getByLabel("Высота выдавливания", { exact: true }),
  ).not.toHaveValue("0m");
  const field = page.getByLabel("Высота выдавливания", { exact: true });
  await field.fill("3m");
  await expect(page.getByTestId("volume-preview")).toContainText("2.4 м³");
  await field.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
}
async function window(page: Page) {
  const previous = Number(
    await page.locator(".viewport-canvas").getAttribute("data-topology-faces"),
  );
  await page.keyboard.press("r");
  await click(page, [1, 1, 0.2]);
  await move(page, [2, 2, 0.2]);
  const field = page.getByLabel("Размер построения", { exact: true });
  await field.fill("1m;1m");
  await field.press("Enter");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    String(previous + 1),
  );
}
test("P click-move-click commits actual extrusion; moving alone and Escape never write geometry", async ({
  page,
}) => {
  await profile(page);
  const before = await save(page);
  await page.keyboard.press("p");
  await click(page, [2, 0, 0.1]);
  await move(page, [2, 3, 0.1]);
  await expect(page.getByTestId("volume-preview")).toBeVisible();
  expect((await save(page)).geometries).toEqual(before.geometries);
  await click(page, [2, 3, 0.1]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "6",
  );
  const after = await save(page),
    g: any = Object.values(after.geometries)[0];
  expect(Object.keys(g.vertices)).toHaveLength(8);
  expect(Object.keys(g.edges)).toHaveLength(12);
  await page.keyboard.press("Space");
  await click(page, [2, 1, 0.2]);
  await expect(page.getByTestId("body-volume")).toBeVisible();
  await page.keyboard.press("p");
  await page.keyboard.press("Escape");
  expect((await save(page)).geometries).toEqual(after.geometries);
});
test("draw directly on a vertical wall, push until opposite face and restore a true through opening", async ({
  page,
}) => {
  await wall(page);
  await window(page);
  await page.keyboard.press("p");
  await click(page, [1.5, 1.5, 0.2]);
  await move(page, [1.5, 1.5, -0.3]);
  await expect(page.getByTestId("volume-preview")).toContainText("2.2 м³");
  await click(page, [1.5, 1.5, -0.3]);
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "10",
  );
  const saved = await save(page),
    g: any = Object.values(saved.geometries)[0];
  expect(
    Object.values(g.faces).filter((f: any) => f.innerLoopIds.length),
  ).toHaveLength(2);
  expect(Object.keys(g.vertices)).toHaveLength(16);
  await page.screenshot({ path: "test-results/pushpull-window.png" });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "7",
  );
  await page.keyboard.press("Control+y");
  expect((await save(page)).geometries).toEqual(saved.geometries);
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page.locator("input[type=file]").setInputFiles({
    name: "window.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(page.locator(".viewport-canvas")).toHaveAttribute(
    "data-topology-faces",
    "10",
  );
  expect((await save(page)).geometries).toEqual(saved.geometries);
});
test("double click enters the group; drawing and cutting leave an independent neighbour unchanged", async ({
  page,
}) => {
  await wall(page);
  await page.keyboard.press("Space");
  await click(page, [2, 1, 0.2]);
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
  await x.fill("6");
  await x.press("Enter");
  const before = await save(page);
  await page.keyboard.press("Space");
  const v = await point(page, [2, 1, 0.2]);
  await page.mouse.dblclick(v.x, v.y);
  await expect(page.getByTestId("edit-context")).toBeVisible();
  await window(page);
  await page.keyboard.press("p");
  await click(page, [1.5, 1.5, 0.2]);
  await move(page, [1.5, 1.5, -0.3]);
  await expect(page.getByTestId("volume-preview")).toContainText("2.2 м³");
  await click(page, [1.5, 1.5, -0.3]);
  const after = await save(page),
    untouched = Object.values(before.nodes).find(
      (n: any) => n.transform.translation[0] === 6,
    ) as any,
    gid = before.definitions[untouched.definitionId].geometryId;
  expect(after.geometries[gid]).toEqual(before.geometries[gid]);
  await page
    .getByRole("button", { name: "Закрыть группу · Esc", exact: true })
    .click();
  await expect(page.getByTestId("edit-context")).toHaveCount(0);
});
