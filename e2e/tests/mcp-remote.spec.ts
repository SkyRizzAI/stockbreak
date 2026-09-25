import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";

/** Remote MCP served by the web app (/api/mcp): what Claude.ai / ChatGPT connectors see. */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
type Res = { content: { text: string }[]; isError?: boolean };

async function withClient<T>(
  fn: (c: Client) => Promise<T>,
  headers?: Record<string, string>,
): Promise<T> {
  const c = new Client(
    { name: "e2e-remote", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  await c.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), { requestInit: { headers } }),
  );
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

test("remote MCP health", async ({ request }) => {
  const r = await request.get("/api/mcp/health");
  expect(r.ok()).toBeTruthy();
  const j = (await r.json()) as { ok: boolean; cluster: string; agentTools: boolean };
  expect(j.ok).toBe(true);
  expect(j.cluster).toBeTruthy();
});

test("remote MCP: public tools only, list_indexes works", async () => {
  await withClient(async (c) => {
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names).toContain("build_join");
    expect(names).toContain("list_assets");
    expect(names.filter((n) => n.startsWith("agent_"))).toEqual([]);
    const r = (await c.callTool({ name: "list_indexes", arguments: {} })) as Res;
    expect(r.isError ?? false).toBe(false);
    expect(r.content.map((x) => x.text).join("\n").length).toBeGreaterThan(0);
  });
});

test("remote MCP: CORS preflight", async ({ request }) => {
  const r = await request.fetch("/api/mcp", { method: "OPTIONS" });
  expect(r.status()).toBe(204);
  expect(r.headers()["access-control-allow-origin"]).toBe("*");
});

test("remote MCP: agent_* only with the bearer token", async () => {
  const token = process.env.MCP_AGENT_TOKEN;
  const wrong = await withClient(async (c) => (await c.listTools()).tools.map((t) => t.name), {
    Authorization: "Bearer wrong-token-000000",
  });
  expect(wrong.filter((n) => n.startsWith("agent_"))).toEqual([]);
  test.skip(!token, "MCP_AGENT_TOKEN not set for this stack");
  const names = await withClient(async (c) => (await c.listTools()).tools.map((t) => t.name), {
    Authorization: `Bearer ${token}`,
  });
  expect(names).toContain("agent_info");
});
