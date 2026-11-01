import { expect, type Page } from "@playwright/test";
export async function createHomeProject(page: Page, name?: string) {
  await page.getByRole("button", { name: "Новый проект", exact: true }).click();
  if (name !== undefined)
    await page.getByLabel("Название проекта", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.getByTestId("viewport")).toBeVisible();
}
