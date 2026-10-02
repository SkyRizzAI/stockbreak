/**
 * App UI (D053): dashboard (default) vs navbar layout, the first-visit prompt and the
 * Settings page, plus the System/Light/Dark theme choice.
 */
import { expect, test } from "@playwright/test";

test("first visit: prompt in the corner, default dashboard, choice is remembered", async ({
  page,
}) => {
  await page.goto("/home?layout-prompt");
  const prompt = page.getByTestId("layout-prompt");
  await expect(prompt).toBeVisible();
  // Default before choosing: the dashboard sidebar.
  await expect(page.locator('[data-app-layout="dashboard"]')).toHaveCount(1);
  await page.getByTestId("layout-choose-navbar").click();
  await expect(prompt).toHaveCount(0);
  await expect(page.locator('[data-app-layout="navbar"]')).toHaveCount(1);
  // Server renders the chosen layout on the next load (cookie), and the prompt stays away.
  await page.goto("/explore?layout-prompt");
  await expect(page.locator('[data-app-layout="navbar"]')).toHaveCount(1);
  await expect(page.getByTestId("layout-prompt")).toHaveCount(0);
});

test("closing the prompt keeps the dashboard", async ({ page }) => {
  await page.goto("/home?layout-prompt");
  await page.getByTestId("layout-prompt-close").click();
  await expect(page.getByTestId("layout-prompt")).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-app-layout="dashboard"]')).toHaveCount(1);
  await expect(page.getByTestId("layout-prompt")).toHaveCount(0);
});

test("settings switch layout and theme", async ({ page }) => {
  await page.goto("/settings");
  await page.getByTestId("layout-navbar").click();
  await expect(page.locator('[data-app-layout="navbar"]')).toHaveCount(1);
  await page.getByTestId("layout-dashboard").click();
  await expect(page.locator('[data-app-layout="dashboard"]')).toHaveCount(1);

  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("theme-light")).toHaveAttribute("aria-pressed", "true");
});
