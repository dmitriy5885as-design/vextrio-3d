import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

test("compact dock preserves object edits, locking, panel visibility and file-menu saving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.locator(".start-card").first().click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  const properties = page.getByRole("button", {
    name: "Свойства",
    exact: true,
  });
  const structure = page.getByRole("button", {
    name: "Структура",
    exact: true,
  });
  const x = page.getByRole("spinbutton", { name: "Положение X", exact: true });
  await expect(properties).toHaveAttribute("aria-pressed", "true");
  await x.fill("2.5");
  await x.press("Enter");
  await structure.click();
  await page.getByTitle("Заблокировать", { exact: true }).click();
  await properties.click();
  await expect(x).toBeDisabled();
  await structure.click();
  await page.getByTitle("Разблокировать", { exact: true }).click();
  await page.getByRole("button", { name: "Куб 1", exact: true }).click();
  await expect(x).toBeEnabled();
  await expect(x).toHaveValue("2.5");
  await page.getByRole("button", { name: "Окно", exact: true }).click();
  await page
    .locator(".dropdown")
    .getByRole("button", { name: "Скрыть боковую панель", exact: true })
    .click();
  await expect(properties).toHaveCount(0);
  await page.getByRole("button", { name: "Окно", exact: true }).click();
  await page
    .getByRole("button", { name: "Показать боковую панель", exact: true })
    .click();
  await expect(x).toHaveValue("2.5");
  await page.getByRole("button", { name: "Файл", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .locator(".dropdown")
    .getByRole("button", { name: "Сохранить Ctrl S", exact: true })
    .click();
  const download = await pending;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.format).toBe("forma");
  expect(
    Object.values(saved.objects ?? saved.nodes).some(
      (o: any) => o.transform?.position[0] === 2.5,
    ),
  ).toBe(true);
  await expect(page.locator(".status-message")).toContainText(
    "Запись на диск не подтверждена",
  );
  await page.screenshot({ path: "test-results/compact-workspace.png" });
});
