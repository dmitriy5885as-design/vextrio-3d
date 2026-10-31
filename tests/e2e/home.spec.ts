import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHomeProject } from "./home-helpers";
import { RECENT_PROJECTS_KEY } from "@forma/file-io";
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});
async function save(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  return JSON.parse(readFileSync((await (await pending).path())!, "utf8"));
}
for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [1000, 768],
])
  test(`Home is a standalone responsive screen at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByTestId("vextrio-home")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.locator(".topbar")).toHaveCount(0);
    await expect(page.getByTestId("recent-empty")).toBeVisible();
    for (const name of [
      "Главная",
      "Проекты",
      "Шаблоны",
      "Обучение",
      "Настройки",
    ])
      await expect(
        page
          .getByRole("navigation", { name: "Стартовый центр" })
          .getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await page.waitForFunction(() =>
      Array.from(document.images).every(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/vextrio-home-${width}x${height}.png`,
    });
  });
test("new-project dialog creates a named document with real template and unit settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Новый проект",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.getByLabel("Название проекта", { exact: true }).fill("Мой стол");
  await page
    .getByLabel("Шаблон проекта", { exact: true })
    .selectOption("furniture");
  await page
    .getByLabel("Единицы измерения", { exact: true })
    .selectOption("cm");
  await dialog
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  const doc = await save(page);
  expect(doc.name).toBe("Мой стол");
  expect(doc.units).toBe("cm");
  expect(doc.extensions["vextrio:home"]).toEqual({
    templateId: "furniture",
    gridStep: 0.01,
    planeName: "XZ",
  });
  expect(Object.keys(doc.geometries)).toHaveLength(0);
});
for (const [name, units, step] of [
  ["Пустой проект", "m", 0.25],
  ["Архитектура", "m", 0.1],
  ["Мебель", "mm", 0.01],
  ["3D-печать", "mm", 0.001],
] as const)
  test(`template ${name} creates a usable document`, async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Стартовый центр" })
      .getByRole("button", { name: "Шаблоны", exact: true })
      .click();
    await page
      .locator(".home-template")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .click();
    await page
      .getByRole("button", { name: "Создать проект", exact: true })
      .click();
    await expect(page.getByTestId("viewport")).toBeVisible();
    const doc = await save(page);
    expect(doc.units).toBe(units);
    expect(doc.extensions["vextrio:home"].gridStep).toBe(step);
  });
