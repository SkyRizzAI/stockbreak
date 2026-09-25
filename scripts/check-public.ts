/**
 * bun run check:public -- <https://your-app.example> [--cluster devnet] [--mcp <url>]
 *
 * Smoke test for a public deployment (docs/DEPLOY.md): config, indexes, prices,
 * actions.json, a Blink GET (+CORS preflight), the OG image, the index page and the
 * remote MCP endpoint health (/api/mcp/health).
 * Read-only: sends no transactions. Exit code 0 only when every check passes.
 */
import { argValue } from "./lib/chain";

const S = "check-public";
const positional = process.argv.slice(2).filter((a, i, all) => {
  if (a === "--" || a.startsWith("--")) return false;
  const prev = all[i - 1];
  return !(prev?.startsWith("--") && prev !== "--");
});
const raw = positional[0] || process.env.DEVNET_WEB_URL || process.env.WEB_URL || "";
const expectCluster = argValue("cluster") || "devnet";
const mcpUrl = argValue("mcp");

if (!raw) {
  console.error(`[${S}] usage: bun run check:public -- https://your-app.vercel.app`);
  process.exit(2);
}
const BASE = raw.replace(/\/+$/, "");

type Result = { name: string; ok: boolean; warn?: boolean; detail: string };
const results: Result[] = [];
function pass(name: string, detail = ""): void {
  results.push({ name, ok: true, detail });
}
function fail(name: string, detail: string): void {
  results.push({ name, ok: false, detail });
}
function warn(name: string, detail: string): void {
  results.push({ name, ok: true, warn: true, detail });
}

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

let indexPubkey: string | null = null;

await step("https", async () => {
  const u = new URL(BASE);
  if (u.protocol === "https:") pass("https", u.host);
  else warn("https", `${u.protocol} — wallets and Blink clients need https`);
});

await step("/api/config", async () => {
  const r = await get("/api/config");
  if (!r.ok) return fail("/api/config", `HTTP ${r.status}`);
  const c = (await r.json()) as { cluster: string; ready: boolean; assets: unknown[] };
  if (c.cluster !== expectCluster)
    return fail("/api/config", `cluster=${c.cluster}, expected ${expectCluster}`);
  if (!c.ready)
    return fail(
      "/api/config",
      "ready=false: deployments/<cluster>.json not found on the server (file tracing)",
    );
  if (!c.assets.length) return fail("/api/config", "no assets");
  pass("/api/config", `cluster=${c.cluster}, ${c.assets.length} assets`);
});

await step("/api/indexes", async () => {
  const r = await get("/api/indexes?limit=5");
  if (!r.ok) return fail("/api/indexes", `HTTP ${r.status} (database reachable? DATABASE_URL)`);
  const j = (await r.json()) as { items: { pubkey: string; symbol: string }[]; total: number };
  indexPubkey = j.items[0]?.pubkey ?? null;
  if (!indexPubkey)
    return fail("/api/indexes", "0 indexes: run the worker (bun run worker:devnet) or copy the DB");
  pass("/api/indexes", `${j.total} indexes, first ${j.items[0]?.symbol}`);
});

await step("/api/prices", async () => {
  const r = await get("/api/prices");
  if (!r.ok) return fail("/api/prices", `HTTP ${r.status}`);
  const j = (await r.json()) as unknown[];
  if (!j.length) warn("/api/prices", "no prices yet: is the worker running against the same DB?");
  else pass("/api/prices", `${j.length} prices`);
});

await step("/actions.json", async () => {
  const r = await get("/actions.json");
  if (!r.ok) return fail("/actions.json", `HTTP ${r.status}`);
  const cors = r.headers.get("access-control-allow-origin");
  const j = (await r.json()) as { rules?: { pathPattern: string; apiPath: string }[] };
  if (!j.rules?.some((x) => x.pathPattern === "/i/*"))
    return fail("/actions.json", "rule /i/* missing");
  if (cors !== "*") return fail("/actions.json", `Access-Control-Allow-Origin=${cors}`);
  pass("/actions.json", `${j.rules.length} rule(s), CORS *`);
});

