import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import { connectDevWallet } from "./helpers";

const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
type Res = { content: { text: string }[]; isError?: boolean };

async function mcp<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; data: T }> {
  const c = new Client({ name: "e2e", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as Res;
    const text = r.content.map((x) => x.text).join("\n");
    if (r.isError) throw new Error(text);
    const i = text.indexOf("\n\n");
    return { text, data: (i >= 0 ? JSON.parse(text.slice(i + 2)) : null) as T };
  } finally {
    await c.close();
  }
}

test("MCP build_join → user signs on /sign → intent executed", async ({ page }) => {
  const { data } = await mcp<{ intentId: string; signUrl: string }>("build_join", {
    index: "MAG4",
    usdc: 25,
  });
  const url = new URL(data.signUrl);
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByTestId("intent-title")).toContainText("Join");
  await connectDevWallet(page);
  await page.getByTestId("intent-sign").click();
  await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
    timeout: 120_000,
  });
  const st = await mcp<{ status: string; signatures: string[] }>("get_intent_status", {
    intentId: data.intentId,
  });
  expect(st.data.status).toBe("executed");
  expect(st.data.signatures.length).toBeGreaterThan(0);
});

test("MCP build_create_index → signed on /sign → index page", async ({ page }) => {
  const sym = `MCP${Date.now() % 10_000}`;
  const { data } = await mcp<{ intentId: string; signUrl: string }>("build_create_index", {
    name: "MCP Chips",
    symbol: sym,
    assets: [
      { symbol: "NVDAx", weightPct: 60 },
      { symbol: "AAPLx", weightPct: 40 },
    ],
    depositUsdc: 20,
  });
  const url = new URL(data.signUrl);
  await page.goto(`${url.pathname}${url.search}`);
  await connectDevWallet(page);
  await page.getByTestId("intent-sign").click();
  await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
    timeout: 120_000,
  });
  const res = await page.request.get(`/api/indexes?q=${sym}`);
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/indexes?q=${sym}`)).json()) as { items: unknown[] })
          .items.length,
      {
        timeout: 30_000,
      },
    )
    .toBe(1);
  expect(res.ok()).toBeTruthy();
});
