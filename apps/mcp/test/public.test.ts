/**
 * Public endpoint gating (no stack needed: tools/list never touches chain or DB).
 * env is set before the first mcpHttpEnv() parse.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";

const TOKEN = "test-token-0123456789abcdef";
const saved = { ...process.env };
process.env.MCP_AGENT_TOKEN = TOKEN;
process.env.MCP_RATE_LIMIT = "1000";
process.env.AGENT_KEYPAIR_JSON = JSON.stringify(Array.from({ length: 64 }, (_, i) => i));
delete process.env.AGENT_KEYPAIR_PATH;

const { createPublicMcpHandler, hasAgentToken, rateLimited } = await import("../src/public");
const { createServer } = await import("../src/server");
const handler = createPublicMcpHandler();
afterAll(async () => {
  await handler.close();
  // Other suites in this process (mcp.test.ts) use the real agent key.
  for (const k of [
    "MCP_AGENT_TOKEN",
    "MCP_RATE_LIMIT",
    "AGENT_KEYPAIR_JSON",
    "AGENT_KEYPAIR_PATH",
    "AGENT_KEY_SECRET",
  ])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

async function namesFrom(fetchFn: (req: Request) => Promise<Response>): Promise<string[]> {
  const client = new Client({ name: "t", version: "1" }, { versionNegotiation: { mode: "auto" } });
  const t = new StreamableHTTPClientTransport(new URL("http://127.0.0.1/mcp"), {
    fetch: (u, i) => fetchFn(new Request(u.toString(), i)),
  });
  await client.connect(t);
  try {
    return (await client.listTools()).tools.map((x) => x.name);
  } finally {
    await client.close();
  }
}

const initialize = (auth: string) =>
  new Request("http://127.0.0.1/api/mcp", {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    }),
  });

async function toolNames(auth?: string): Promise<string[]> {
  const client = new Client({ name: "t", version: "1" }, { versionNegotiation: { mode: "auto" } });
  const t = new StreamableHTTPClientTransport(new URL("http://127.0.0.1/api/mcp"), {
    fetch: (u, i) => {
      const req = new Request(u.toString(), i);
      if (auth) req.headers.set("authorization", auth);
      return handler.fetch(req, "10.0.0.1");
    },
  });
  await client.connect(t);
  try {
    return (await client.listTools()).tools.map((x) => x.name);
  } finally {
    await client.close();
  }
}

describe("public MCP endpoint", () => {
  test("anonymous: read + build tools, no agent_*", async () => {
    const names = await toolNames();
    expect(names).toContain("list_assets");
    expect(names).toContain("build_join");
    expect(names).toContain("simulate_rebalance");
    expect(names.some((n) => n.startsWith("agent_"))).toBe(false);
  });

  test("wrong bearer: no agent_*", async () => {
    const names = await toolNames("Bearer nope");
    expect(names.some((n) => n.startsWith("agent_"))).toBe(false);
  });

  test("correct bearer: agent_* listed", async () => {
    const names = await toolNames(`Bearer ${TOKEN}`);
    expect(names).toContain("agent_info");
  });

  test("token compare", () => {
    const r = (h?: string) =>
      new Request("http://x/", { headers: h ? { authorization: h } : undefined });
    expect(hasAgentToken(r(`Bearer ${TOKEN}`))).toBe(true);
    expect(hasAgentToken(r(`Bearer ${TOKEN}x`))).toBe(false);
    expect(hasAgentToken(r())).toBe(false);
  });

  test("CORS preflight", async () => {
    const res = await handler.fetch(new Request("http://x/api/mcp", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");
  });

  test("rate limit", () => {
    const now = 1_000;
    for (let i = 0; i < 1000; i++) expect(rateLimited("1.2.3.4", now)).toBeNull();
    expect(rateLimited("1.2.3.4", now)).toBe(60);
    expect(rateLimited("1.2.3.4", now + 60_000)).toBeNull();
  });

  test("user API key (sbk_) without AGENT_KEY_SECRET on the server: 503", async () => {
    delete process.env.AGENT_KEY_SECRET;
    const res = await handler.fetch(initialize(`Bearer sbk_${"A".repeat(43)}`), "10.0.0.2");
    expect(res.status).toBe(503);
    const j = (await res.json()) as { error: { message: string } };
    expect(j.error.message).toContain("not configured");
  });

  test("malformed user API key: 401, never downgraded to anonymous", async () => {
    process.env.AGENT_KEY_SECRET = "x".repeat(40);
    const res = await handler.fetch(initialize("Bearer sbk_nope"), "10.0.0.3");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_token");
    const j = (await res.json()) as { error: { message: string } };
    expect(j.error.message).toBe("Invalid or revoked API key");
  });
});

describe("per-request agent signer", () => {
  test("createServer({ agent }) exposes agent_* tools", async () => {
    const agent = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
    const withAgent = createMcpHandler(() => createServer({ agent }));
    const without = createMcpHandler(() => createServer({ agentTools: false }));
    try {
      const a = await namesFrom((r) => withAgent.fetch(r));
      expect(a).toContain("agent_info");
      expect(a).toContain("agent_rebalance");
      const b = await namesFrom((r) => without.fetch(r));
      expect(b.some((n) => n.startsWith("agent_"))).toBe(false);
    } finally {
      await withAgent.close();
      await without.close();
    }
  });
});
