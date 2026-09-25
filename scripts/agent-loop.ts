/**
 * bun run agent:loop -- [--once] [--dry-run] [--index <symbol|address>]... [--interval <s>] [--register <name>]
 *
 * Autonomous index manager (D044): every AGENT_LOOP_INTERVAL seconds it connects to the
 * Stockbreak MCP server (Streamable HTTP), hands its tools to an LLM through an
 * OpenAI-compatible chat completions API with tool calling, and lets the model read,
 * rebalance / propose updates within the mandate and explain each decision with agent_post.
 * The MCP server signs with its AGENT_KEYPAIR_PATH; the vault program enforces the mandate.
 * The cycle (tool allowlist, index scope, limits) lives in @repo/mcp/autopilot (D047), shared
 * with the hosted autopilot worker loop. AGENT_LOOP_STRATEGY = optional owner instructions.
 * --dry-run refuses every write tool client-side and logs what the agent would do.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  createOpenAiChat,
  errText,
  resultData,
  resultText,
  runAutopilotCycle,
} from "@repo/mcp/autopilot";

// ---------------- config ----------------

const ROOT = path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(`--${f}`);
const values = (f: string) =>
  argv.flatMap((a, i) => (a === `--${f}` && argv[i + 1] ? [argv[i + 1] as string] : []));

if (has("help")) {
  console.log(
    "usage: bun run agent:loop -- [--once] [--dry-run] [--index <symbol|address>]... [--interval <seconds>] [--register <name>]",
  );
  process.exit(0);
}

/** Dev convenience: take OPENROUTER_* from .env.test when no LLM key is set (values never printed). */
function loadOpenRouterFallback(): void {
  if (process.env.AGENT_LLM_API_KEY || process.env.OPENROUTER_API_KEY) return;
  const f = path.join(ROOT, ".env.test");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*(OPENROUTER_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m?.[1] || process.env[m[1]]) continue;
    process.env[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
  }
}
loadOpenRouterFallback();

const once = has("once");
const dryRun = has("dry-run");
const focus = values("index");
const registerName = values("register")[0];
const intervalS = Number(values("interval")[0] ?? process.env.AGENT_LOOP_INTERVAL ?? 900);
const MCP_URL = process.env.AGENT_MCP_URL || "http://127.0.0.1:3333/mcp";
const MCP_TOKEN = process.env.AGENT_MCP_TOKEN || "";
const LLM_BASE = (process.env.AGENT_LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(
  /\/+$/,
  "",
);
const LLM_KEY = process.env.AGENT_LLM_API_KEY || process.env.OPENROUTER_API_KEY || "";
const MODEL =
  process.env.AGENT_LLM_MODEL || process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-5";
const MAX_USDC = Number(process.env.MCP_MAX_USDC_PER_ACTION || 1000);

if (!(intervalS >= 30)) {
  console.error("--interval / AGENT_LOOP_INTERVAL must be at least 30 seconds.");
  process.exit(1);
}

// ---------------- logging ----------------

const SECRETS = [LLM_KEY, MCP_TOKEN].filter((s) => s.length >= 8);
function redact(s: string): string {
  let out = s;
  for (const x of SECRETS) out = out.split(x).join("***");
  return out.replace(/(Bearer\s+)[\w.-]+/gi, "$1***");
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] agent-loop: ${redact(msg)}`);
}

// ---------------- stop handling ----------------

const stop = new AbortController();
process.on("SIGINT", () => {
  if (stop.signal.aborted) process.exit(130);
  log("stopping (Ctrl-C again to force)…");
  stop.abort();
});
process.on("SIGTERM", () => stop.abort());

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (stop.signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    stop.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

// ---------------- MCP ----------------

async function connect(): Promise<Client> {
  const client = new Client(
    { name: "stockbreak-agent-loop", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  const headers: Record<string, string> = MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {};
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers } }),
  );
  return client;
}

const errMsg = (e: unknown) => redact(errText(e));

const chat = createOpenAiChat({
  baseUrl: LLM_BASE,
  apiKey: LLM_KEY,
  model: MODEL,
  log,
  title: "Stockbreak agent loop",
  maxBackoffMs: 120_000,
});

// ---------------- cycle ----------------

/** Index key → day of the last status-only post (client-side "one status per day" rule). */
const statusPosts = new Map<string, string>();

/** One review cycle (shared module @repo/mcp/autopilot); false when it could not complete. */
async function cycle(): Promise<boolean> {
  let client: Client | null = null;
  try {
    try {
      client = await connect();
    } catch (e) {
      log(`cannot reach the MCP server at ${MCP_URL}: ${errMsg(e)}`);
      return false;
    }
    const { tools } = await client.listTools();
    if (!tools.some((t) => t.name === "agent_info")) {
      log(
        `the MCP server at ${MCP_URL} lists no agent_* tools. Agent wallet mode is off: set AGENT_KEYPAIR_PATH (e.g. .keys/agent.json) in the MCP server's env and restart it. For a remote MCP that gates agent tools (MCP_AGENT_TOKEN on the server), set AGENT_MCP_TOKEN here to the same value, or to a per-user agent API key (sbk_..., created on the web Agents page).`,
      );
      return false;
    }
    if (registerName) {
      const info = resultData<{ registered: boolean }>(
        await client.callTool({ name: "agent_info", arguments: {} }),
      );
      if (info && !info.registered) {
        if (dryRun) log(`[dry-run] would register the agent as "${registerName}"`);
        else {
          const r = await client.callTool({
            name: "agent_register",
            arguments: { name: registerName },
          });
          log(`agent_register: ${clip(resultText(r).split("\n")[0] ?? "", 200)}`);
        }
      }
    }
    const r = await runAutopilotCycle({
      client,
      chat,
      indexes: focus,
      strategy: process.env.AGENT_LOOP_STRATEGY ?? "",
      dryRun,
      log,
      signal: stop.signal,
      maxUsdcPerAction: MAX_USDC,
      statusPosts,
    });
    log(`cycle ${r.status}: ${r.actions.length} action(s)`);
    return r.status !== "error";
  } catch (e) {
    log(`cycle failed: ${errMsg(e)}`);
    return false;
  } finally {
    await client?.close().catch(() => undefined);
  }
}

// ---------------- main ----------------

if (!LLM_KEY) {
  console.error(
    "Missing LLM API key: set AGENT_LLM_API_KEY (or OPENROUTER_API_KEY) in .env. See .env.example.",
  );
  process.exit(1);
}
log(
  `MCP ${MCP_URL}${MCP_TOKEN ? " (bearer token set)" : ""}; LLM ${LLM_BASE} model ${MODEL}; ${once ? "single cycle" : `every ${intervalS} s`}${dryRun ? "; DRY RUN (no writes)" : ""}`,
);
for (;;) {
  const completed = await cycle();
  if (once || stop.signal.aborted) process.exit(completed ? 0 : 1);
  log(`next cycle in ${intervalS} s`);
  await sleep(intervalS * 1000);
  if (stop.signal.aborted) process.exit(0);
}
