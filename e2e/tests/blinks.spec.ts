import { expect, test } from "@playwright/test";
import { firstIndexHref } from "./helpers";

const RPC = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8899";

async function simulate(txBase64: string) {
  // Public devnet RPCs rate-limit: retry a response without a result a few times.
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [txBase64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }],
      }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      result?: { value: { err: unknown; logs: string[] } };
      error?: { message?: string };
    };
    if (j.result) return j.result.value;
    if (i >= 4) throw new Error(`simulateTransaction failed: ${j.error?.message ?? r.status}`);
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
}

test("actions.json maps index pages to the join action", async ({ request }) => {
  const r = await request.get("/actions.json");
  expect(r.ok()).toBeTruthy();
  expect(r.headers()["access-control-allow-origin"]).toBe("*");
  const j = await r.json();
  expect(j.rules[0]).toEqual({ pathPattern: "/i/*", apiPath: "/api/actions/join/*" });
});

test("join Blink: GET metadata and POST a transaction that simulates", async ({ request }) => {
  const path = await (async () => {
    const res = await request.get("/api/indexes?limit=50");
    const { items } = (await res.json()) as {
      items: { pubkey: string; symbol: string; creator: string }[];
    };
    return items.find((i) => i.symbol === "MAG4");
  })();
  expect(path).toBeTruthy();
  const index = path?.pubkey as string;
  const payer = path?.creator as string; // seeded demo wallet with USDC

  const g = await request.get(`/api/actions/join/${index}`);
  expect(g.ok()).toBeTruthy();
  const meta = await g.json();
  expect(meta.type).toBe("action");
  expect(meta.icon).toMatch(/^https?:\/\//);
  expect(meta.links.actions.length).toBeGreaterThanOrEqual(3);

  const p = await request.post(`/api/actions/join/${index}?amount=10`, {
    data: { account: payer },
  });
  expect(p.ok()).toBeTruthy();
  const tx = await p.json();
  expect(typeof tx.transaction).toBe("string");
  const sim = await simulate(tx.transaction);
  expect(sim.err, sim.logs?.join("\n")).toBeNull();

  const bad = await request.post(`/api/actions/join/${index}?amount=10`, {
    data: { account: "nope" },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).message).toBeTruthy();
});

test("index page exposes an OG image", async ({ page, request }) => {
  const href = await firstIndexHref(page, "MAG4");
  const r = await request.get(`${href}/opengraph-image`);
  expect(r.ok()).toBeTruthy();
  expect(r.headers()["content-type"]).toBe("image/png");
});
