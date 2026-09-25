/**
 * Agent console API (D045): a signed-in wallet creates its own agent + API key and
 * the remote MCP (/api/mcp) acts as that agent for `Authorization: Bearer sbk_...`.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type APIRequestContext, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A throwaway wallet signs the one-time sign-in nonce; the request context keeps the cookie. */
async function signIn(request: APIRequestContext): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x ?? "";
  const wallet = base58(new Uint8Array(Buffer.from(x, "base64url")));
  const n = await request.get(`/api/auth/nonce?wallet=${wallet}&purpose=sign-in`);
  expect(n.ok()).toBeTruthy();
  const { nonce, message } = (await n.json()) as { nonce: string; message: string };
  const signature = sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
  const s = await request.post("/api/auth/session", { data: { wallet, nonce, signature } });
  expect(s.ok()).toBeTruthy();
  return wallet;
}

type Res = { content: { text: string }[]; isError?: boolean };

async function withMcp<T>(key: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(
    { name: "e2e-keys", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  await c.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

const initialize = (key: string) => ({
  headers: {
    Authorization: `Bearer ${key}`,
    Accept: "application/json, text/event-stream",
  },
  data: {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    },
  },
});

test("agent console routes need a session and a same-site origin", async ({ request }) => {
  expect((await request.get("/api/me/agents")).status()).toBe(401);
  expect((await request.post("/api/me/agents", { data: { name: "x" } })).status()).toBe(401);
  const cross = await request.post("/api/me/agents", {
    data: { name: "x" },
    headers: { origin: "https://evil.example" },
  });
  expect(cross.status()).toBe(403);
});

test("create agent + key, MCP acts as that agent, revoke → 401", async ({ request }) => {
  const owner = await signIn(request);

  // Validation
  expect((await request.post("/api/me/agents", { data: { name: "   " } })).status()).toBe(400);

  const created = await request.post("/api/me/agents", { data: { name: "E2E Agent" } });
  test.skip(created.status() === 503, "AGENT_KEY_SECRET not set for this stack");
  expect(created.ok()).toBeTruthy();
  const agent = (await created.json()) as { wallet: string; name: string };
  expect(agent.name).toBe("E2E Agent");
  expect(agent.wallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  expect(agent.wallet).not.toBe(owner);

  // Only the owner can mint keys for it.
  const k = await request.post(`/api/me/agents/${agent.wallet}/keys`, {
    data: { name: "laptop" },
  });
  expect(k.ok()).toBeTruthy();
  expect(k.headers()["cache-control"]).toContain("no-store");
  const key = (await k.json()) as { id: number; key: string; prefix: string };
  expect(key.key).toMatch(/^sbk_[A-Za-z0-9_-]{43}$/);
  expect(key.prefix).toBe(key.key.slice(0, 12));

  // Listing shows metadata only: never the raw key or its hash.
  const list = await request.get("/api/me/agents");
  expect(list.ok()).toBeTruthy();
  const listText = await list.text();
  expect(listText).not.toContain(key.key);
  expect(listText).not.toContain("hash");
  expect(listText).not.toContain("secret");
  const body = JSON.parse(listText) as {
    agents: { wallet: string; keys: { id: number; prefix: string; revokedAt: string | null }[] }[];
  };
  const mine = body.agents.find((a) => a.wallet === agent.wallet);
  expect(mine?.keys.map((x) => x.id)).toContain(key.id);
  expect(mine?.keys[0]?.prefix).toBe(key.prefix);

  // The agent is a public AI agent profile.
  const pub = (await (await request.get("/api/agents")).json()) as { wallet: string }[];
  expect(pub.map((a) => a.wallet)).toContain(agent.wallet);

  // Remote MCP with the key: agent_* tools, acting as the new agent wallet.
  await withMcp(key.key, async (c) => {
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toContain("agent_info");
    const r = (await c.callTool({ name: "agent_info", arguments: {} })) as Res;
    expect(r.isError ?? false).toBe(false);
    const text = r.content.map((x) => x.text).join("\n");
    expect(text).toContain(agent.wallet);
    expect(text).not.toContain(key.key);
  });

  // Revoke (cross-site blocked, then by the owner) → the key no longer works.
  const cross = await request.delete(`/api/me/keys/${key.id}`, {
    headers: { origin: "https://evil.example" },
  });
  expect(cross.status()).toBe(403);
  const del = await request.delete(`/api/me/keys/${key.id}`);
  expect(del.ok()).toBeTruthy();
  expect(await del.json()).toEqual({ ok: true });
  const after = await request.post(`${BASE}/api/mcp`, initialize(key.key));
  expect(after.status()).toBe(401);
  expect(((await after.json()) as { error: { message: string } }).error.message).toBe(
    "Invalid or revoked API key",
  );
  const listed = (await (await request.get("/api/me/agents")).json()) as typeof body;
  const revoked = listed.agents
    .find((a) => a.wallet === agent.wallet)
    ?.keys.find((x) => x.id === key.id);
  expect(revoked?.revokedAt).toBeTruthy();
});

test("another wallet cannot use or revoke someone else's agent", async ({ playwright }) => {
  const a = await playwright.request.newContext({ baseURL: BASE });
  const b = await playwright.request.newContext({ baseURL: BASE });
  try {
    await signIn(a);
    const created = await a.post("/api/me/agents", { data: { name: "Owner A" } });
    test.skip(created.status() === 503, "AGENT_KEY_SECRET not set for this stack");
    const agent = (await created.json()) as { wallet: string };
    const k = (await (
      await a.post(`/api/me/agents/${agent.wallet}/keys`, { data: { name: "k" } })
    ).json()) as { id: number };

    await signIn(b);
    const steal = await b.post(`/api/me/agents/${agent.wallet}/keys`, { data: { name: "x" } });
    expect(steal.status()).toBe(404);
    expect((await b.delete(`/api/me/keys/${k.id}`)).status()).toBe(404);
    expect((await b.post(`/api/me/agents/${agent.wallet}/fund`)).status()).toBe(404);
    const bList = (await (await b.get("/api/me/agents")).json()) as { agents: unknown[] };
    expect(bList.agents).toEqual([]);
  } finally {
    await a.dispose();
    await b.dispose();
  }
});
