import { test, expect } from "@playwright/test";
test("VEXTRIO 3D welcome, editor, settings and help retain working v1 editing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("VEXTRIO 3D — Придай идее форму");
  await expect(page.getByAltText("Знак VEXTRIO 3D")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("FORMA");
  const logo = await page.request.get("/vextrio.svg");
  expect(logo.ok()).toBe(true);
  expect(await logo.text()).toContain('viewBox="0 0 128 128"');
  await page.screenshot({ path: "test-results/vextrio-welcome.png" });
  await page.locator(".start-card").first().click();
  await expect(page.locator(".brand strong")).toHaveText("VEXTRIO 3D");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("FORMA");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Справка", exact: true }).click();
  await page.getByRole("button", { name: "О VEXTRIO 3D и управление" }).click();
  await expect(page.getByRole("heading", { name: /VEXTRIO 3D/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("FORMA");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Создать: Куб", exact: true }).click();
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".tree-object")).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(page.locator(".tree-object")).toHaveCount(1);
  await page.screenshot({ path: "test-results/vextrio-editor.png" });
});
