import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PerspectiveCamera, OrthographicCamera, Vector3 } from "three";

test("gizmo drag commits one reversible change", async ({ page }) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
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
  const scale =
    (camera.position.distanceTo(new Vector3(0, 1, 0)) *
      1.9 *
      Math.tan((Math.PI * 45) / 360) *
      0.85) /
    4;
  const handle = new Vector3(scale * 0.55, 1, 0).project(camera);
  const px = rect.x + ((handle.x + 1) * rect.width) / 2,
    py = rect.y + ((1 - handle.y) * rect.height) / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 65, py + 20, { steps: 12 });
  await page.mouse.up();
  const x = page.getByRole("spinbutton", { name: "Положение X", exact: true });
  await expect.poll(async () => Number(await x.inputValue())).not.toBe(0);
  await page.keyboard.press("Control+z");
  await expect(x).toHaveValue("0");
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".tree-object")).toHaveCount(0);
});
test("create, move, save and reopen cube", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Новый проект", exact: false })
    .filter({ has: page.locator(".start-icon") })
    .click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const x = page.getByRole("spinbutton", { name: "Положение X", exact: true });
  await x.fill("4.25");
  await x.press("Enter");
  await expect(x).toHaveValue("4.25");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(path).toBeTruthy();
  await expect(page.locator(".status-message")).toContainText(
    "Запись на диск не подтверждена",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  await expect(page.getByText("Ваша сцена пока пуста.")).toBeVisible();
  await page.locator("input[type=file]").setInputFiles(path!);
  await page.getByRole("button", { name: "Куб 1", exact: true }).click();
  await expect(x).toHaveValue("4.25");
  await expect(page.getByTestId("viewport")).toBeVisible();
  await page.screenshot({ path: "test-results/forma-editor.png" });
  expect(errors).toEqual([]);
});
test("mouse selection, history, camera and themes at target resolutions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  await page
    .getByRole("button", { name: "Выделение (V)", exact: true })
    .click();
  const canvas = page.getByTestId("viewport");
  const rect = (await canvas.boundingBox())!;
  await page.mouse.click(rect.x + 30, rect.y + rect.height / 2);
  await expect(page.getByText("Нет выделения", { exact: true })).toBeVisible();
  const camera = new PerspectiveCamera(
    45,
    rect.width / rect.height,
    0.05,
    10000,
  );
  camera.position.set(9, 7, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const center = new Vector3(0, 1, 0).project(camera);
  await page.mouse.click(
    rect.x + ((center.x + 1) * rect.width) / 2,
    rect.y + ((1 - center.y) * rect.height) / 2,
  );
  await expect(
    page.getByRole("textbox", { name: "Название объекта", exact: true }),
  ).toHaveValue("Куб 1");
  await page.keyboard.press("Control+d");
  await expect(page.locator(".tree-object")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await page.keyboard.press("Control+y");
  await expect(page.locator(".tree-object")).toHaveCount(2);
  await page.getByRole("button", { name: "Вид сверху" }).click();
  await page
    .getByRole("button", { name: "Перспектива", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Ортография", exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".app")).toHaveClass(/light/);
  await page.screenshot({ path: "test-results/forma-light-1366.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Изометрия ↗", exact: true }).click();
  await page.screenshot({ path: "test-results/forma-dark-1920.png" });
  expect(errors).toEqual([]);
});
test("invalid file leaves project intact and cancelled new preserves edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page
    .getByRole("button", { name: "Создать: Сфера", exact: true })
    .click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  await expect(page.locator(".tree-object")).toHaveCount(1);
  let messages: string[] = [];
  page.on("dialog", async (d) => {
    messages.push(d.message());
    await d.accept();
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.v3d",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await expect.poll(() => messages.some((m) => m.includes("JSON"))).toBe(true);
});

test("invalid numeric scale and locking keep the last valid object editable after unlock", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const scale = page.getByRole("spinbutton", {
    name: "Масштаб X",
    exact: true,
  });
  await scale.fill("0");
  await scale.press("Enter");
  await expect(scale).toHaveValue("1");
  await expect(page.locator(".status-message")).toContainText("масштаб");
  await page.getByLabel("Заблокировать", { exact: true }).check();
  await expect(scale).toBeDisabled();
  await page.keyboard.press("Delete");
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await page.getByLabel("Заблокировать", { exact: true }).uncheck();
  await scale.fill("2");
  await scale.press("Enter");
  await expect(scale).toHaveValue("2");
  await page.keyboard.press("Control+z");
  await expect(scale).toHaveValue("1");
});
test("browser download retains unsaved warning and cancelled new keeps the project", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await wait;
  await expect(page.locator(".status-message")).toContainText(
    "Запись на диск не подтверждена",
  );
  let warned = false;
  page.once("dialog", async (dialog) => {
    warned = dialog.message().includes("несохранённые");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  await expect.poll(() => warned).toBe(true);
  await expect(page.locator(".tree-object")).toHaveCount(1);
});
test("golden v1 opens with absolute legacy child placement and roundtrips unchanged", async ({
  page,
}) => {
  const source = "tests/fixtures/v1/mm.v3d",
    bytes = readFileSync(source),
    hash = () =>
      createHash("sha256").update(readFileSync(source)).digest("hex"),
    before = hash();
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.locator("input[type=file]").setInputFiles(source);
  await expect(page.locator(".tree-object")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Выделение (V)", exact: true })
    .click();
  const rect = (await page.getByTestId("viewport").boundingBox())!;
  const camera = new OrthographicCamera(
    (-10 * rect.width) / rect.height,
    (10 * rect.width) / rect.height,
    10,
    -10,
    0.05,
    10000,
  );
  camera.position.set(9, 7, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const center = new Vector3(1.25, 1, -2).project(camera);
  await page.mouse.click(
    rect.x + ((center.x + 1) * rect.width) / 2,
    rect.y + ((1 - center.y) * rect.height) / 2,
  );
  await expect(
    page.getByRole("textbox", { name: "Название объекта", exact: true }),
  ).toHaveValue("Сфера ребёнок");
  await expect(
    page.getByRole("spinbutton", { name: "Положение X", exact: true }),
  ).toHaveValue("1250");
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const downloaded = await wait;
  const saved = readFileSync((await downloaded.path())!, "utf8");
  expect(JSON.parse(saved)).toEqual(JSON.parse(bytes.toString("utf8")));
  expect(hash()).toBe(before);
});

test("cancelling Save As does not rename or clear the project", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  let promptSeen = false;
  page.once("dialog", async (dialog) => {
    promptSeen = dialog.type() === "prompt";
    await dialog.dismiss();
  });
  await page.keyboard.press("Control+Shift+s");
  await expect.poll(() => promptSeen).toBe(true);
  await expect(page.locator(".project-title")).toContainText("Без названия");
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await expect(page.locator(".unsaved-dot")).toBeVisible();
  await expect(page.locator(".file-busy-overlay")).toHaveCount(0);
});
