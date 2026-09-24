/** Wizard controls: mouse sliders, locks and free typing keep weights valid (regression). */
import { expect, type Page, test } from "@playwright/test";

const weights = async (page: Page, syms: string[]) =>
  Promise.all(syms.map(async (s) => Number(await page.getByTestId(`weight-${s}`).inputValue())));

async function clickTrack(page: Page, nth: number, frac: number) {
  const b = await page.locator("[data-slot=slider-track]").nth(nth).boundingBox();
  if (!b) throw new Error("slider not visible");
  await page.mouse.click(b.x + b.width * frac, b.y + b.height / 2);
}

test("weights: mouse, lock and typing keep the total at 100%", async ({ page }) => {
  const syms = ["NVDAx", "AAPLx", "MSFTx"];
  await page.goto("/create");
  for (const s of syms) await page.getByTestId(`asset-${s}`).click();
  await page.getByTestId("wizard-next").click();
  const total = page.getByTestId("weight-total");
  await expect(total).toHaveText("Total 100.00%");

  // Pointer click on the NVDAx slider (previously dropped to 0 and stuck).
  await clickTrack(page, 0, 0.7);
  let [n, a, m] = await weights(page, syms);
  expect(n).toBeGreaterThan(60);
  expect(a).toBeGreaterThan(0);
  expect(m).toBeGreaterThan(0);
  await expect(total).toHaveText("Total 100.00%");

  // Drag back down.
  const b = await page.locator("[data-slot=slider-track]").first().boundingBox();
  if (!b) throw new Error("slider not visible");
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  [n] = await weights(page, syms);
  expect(n).toBeGreaterThan(30);
  expect(n).toBeLessThan(50);
  await expect(total).toHaveText("Total 100.00%");

  // Locked assets do not move; typing decimals works.
  await page.getByRole("button", { name: "Lock AAPLx" }).click();
  [, a] = await weights(page, syms);
  await page.getByTestId("weight-NVDAx").fill("62.5");
  const after = await weights(page, syms);
  expect(after[0]).toBe(62.5);
  expect(after[1]).toBe(a);
  await expect(total).toHaveText("Total 100.00%");
  await page.getByTestId("weight-MSFTx").fill("");
  await expect(page.getByTestId("weight-MSFTx")).toHaveValue("");
  await page.getByTestId("weight-MSFTx").fill("10.");
  await expect(page.getByTestId("weight-MSFTx")).toHaveValue("10.");
  await expect(page.getByTestId("wizard-next")).toBeEnabled();

  // Strategy and fee sliders respond to the mouse (previously snapped to defaults).
  await page.getByTestId("wizard-next").click();
  await clickTrack(page, 0, 0.5);
  await expect(page.getByText(/^Drift threshold/).locator("..")).not.toContainText("threshold5%");
  await page.getByTestId("wizard-next").click();
  await clickTrack(page, 0, 0.6);
  await expect(
    page
      .getByText(/^Management fee/)
      .first()
      .locator(".."),
  ).toContainText("3% / yr");
});