test("opens a real v1 file and records only metadata; browser reopening requires file selection", async ({
  page,
}) => {
  const source = "tests/fixtures/v1/mm.v3d";
  const original = JSON.parse(readFileSync(source, "utf8"));
  await page.goto("/");
  const picker = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Открыть проект", exact: true })
    .click();
  await (await picker).setFiles(source);
  await expect(page.getByTestId("viewport")).toBeVisible();
  expect((await save(page)).name).toBe(original.name);
  await page
    .getByRole("button", { name: "Стартовый экран", exact: true })
    .click();
  await expect(
    page.getByText("Выбрать файл повторно", { exact: true }),
  ).toBeVisible();
  const recorded = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    RECENT_PROJECTS_KEY,
  );
  expect(recorded).toHaveLength(1);
  expect(recorded[0].source).toBe("browser");
  expect(recorded[0].path).toBeUndefined();
  await page.reload();
  const choose = page.waitForEvent("filechooser");
  await page
    .getByRole("button", {
      name: `Открыть недавний проект ${original.name}`,
      exact: true,
    })
    .click();
  await (await choose).setFiles(source);
  await expect(page.getByTestId("viewport")).toBeVisible();
  await page
    .getByRole("button", { name: "Стартовый экран", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `Удалить из списка ${original.name}`,
      exact: true,
    })
    .click();
  await expect(page.getByTestId("recent-empty")).toBeVisible();
  expect(JSON.parse(readFileSync(source, "utf8"))).toEqual(original);
});
test("Home roundtrip and cancelled replacement preserve unsaved work and Undo/Redo", async ({
  page,
}) => {
  await page.goto("/");
  await createHomeProject(page);
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const before = await save(page);
  await page
    .getByRole("button", { name: "Стартовый экран", exact: true })
    .click();
  await expect(
    page.getByText("Есть несохранённые изменения", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Продолжить работу", exact: true })
    .click();
  await expect(page.locator(".tree-object")).toHaveCount(1);
  expect((await save(page)).nodes).toEqual(before.nodes);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".tree-object")).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(page.locator(".tree-object")).toHaveCount(1);
});
test("restores the actual autosaved project from Home", async ({ page }) => {
  await page.goto("/");
  await createHomeProject(page);
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const before = await save(page);
  await expect(page.getByTestId("recovery-status")).toHaveText("Автокопия ✓");
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.getByTestId("recovery-card")).toBeVisible();
  await page
    .getByRole("button", { name: "Восстановить проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  expect((await save(page)).nodes).toEqual(before.nodes);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
});
test("settings share editor state; available lessons open working instructions", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Стартовый центр" });
  await nav.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Тема", { exact: true }).selectOption("light");
  await expect(page.locator(".app")).toHaveClass(/light/);
  await nav.getByRole("button", { name: "Обучение", exact: true }).click();
  await page.getByRole("button", { name: /Первая объёмная модель/ }).click();
  await expect(
    page.getByRole("heading", { name: "Первая объёмная модель", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Начать в новом проекте", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByLabel("Тема", { exact: true })).toHaveValue("light");
});
test("dialog supports Escape, returns focus and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const create = page.getByRole("button", {
    name: "Новый проект",
    exact: true,
  });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Название проекта", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(create).toBeFocused();
  expect(
    await create.evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await expect(page.locator("canvas")).toHaveCount(0);
});
test("invalid file on Home does not create a recent record or open an editor", async ({
  page,
}) => {
  await page.goto("/");
  const choose = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Открыть проект", exact: true })
    .click();
  await (
    await choose
  ).setFiles({
    name: "broken.v3d",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("alert")).toContainText("JSON");
  await expect(page.getByTestId("vextrio-home")).toBeVisible();
  await expect(page.getByTestId("recent-empty")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
});
test("unavailable Windows recent is visible, fails safely and can be removed (IPC boundary)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let entries = [
      {
        id: "registered-house",
        name: "Недоступный дом",
        fileName: "house.v3d",
        path: "C:\\Projects\\house.v3d",
        source: "native",
        lastOpened: 123456,
        available: false,
      },
    ];
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (cmd: string) => {
          if (cmd === "list_recent_projects") return entries;
          if (cmd === "open_recent_project")
            throw Error("Файл недоступен. Возможно, он перемещён или удалён.");
          if (cmd === "remove_recent_project") {
            entries = [];
            return;
          }
          if (cmd.includes("listen")) return 1;
          return null;
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByText("Файл недоступен", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Открыть недавний проект Недоступный дом",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText("Файл недоступен");
  await expect(page.locator("canvas")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Удалить из списка Недоступный дом",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("recent-empty")).toBeVisible();
});

test("a named empty project is protected and recoverable before its first geometric edit", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  await page
    .getByLabel("Название проекта", { exact: true })
    .fill("Мой новый проект");
  await page
    .getByLabel("Единицы измерения", { exact: true })
    .selectOption("mm");
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  await expect(page.getByTestId("recovery-status")).toHaveText("Автокопия ✓");
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.getByTestId("recovery-card")).toContainText(
    "Мой новый проект",
  );
  await page
    .getByRole("button", { name: "Восстановить проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  const doc = await save(page);
  expect(doc.name).toBe("Мой новый проект");
  expect(doc.units).toBe("mm");
  expect(Object.keys(doc.geometries)).toHaveLength(0);
});
