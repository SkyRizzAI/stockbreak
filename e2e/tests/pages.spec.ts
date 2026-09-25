import { expect, test } from "@playwright/test";
import { connectDevWallet, watchConsole } from "./helpers";

type Ctx = { index: string; creator: string };
let ctx: Ctx;

test.beforeAll(async ({ request }) => {
  const res = await request.get("/api/indexes?limit=50");
  const { items } = (await res.json()) as {
    items: { pubkey: string; symbol: string; creator: string }[];
  };
  const mag4 = items.find((i) => i.symbol === "MAG4") ?? items[0];
  if (!mag4) throw new Error("no seeded indexes — run `bun run seed`");
  ctx = { index: mag4.pubkey, creator: mag4.creator };
});

const PAGES: [string, (c: Ctx) => string, RegExp][] = [
  ["landing", () => "/", /index launchpad/],
  ["home", () => "/home", /Markets/],
  ["explore", () => "/explore", /Explore/],
  ["index", (c) => `/i/${c.index}`, /Magnificent Four/],
  ["manage", (c) => `/i/${c.index}/manage`, /Connect the creator wallet/],
  ["create", () => "/create", /Create index/],
  ["portfolio", () => "/portfolio", /Portfolio/],
  ["leaderboard", () => "/leaderboard", /Leaderboard/],
  ["profile", (c) => `/u/${c.creator}`, /followers/],
  ["faucet", () => "/faucet", /Faucet/],
  ["agents", () => "/agents", /agent/i],
  ["feed", () => "/feed", /Feed/],
];

for (const scheme of ["light", "dark"] as const) {
  for (const width of [375, 1280]) {
    test.describe(`${scheme} ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 900 } });
      for (const [name, url, text] of PAGES) {
        test(name, async ({ page }) => {
          const errs = watchConsole(page);
          await page.goto(url(ctx));
          await expect(page.locator("main")).toContainText(text);
          await page.waitForLoadState("networkidle");
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          );
          expect(overflow, "horizontal overflow").toBe(false);
          expect(errs).toEqual([]);
        });
      }
    });
  }
}

test("unknown sign request shows an error state", async ({ page }) => {
  watchConsole(page);
  await page.goto("/sign?id=00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "Request not found" })).toBeVisible();
});

test("pages render cleanly with a remembered wallet (no hydration mismatch)", async ({ page }) => {
  await page.goto("/home");
  await connectDevWallet(page);
  const errs = watchConsole(page);
  for (const url of ["/portfolio", `/i/${ctx.index}`, "/faucet", "/create", `/u/${ctx.creator}`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  }
  expect(errs).toEqual([]);
});

test("unknown index shows a not-found state", async ({ page }) => {
  await page.goto("/i/11111111111111111111111111111111");
  await expect(page.getByRole("heading", { name: "Index not found" })).toBeVisible();
  await expect(page.getByText("Explore indexes")).toBeVisible();
});
