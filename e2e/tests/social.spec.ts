/** Social feed (D033): posts, likes, comments, Following tab and anti-spam rules. */
import { expect, test } from "@playwright/test";
import { closeTxOverlay, connectDevWallet, expectRun, firstIndexHref } from "./helpers";

test.describe.configure({ mode: "serial" });

test("writes need a session and a same-site origin", async ({ request }) => {
  const anon = await request.post("/api/posts", { data: { body: "hello" } });
  expect(anon.status()).toBe(401);
  const cross = await request.post("/api/posts", {
    data: { body: "hello" },
    headers: { origin: "https://evil.example" },
  });
  expect(cross.status()).toBe(403);
});

test("a wallet without on-chain activity cannot post", async ({ page }) => {
  await page.goto("/feed");
  await connectDevWallet(page);
  await page.getByTestId("post-input").fill("gm, first post before joining anything");
  await page.getByTestId("post-submit").click();
  await expect(page.getByTestId("post-error")).toContainText("Join or create an index first");
});

test("post, like, comment, anti-spam, delete", async ({ page }) => {
  await page.goto("/home");
  await connectDevWallet(page);
  // Skin in the game: join an index first.
  await page.goto(await firstIndexHref(page, "MAG4"));
  await page.getByTestId("join-amount").fill("20");
  await page.getByTestId("join-submit").click();
  await expectRun(page, /Joined MAG4/);
  await closeTxOverlay(page);
  await page.getByRole("tab", { name: "Discussion" }).click();

  // Post from the index Discussion: attached to MAG4, one signature signs the session in.
  const body = `E2E thesis ${Date.now()}: megacaps + a pre-IPO sleeve.`;
  await expect
    .poll(
      async () => {
        await page.getByTestId("post-input").fill(body);
        await page.getByTestId("post-submit").click();
        await page.waitForTimeout(1500);
        const err = page.getByTestId("post-error");
        return (await err.count()) ? ((await err.textContent()) ?? "") : "";
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    // the indexer may need a few seconds to record the Joined event
    .not.toContain("Join or create an index first");
  const card = page.getByTestId("post-card").filter({ hasText: body });
  await expect(card).toBeVisible();
  // Inside MAG4's own discussion the index strip is hidden; the post is still attached.
  const feed = (await (await page.request.get("/api/feed?tab=all&limit=50")).json()) as {
    items: { body?: string; index?: { symbol: string } | null }[];
  };
  expect(feed.items.find((i) => i.body === body)?.index?.symbol).toBe("MAG4");

  // Anti-spam: same text again, and a second post inside the 20 s gap.
  await page.getByTestId("post-input").fill(body);
  await page.getByTestId("post-submit").click();
  await expect(page.getByTestId("post-error")).toContainText(/Slow down|already posted/);

  // Like / unlike (optimistic, persisted).
  const liked = page.waitForResponse((r) => r.url().includes("/like") && r.ok());
  await card.getByTestId("like-button").click();
  await expect(card.getByTestId("like-count")).toHaveText("1");
  await liked; // the like is persisted before reloading
  // The Discussion tab is kept in the URL, so a reload lands back on it.
  await expect(page).toHaveURL(/[?&]tab=discussion/);
  await page.reload();
  const again = page.getByTestId("post-card").filter({ hasText: body });
  await expect(again.getByTestId("like-button")).toHaveAttribute("aria-pressed", "true");

  // Comment.
  await again.getByTestId("comments-button").click();
  await again.getByTestId("comment-input").fill("Following this one.");
  await again.getByTestId("comment-submit").click();
  await expect(again.getByTestId("comment-list")).toContainText("Following this one.");

  // Too many links is rejected before any rate rule.
  await again.getByTestId("comment-input").fill("see https://a.x https://b.x https://c.x");
  await again.getByTestId("comment-submit").click();
  await expect(again.getByRole("alert")).toContainText("At most 2 links");

  // Visible in the global feed, then deleted by its author.
  await page.goto("/feed");
  await page.getByTestId("tab-all").click();
  const inFeed = page.getByTestId("post-card").filter({ hasText: body });
  await expect(inFeed).toBeVisible();
  await inFeed.getByRole("button", { name: "Delete post" }).click();
  await inFeed.getByRole("button", { name: "Delete post" }).click();
  await expect(page.getByTestId("post-card").filter({ hasText: body })).toHaveCount(0);
});

test("Following tab shows followed creators and seeded posts render", async ({ page }) => {
  await page.goto("/feed");
  await page.getByTestId("tab-all").click();
  await expect(page.getByTestId("post-card").first()).toBeVisible();
  await expect(page.getByTestId("feed-list")).toContainText("@alice");

  await connectDevWallet(page);
  const res = await page.request.get("/api/leaderboard?board=creators");
  const { rows } = (await res.json()) as { rows: { wallet: string; handle: string | null }[] };
  const alice = rows.find((r) => r.handle === "alice")?.wallet as string;
  await page.goto(`/u/${alice}`);
  await page.getByTestId("follow").click();
  await expect(page.getByTestId("follow")).toHaveText("Following");
  await page.goto("/feed");
  await page.getByTestId("tab-following").click();
  await expect(page.getByTestId("feed-list")).toContainText("@alice", { timeout: 30_000 });
});

test("share an index to the feed as a card, in a chosen style", async ({ page }) => {
  await page.goto("/home");
  await connectDevWallet(page);
  await page.goto(await firstIndexHref(page, "MEGA"));
  await page.getByTestId("join-amount").fill("15");
  await page.getByTestId("join-submit").click();
  await expectRun(page, /Joined MEGA/);

  await page.getByRole("button", { name: "Share" }).click();
  await page.getByTestId("share-to-feed").click();
  await expect(page).toHaveURL(/\/feed\?share=/);
  const preview = page.getByTestId("share-preview");
  await expect(preview.getByTestId("index-card")).toHaveAttribute("data-variant", "mark");
  await page.getByTestId("card-variant-chart").click();
  await expect(preview.getByTestId("index-card")).toHaveAttribute("data-variant", "chart");
  await expect(preview).toContainText("Steady Megacaps");
  await expect(preview).toContainText("SPYx drawdown");

  const body = `Card share ${Date.now()}`;
  await expect
    .poll(
      async () => {
        await page.getByTestId("post-input").fill(body);
        await page.getByTestId("post-submit").click();
        await page.waitForTimeout(1500);
        const err = page.getByTestId("post-error");
        return (await err.count()) ? ((await err.textContent()) ?? "") : "";
      },
      { timeout: 60_000, intervals: [3_000] },
    )
    .not.toContain("Join or create an index first");
  await page.getByTestId("tab-all").click();
  const post = page.getByTestId("post-card").filter({ hasText: body });
  await expect(post.getByTestId("index-card")).toHaveAttribute("data-variant", "chart");
  await expect(post.getByTestId("index-card")).toContainText("MEGA");
});

test("home shows top creator cards", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByTestId("creator-card").first()).toBeVisible();
  await expect(page.getByTestId("creator-card").first()).toContainText("AUM");
});
