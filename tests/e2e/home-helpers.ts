import { expect, type Page } from "@playwright/test";
export async function createHomeProject(page: Page) {
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
}
