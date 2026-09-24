import { expect, type Page } from "@playwright/test";

/** Console errors/warnings and uncaught exceptions collected for a page. */
export function watchConsole(page: Page, ignore: RegExp[] = []): string[] {
  const errs: string[] = [];
  const skip = (t: string) => ignore.some((r) => r.test(t));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !skip(m.text())) errs.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (!skip(e.message)) errs.push(e.message);
  });
  return errs;
}

/** Connect (or create) the built-in dev wallet; it is auto-funded on first connect. */
export async function connectDevWallet(page: Page): Promise<void> {
  await page.getByTestId("connect-wallet").first().click();
  await page.getByRole("button", { name: /dev wallet/i }).click();
  await expect(page.getByTestId("wallet-menu")).toBeVisible();
  // Success or failure toast; surface the failure text instead of timing out blindly.
  const outcome = page.getByText(/Dev wallet funded|Could not fund the dev wallet/i).first();
  await expect(outcome).toBeVisible({ timeout: 180_000 });
  const text = (await outcome.textContent()) ?? "";
  if (/Could not fund/i.test(text)) throw new Error(text);
}

export async function firstIndexHref(page: Page, symbol?: string): Promise<string> {
  const res = await page.request.get("/api/indexes?limit=50");
  const { items } = (await res.json()) as { items: { pubkey: string; symbol: string }[] };
  const it = symbol ? items.find((i) => i.symbol === symbol) : items[0];
  if (!it) throw new Error(`index ${symbol ?? "(any)"} not found`);
  return `/i/${it.pubkey}`;
}

export const done = (label: string | RegExp) =>
  typeof label === "string"
    ? new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — done`)
    : label;

/** Walk the create wizard (assets already picked or prefilled) and create the index. */
export async function finishWizard(
  page: Page,
  opts: { name: string; symbol: string; deposit?: string; follow?: boolean },
): Promise<string> {
  const next = page.getByTestId("wizard-next");
  await expect(next).toBeVisible();
  while (await next.isVisible()) {
    await expect(next).toBeEnabled();
    await next.click();
  }
  await page.getByTestId("index-name").fill(opts.name);
  await page.getByTestId("index-symbol").fill(opts.symbol);
  if (opts.deposit) await page.getByTestId("index-deposit").fill(opts.deposit);
  if (opts.follow) await page.getByRole("switch", { name: /follow parent/i }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/i\/[1-9A-HJ-NP-Za-km-z]{32,44}$/, { timeout: 180_000 });
  return new URL(page.url()).pathname;
}

/** Wait for a run's success toast, or fail fast with the error toast's text. */
export async function expectRun(page: Page, success: string | RegExp, timeout = 120_000) {
  const logged: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === "error") logged.push(m.text().slice(0, 1500));
  };
  page.on("console", onConsole);
  try {
    const ok = page.getByText(typeof success === "string" ? done(success) : success).first();
    const err = page.locator('[data-sonner-toast][data-type="error"]').first();
    await expect(ok.or(err)).toBeVisible({ timeout });
    if (await err.isVisible())
      throw new Error(`Error toast: ${(await err.textContent()) ?? ""}\n${logged.join("\n")}`);
  } finally {
    page.off("console", onConsole);
  }
}
