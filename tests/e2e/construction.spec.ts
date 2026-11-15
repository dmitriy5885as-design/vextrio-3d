import { PerspectiveCamera, Vector3 } from "three";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHomeProject } from "./home-helpers";

test("measures points and angle, saves real guides and undoes their creation", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page, "Измерения");
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await page
    .getByLabel("Измерение: точка A", { exact: true })
    .fill("0m; 0m; 0m");
  await page
    .getByLabel("Измерение: точка B", { exact: true })
    .fill("3000mm; 0m; 400cm");
  await page
    .getByLabel("Измерение: точка C", { exact: true })
    .fill("0m; 1m; 0m");
  await expect(
    page.getByLabel("Измеренное расстояние", { exact: true }),
  ).toContainText("5");
  await expect(
    page.getByLabel("Измеренный угол", { exact: true }),
  ).toContainText("90.0000°");
  await page
    .getByRole("button", { name: "Создать направляющую AB", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByLabel("Угол направляющей", { exact: true }).fill("45");
  await page
    .getByRole("button", {
      name: "Создать направляющую под углом",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Создать направляющую точку A", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(3);
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const document = JSON.parse(
    readFileSync((await (await event).path())!, "utf8"),
  );
  const guides = document.extensions["vextrio:construction"].guides;
  expect(Object.values(guides)).toHaveLength(3);
  expect(document.geometries).toEqual({});
  const first = Object.values(guides).find(
    (g: any) => g.kind === "line",
  ) as any;
  expect(first.direction[0]).toBeCloseTo(0.6, 12);
  expect(first.direction[1]).toBe(0);
  expect(first.direction[2]).toBeCloseTo(0.8, 12);
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await page.keyboard.press("Control+z");
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(3);
  page.once("dialog", (d) => d.accept());
  await page.locator("input[type=file]").setInputFiles({
    name: "измерения.v3d",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(3);
  const reopened = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const after = JSON.parse(
    readFileSync((await (await reopened).path())!, "utf8"),
  );
  expect(after.extensions["vextrio:construction"]).toEqual(
    document.extensions["vextrio:construction"],
  );
  await page.screenshot({ path: "test-results/measurement-guides.png" });
});

test("invalid measurement and guide input do not change the document", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page, "Ошибка измерения");
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await page.getByLabel("Измерение: точка B", { exact: true }).fill("0; 0; 0");
  await page
    .getByRole("button", { name: "Создать направляющую AB", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("разные точки");
  await expect(
    page
      .getByLabel("Направляющие контекста", { exact: true })
      .getByRole("listitem"),
  ).toHaveCount(0);
});

test("guide participates in the real Line tool snapping", async ({ page }) => {
  await page.goto("/");
  await createHomeProject(page, "Привязка к направляющей");
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await page
    .getByLabel("Измерение: точка A", { exact: true })
    .fill("0m; 0m; 1m");
  await page
    .getByLabel("Измерение: точка B", { exact: true })
    .fill("4m; 0m; 1m");
  await page
    .getByRole("button", { name: "Создать направляющую AB", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await page.keyboard.press("l");
  const rect = (await page.getByTestId("viewport").boundingBox())!;
  const camera = new PerspectiveCamera(
    45,
    rect.width / rect.height,
    0.05,
    10000,
  );
  camera.position.set(9, 7, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const projected = new Vector3(2.1, 0, 1.02).project(camera);
  await page.mouse.move(
    rect.x + ((projected.x + 1) * rect.width) / 2,
    rect.y + ((1 - projected.y) * rect.height) / 2,
  );
  const marker = page.getByTestId("snap-marker");
  await expect(marker).toContainText("Направляющая");
  await expect(marker).toHaveAttribute("data-kind", "guide");
  await page.mouse.down();
  await page.mouse.up();
  const end = new Vector3(3.1, 0, 1.02).project(camera);
  await page.mouse.move(
    rect.x + ((end.x + 1) * rect.width) / 2,
    rect.y + ((1 - end.y) * rect.height) / 2,
  );
  await expect(marker).toHaveAttribute("data-kind", "guide");
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const saved = JSON.parse(
    readFileSync((await (await download).path())!, "utf8"),
  );
  const model = Object.values(saved.geometries)[0] as any;
  expect(Object.keys(model.edges)).toHaveLength(1);
  for (const vertex of Object.values(model.vertices) as any[])
    expect(vertex.position[2]).toBeCloseTo(1, 9);
  await page.keyboard.press("Escape");
});

test("changing display units preserves the measurement's physical size", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page, "Единицы измерения");
  await page
    .getByRole("button", { name: "Измерения и направляющие", exact: true })
    .click();
  await page.getByLabel("Измерение: точка B", { exact: true }).fill("3; 0; 4");
  await page
    .getByLabel("Единицы измерения", { exact: true })
    .selectOption("mm");
  await expect(
    page.getByLabel("Измеренное расстояние", { exact: true }),
  ).toHaveText("5000 mm");
  await page.getByLabel("Единицы измерения", { exact: true }).selectOption("m");
  await expect(
    page.getByLabel("Измеренное расстояние", { exact: true }),
  ).toHaveText("5 m");
});
