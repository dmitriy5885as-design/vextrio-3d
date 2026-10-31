import {createHomeProject} from "./home-helpers";
import { test, expect } from "@playwright/test";
import { APP_VERSION, APP_RELEASE_LABEL } from "@forma/shared";
test("VEXTRIO 3D welcome, editor, settings and help retain working v1 editing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(`VEXTRIO 3D — ${APP_RELEASE_LABEL}`);
  await expect(page.getByTestId("app-version")).toBeVisible();
  await expect(page.getByTestId("app-version")).toHaveText(APP_RELEASE_LABEL);
  await expect(page.getByAltText("Знак VEXTRIO 3D")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("FORMA");
  const logo = await page.request.get("/vextrio.svg");
  expect(logo.ok()).toBe(true);
  expect(await logo.text()).toContain('viewBox="0 0 128 128"');
  await page.screenshot({ path: "test-results/vextrio-welcome.png" });
  await createHomeProject(page);
  await expect(page.locator(".brand strong")).toHaveText("VEXTRIO 3D");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("FORMA");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Справка", exact: true }).click();
  await page.getByRole("button", { name: "О VEXTRIO 3D и управление" }).click();
  await expect(page.getByRole("heading", { name: /VEXTRIO 3D/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("FORMA");
  // The «О программе» tab renders the auto-generated devblog from
  // CHANGELOG.md; it must carry the shipped version and never leak the
  // pre-rebrand name into the visible UI.
  await page.getByRole("button", { name: "О программе" }).click();
  await expect(page.getByText(APP_VERSION).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Недавние изменения" }),
  ).toBeVisible();
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

test("exact alpha version stays visible in the editor at 1024 pixels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await createHomeProject(page);
  const version = page.getByTestId("app-version");
  await expect(version).toBeVisible();
  await expect(version).toHaveText(APP_RELEASE_LABEL);
  await expect(version).toBeInViewport();
  await expect(page).toHaveTitle(`VEXTRIO 3D — ${APP_RELEASE_LABEL}`);
});
