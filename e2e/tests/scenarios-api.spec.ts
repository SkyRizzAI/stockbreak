/**
 * A16 scenario matrix, API layer: invalid input, tampering and ordering edge
 * cases must answer with a clear 4xx (never a raw 500) and never change state.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type APIRequestContext, expect, test } from "@playwright/test";

const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
const BOGUS = "11111111111111111111111111111112";

interface IndexLite {
  pubkey: string;
  symbol: string;
  creator: string;
}

async function mag4(request: APIRequestContext): Promise<IndexLite> {
  const { items } = (await (await request.get("/api/indexes?limit=100")).json()) as {
    items: IndexLite[];
  };
  const it = items.find((i) => i.symbol === "MAG4");
  if (!it) throw new Error("seeded MAG4 not found");
  return it;
}

async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const c = new Client({ name: "e2e", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = r.content.map((x) => x.text).join("\n");
    if (r.isError) throw new Error(text);
    const i = text.indexOf("\n\n");
    return JSON.parse(text.slice(i + 2)) as T;
  } finally {
    await c.close();
  }
}

const json = (data: unknown) => ({
  // A Buffer is sent as-is (a string would be JSON-encoded by Playwright).
  data: Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
  headers: { "content-type": "application/json", origin: "http://localhost:3000" },
});

test("list params are sanitized (NaN / negative → defaults)", async ({ request }) => {
  for (const qs of ["limit=abc", "limit=-5", "page=abc", "sort=zzz", "limit=0"]) {
    const r = await request.get(`/api/indexes?${qs}`);
    expect(r.status(), qs).toBe(200);
    const j = (await r.json()) as { items: unknown[]; total: number };
    expect(j.items.length, qs).toBeGreaterThan(0);
  }
  const lb = await request.get("/api/leaderboard?board=zzz&range=zzz");
  const j = (await lb.json()) as { board: string; range: string };
  expect(j.board).toBe("indexes");
  expect(j.range).toBe("7d");
});

test("malformed JSON bodies get 400, not 500", async ({ request }) => {
  const a = await request.post("/api/faucet/sol", json("nope"));
  expect(a.status()).toBe(400);
  expect((await a.json()).error).toBe("Invalid JSON body");
  const b = await request.post(
    "/api/intents/00000000-0000-0000-0000-000000000000/tx",
    json("{not json"),
  );
  expect(b.status()).toBe(400);
});

test("Blink join rejects bad amounts, unknown indexes and unfunded wallets clearly", async ({
  request,
}) => {
  const it = await mag4(request);
  for (const amount of ["0", "-5", "abc", "0.001", "1e12", "Infinity"]) {
    const r = await request.post(`/api/actions/join/${it.pubkey}?amount=${amount}`, {
      data: { account: it.creator },
    });
    expect(r.status(), amount).toBe(400);
    expect((await r.json()).message, amount).toMatch(/between \$1 and/);
  }
  const bogus = await request.post(`/api/actions/join/${BOGUS}?amount=10`, {
    data: { account: it.creator },
  });
  expect(bogus.status()).toBe(404);
  const broke = await request.post(`/api/actions/join/${it.pubkey}?amount=10`, {
    data: { account: BOGUS },
  });
  expect(broke.status()).toBe(400);
  expect((await broke.json()).message).toMatch(/Not enough USDC/);
});

test("Blink chain state cannot be tampered with or reused by another wallet", async ({
  request,
}) => {
  const it = await mag4(request);
  const first = await request.post(`/api/actions/join/${it.pubkey}?amount=10`, {
    data: { account: it.creator },
  });
  expect(first.ok()).toBeTruthy();
  const next = (await first.json()).links?.next?.href as string | undefined;
  expect(next).toBeTruthy();
  const state = new URL(`http://x${next}`).searchParams.get("state") as string;
  const tx = (s: string, account: string, amount = 10) =>
    request.post(`/api/actions/join/${it.pubkey}/tx?amount=${amount}&k=1&n=1&state=${s}`, {
      data: { account },
    });
  // A forged baseline (unsigned) is refused.
  const forged = Buffer.from(JSON.stringify({ baseline: ["0"], legs: [] })).toString("base64url");
  expect((await tx(forged, it.creator)).status()).toBe(400);
  // The real state is bound to its wallet and amount.
  expect((await tx(state, BOGUS)).status()).toBe(400);
  expect((await tx(state, it.creator, 1000)).status()).toBe(400);
  expect((await tx(state, it.creator)).ok()).toBeTruthy();
});

test("intent status cannot be forged: fake signatures never mark it executed", async ({
  request,
}) => {
  const it = await mag4(request);
  const r = await mcp<{ intentId: string }>("build_join", { index: "MAG4", usdc: 5 });
  // Nothing was handed out for signing yet.
  const early = await request.post(`/api/intents/${r.intentId}/status`, json({ signatures: [] }));
  expect(early.status()).toBe(409);
  // Bind the intent to a wallet by building step 0.
  const built = await request.post(`/api/intents/${r.intentId}/tx`, json({ account: it.creator }));
  expect(built.ok(), await built.text()).toBeTruthy();
  // A second tab asking right away is told it is busy (no double swaps).
  const again = await request.post(`/api/intents/${r.intentId}/tx`, json({ account: it.creator }));
  expect(again.status()).toBe(409);
  const fake = "5".repeat(88);
  const forged = await request.post(
    `/api/intents/${r.intentId}/status`,
    json({ signatures: [fake], done: true }),
  );
  expect(forged.ok()).toBeTruthy();
  expect((await forged.json()).accepted).toBe(0);
  const st = (await (await request.get(`/api/intents/${r.intentId}`)).json()) as {
    status: string;
    signatures: string[];
  };
  expect(st.status).not.toBe("executed");
  expect(st.signatures).not.toContain(fake);
  // Another wallet cannot take over a bound intent.
  const other = await request.post(`/api/intents/${r.intentId}/tx`, json({ account: BOGUS }));
  expect(other.status()).toBe(403);
});

test("feed pages walk every item exactly once (keyset cursor)", async ({ request }) => {
  const seen = new Set<string>();
  let cursor = "";
  for (let i = 0; i < 100; i++) {
    // Newest first within a page (activity is capped per page, so pages interleave).
    let last = "9999";
    const r = await request.get(`/api/feed?tab=all&limit=3${cursor ? `&cursor=${cursor}` : ""}`);
    expect(r.ok()).toBeTruthy();
    const page = (await r.json()) as {
      items: { kind: string; id: string | number; ts: string }[];
      next: string | null;
    };
    for (const it of page.items) {
      const key = `${it.kind}:${it.id}`;
      expect(seen.has(key), `duplicate ${key}`).toBeFalsy();
      seen.add(key);
      expect(it.ts <= last, "newest first").toBeTruthy();
      last = it.ts;
    }
    if (!page.next) break;
    cursor = page.next;
  }
  // The same walk in one big page yields the same set.
  const all = (await (await request.get("/api/feed?tab=all&limit=50")).json()) as {
    items: { kind: string; id: string | number }[];
  };
  for (const it of all.items) expect(seen.has(`${it.kind}:${it.id}`)).toBeTruthy();
  expect((await request.get("/api/feed?cursor=zzz")).status()).toBe(400);
  expect((await request.get("/api/posts?cursor=zzz")).status()).toBe(400);
});

test("comments of a missing post are 404; handles are validated", async ({ request }) => {
  expect((await request.get("/api/posts/999999/comments")).status()).toBe(404);
  const it = await mag4(request);
  const bad = await request.post(
    `/api/users/${it.creator}`,
    json({ handle: "A!", bio: null, nonce: "x", signature: "y" }),
  );
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toMatch(/3–20 characters/);
});

test("metadata resolves by index address; bogus lookup tables are refused", async ({ request }) => {
  const it = await mag4(request);
  const m = await request.get(`/api/meta/${it.pubkey}`);
  expect(m.ok()).toBeTruthy();
  expect((await m.json()).symbol).toBe("MAG4");
  const alt = await request.post(
    `/api/indexes/${it.pubkey}/lookup-table`,
    json({ lookupTable: BOGUS }),
  );
  expect(alt.status()).toBe(422);
});