await step("Blink GET", async () => {
  if (!indexPubkey) return fail("Blink GET", "skipped: no index");
  const r = await get(`/api/actions/join/${indexPubkey}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) return fail("Blink GET", `HTTP ${r.status}`);
  const j = (await r.json()) as { icon?: string; title?: string; links?: { actions: unknown[] } };
  const chain = r.headers.get("x-blockchain-ids");
  if (!j.title || !j.links?.actions.length) return fail("Blink GET", "missing title/actions");
  if (!r.headers.get("x-action-version"))
    return fail("Blink GET", "X-Action-Version header missing");
  if (!j.icon?.startsWith(BASE))
    return fail(
      "Blink GET",
      `icon ${j.icon} does not start with ${BASE}: set WEB_URL to the public URL`,
    );
  pass("Blink GET", `"${j.title}", ${j.links.actions.length} actions, ${chain}`);
});

await step("Blink OPTIONS", async () => {
  if (!indexPubkey) return fail("Blink OPTIONS", "skipped: no index");
  const r = await get(`/api/actions/join/${indexPubkey}`, { method: "OPTIONS" });
  const cors = r.headers.get("access-control-allow-origin");
  if (r.status >= 300 || cors !== "*")
    return fail("Blink OPTIONS", `HTTP ${r.status}, CORS ${cors}`);
  pass("Blink OPTIONS", `HTTP ${r.status}, CORS *`);
});

await step("OG image", async () => {
  if (!indexPubkey) return fail("OG image", "skipped: no index");
  const r = await get(`/i/${indexPubkey}/opengraph-image`);
  const type = r.headers.get("content-type") ?? "";
  const size = (await r.arrayBuffer()).byteLength;
  if (!r.ok || !type.startsWith("image/")) return fail("OG image", `HTTP ${r.status}, ${type}`);
  pass("OG image", `${type}, ${Math.round(size / 1024)} KB`);
});

await step("index page", async () => {
  if (!indexPubkey) return fail("index page", "skipped: no index");
  const r = await get(`/i/${indexPubkey}`);
  const html = await r.text();
  if (!r.ok) return fail("index page", `HTTP ${r.status}`);
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!og) return warn("index page", "HTTP 200 but no og:image meta");
  if (!og.startsWith(BASE))
    return fail("index page", `og:image ${og} is not on ${BASE}: set WEB_URL and rebuild/redeploy`);
  pass("index page", "HTTP 200, og:image on the public URL");
});

await step("home page", async () => {
  const r = await get("/");
  if (!r.ok) return fail("home page", `HTTP ${r.status}`);
  pass("home page", "HTTP 200");
});

await step("/api/mcp/health", async () => {
  const r = await get("/api/mcp/health");
  if (!r.ok) return fail("/api/mcp/health", `HTTP ${r.status}`);
  const j = (await r.json()) as { ok?: boolean; cluster?: string; agentTools?: boolean };
  if (!j.ok) return fail("/api/mcp/health", "ok=false");
  if (j.cluster !== expectCluster)
    return fail("/api/mcp/health", `cluster=${j.cluster}, expected ${expectCluster}`);
  pass("/api/mcp/health", `remote MCP at ${BASE}/api/mcp, agentTools=${!!j.agentTools}`);
});

if (mcpUrl) {
  await step("MCP health", async () => {
    const r = await get(new URL("/health", mcpUrl).toString());
    if (!r.ok) return fail("MCP health", `HTTP ${r.status}`);
    pass("MCP health", "ok");
  });
}

for (const r of results) {
  const tag = !r.ok ? "FAIL" : r.warn ? "WARN" : "PASS";
  console.log(`[${S}] ${tag.padEnd(4)} ${r.name.padEnd(14)} ${r.detail}`);
}
if (indexPubkey) {
  const action = encodeURIComponent(`solana-action:${BASE}/api/actions/join/${indexPubkey}`);
  console.log(`[${S}] try the Blink: https://dial.to/?action=${action}&cluster=${expectCluster}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(
  `[${S}] ${failed ? `FAIL (${failed})` : "PASS"} ${results.length - failed}/${results.length}`,
);
process.exit(failed ? 1 : 0);
