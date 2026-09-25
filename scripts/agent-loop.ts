/**
 * bun run agent:loop -- [--once] [--dry-run] [--index <symbol|address>]... [--interval <s>] [--register <name>]
 *
 * Autonomous index manager (D044): every AGENT_LOOP_INTERVAL seconds it connects to the
 * Stockbreak MCP server (Streamable HTTP), hands its tools to an LLM through an
 * OpenAI-compatible chat completions API with tool calling, and lets the model read,
 * rebalance / propose updates within the mandate and explain each decision with agent_post.
 * The MCP server signs with its AGENT_KEYPAIR_PATH; the vault program enforces the mandate.
 * --dry-run refuses every write tool client-side and logs what the agent would do.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

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
const MAX_TOOL_CALLS = 12;
const MAX_LLM_TURNS = 16;
const LLM_TIMEOUT_MS = 120_000;
const TOOL_TIMEOUT_MS = 180_000;
const RESULT_CHARS = 6_000;

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

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
interface ToolRes {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

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

const resultText = (r: ToolRes) =>
  (r.content ?? [])
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();

/** JSON payload after the human summary line (tool result convention in apps/mcp). */
function resultData<T>(r: ToolRes): T | null {
  const t = resultText(r);
  const i = t.indexOf("\n\n");
  try {
    return i >= 0 ? (JSON.parse(t.slice(i + 2)) as T) : null;
  } catch {
    return null;
  }
}

/** Human-in-the-loop and funding/identity tools are not handed to the autonomous model. */
const HIDDEN = new Set(["agent_create_index", "agent_join", "agent_register", "get_intent_status"]);
const isWrite = (name: string) =>
  name.startsWith("build_") || (name.startsWith("agent_") && name !== "agent_info");
const exposed = (t: McpTool) => !t.name.startsWith("build_") && !HIDDEN.has(t.name);

// ---------------- LLM (OpenAI-compatible) ----------------

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
interface Completion {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  error?: { message?: string };
}

async function chat(
  messages: Msg[],
  tools: McpTool[],
): Promise<Extract<Msg, { role: "assistant" }>> {
  const body = JSON.stringify({
    model: MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 1_500,
    tool_choice: "auto",
    tools: tools.map((t) => {
      const { $schema: _drop, ...parameters } = t.inputSchema;
      return {
        type: "function",
        function: { name: t.name, description: t.description ?? t.name, parameters },
      };
    }),
  });
  for (let attempt = 1; ; attempt++) {
    if (stop.signal.aborted) throw new Error("stopped");
    let r: Response;
    try {
      r = await fetch(`${LLM_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${LLM_KEY}`,
          "X-Title": "Stockbreak agent loop",
        },
        body,
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(LLM_TIMEOUT_MS)]),
      });
    } catch (e) {
      if (stop.signal.aborted || attempt >= 3) throw new Error(`LLM request failed: ${errMsg(e)}`);
      log(`LLM request failed (${errMsg(e)}), retrying (${attempt}/3)`);
      await sleep(2_000 * 2 ** attempt);
      continue;
    }
    if (r.status === 429 || r.status >= 500) {
      if (attempt >= 4) throw new Error(`LLM HTTP ${r.status} after ${attempt} attempts`);
      const after = Number(r.headers.get("retry-after"));
      const wait = after > 0 ? Math.min(after * 1000, 120_000) : 5_000 * 2 ** (attempt - 1);
      log(`LLM HTTP ${r.status}; backing off ${Math.round(wait / 1000)} s (${attempt}/4)`);
      await sleep(wait);
      continue;
    }
    const j = (await r.json().catch(() => null)) as Completion | null;
    if (!r.ok || !j) throw new Error(`LLM HTTP ${r.status}: ${clip(j?.error?.message ?? "", 300)}`);
    const m = j.choices?.[0]?.message;
    if (!m)
      throw new Error(`LLM returned no message${j.error?.message ? `: ${j.error.message}` : ""}`);
    return { role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls };
  }
}

function errMsg(e: unknown): string {
  return redact(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "error";
}

// ---------------- prompt ----------------

function systemPrompt(): string {
  return `You are an autonomous index manager agent for Stockbreak, a platform of tokenized stock indexes on Solana (localnet/devnet). Every asset and price is SIMULATED.

Each cycle:
1. Read the indexes you created or manage (agent_info lists them), using get_index and simulate_rebalance. get_feed shows the discussion on an index.
2. Decide whether to act, strictly within each index's mandate:
   - agent_rebalance when simulate_rebalance says a rebalance is allowed and useful (drift above the threshold).
   - agent_propose_update only for indexes you created, and only with a clear reason (e.g. a holding converted at an IPO, a weight far off its intent). Keep weight changes small (a few percentage points).
3. ALWAYS explain every rebalance or proposed update with one agent_post attached to the index (index = its symbol or address, cardVariant "chart"): what changed, why (numbers), what comes next. At most 500 characters, factual, no hype, no promises of returns, no financial advice; mention that prices are simulated.
4. If nothing needs doing, do not post (at most one short status per index per day). End the cycle with a one-paragraph summary of your decisions.

Rules: be conservative; never move more than $${MAX_USDC} (MCP_MAX_USDC_PER_ACTION) in one action; never retry a rejected action in the same cycle with bigger amounts; at most ${MAX_TOOL_CALLS} tool calls per cycle.${dryRun ? "\nDRY RUN: write tools are not executed; call them anyway to show what you would do, then summarize." : ""}`;
}

// ---------------- cycle ----------------

/** Index key → day of the last status-only post (client-side "one status per day" rule). */
const statusPosts = new Map<string, string>();

interface AgentInfo {
  address: string;
  cluster: string;
  registered: boolean;
  agentName: string | null;
  balances: { sol: number | null; usdc: number | null };
  created: { address: string; symbol: string }[];
  manages: { address: string; symbol: string }[];
}

/** One review cycle; returns false when it could not complete (the loop retries next cycle). */
async function cycle(): Promise<boolean> {
  let client: Client | null = null;
  try {
    try {
      client = await connect();
    } catch (e) {
      log(`cannot reach the MCP server at ${MCP_URL}: ${errMsg(e)}`);
      return false;
    }
    const mcp = client;
    const { tools } = (await mcp.listTools()) as { tools: McpTool[] };
    if (!tools.some((t) => t.name === "agent_info")) {
      log(
        `the MCP server at ${MCP_URL} lists no agent_* tools. Agent wallet mode is off: set AGENT_KEYPAIR_PATH (e.g. .keys/agent.json) in the MCP server's env and restart it. For a remote MCP that gates agent tools (MCP_AGENT_TOKEN on the server), set AGENT_MCP_TOKEN here to the same value, or to a per-user agent API key (sbk_..., created on the web Agents page).`,
      );
      return false;
    }
    const infoRes = (await mcp.callTool({ name: "agent_info", arguments: {} })) as ToolRes;
    if (infoRes.isError) {
      log(`agent_info failed: ${clip(resultText(infoRes), 300)}`);
      return false;
    }
    let info = resultData<AgentInfo>(infoRes);
    if (!info) {
      log("agent_info returned no data");
      return false;
    }
    if (!info.registered && registerName) {
      if (dryRun) log(`[dry-run] would register the agent as "${registerName}"`);
      else {
        const r = (await mcp.callTool({
          name: "agent_register",
          arguments: { name: registerName },
        })) as ToolRes;
        log(`agent_register: ${clip(resultText(r).split("\n")[0] ?? "", 200)}`);
        if (!r.isError) info = { ...info, registered: true, agentName: registerName };
      }
    }
    if (!info.registered)
      log(
        "warning: the agent wallet is not registered, so agent_post will fail. Run once with --register <name> (or call agent_register from an MCP client).",
      );
    const mine = [...info.created, ...info.manages];
    const targets = focus.length ? focus : mine.map((x) => x.symbol);
    log(
      `cycle start: agent ${info.agentName ?? info.address} on ${info.cluster}, ${Number(info.balances.sol ?? 0).toFixed(3)} SOL, $${Number(info.balances.usdc ?? 0).toFixed(2)} USDC; indexes: ${targets.join(", ") || "none"}${dryRun ? " [dry-run]" : ""}`,
    );
    if (!targets.length) {
      log("no indexes created or managed by the agent; nothing to do this cycle.");
      return true;
    }

    const llmTools = tools.filter(exposed);
    const toolNames = new Set(llmTools.map((t) => t.name));
    const messages: Msg[] = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `Cycle at ${new Date().toISOString()}.\nAgent: ${JSON.stringify(info)}\nIndexes to review this cycle: ${targets.join(", ")}.\nReview them and act within the mandate.`,
      },
    ];
    let calls = 0;
    let acted = false;
    for (let turn = 0; turn < MAX_LLM_TURNS && !stop.signal.aborted; turn++) {
      const reply = await chat(messages, calls >= MAX_TOOL_CALLS ? [] : llmTools);
      messages.push(reply);
      const tc = reply.tool_calls ?? [];
      if (!tc.length) {
        log(`decision: ${clip((reply.content ?? "(no summary)").replace(/\s+/g, " "), 800)}`);
        break;
      }
      for (const call of tc) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments
            ? (JSON.parse(call.function.arguments) as typeof args)
            : {};
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Invalid JSON arguments.",
          });
          continue;
        }
        const argStr = clip(JSON.stringify(args), 300);
        const refuse = (why: string) => {
          log(`refused ${name} ${argStr}: ${why}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: `Refused: ${why}` });
        };
        if (++calls > MAX_TOOL_CALLS) {
          refuse(`tool call budget of ${MAX_TOOL_CALLS} per cycle reached; summarize and stop.`);
          continue;
        }
        if (!toolNames.has(name)) {
          refuse("this tool is not available to the autonomous agent.");
          continue;
        }
        const usdAmount = Number(args.amountUsd ?? args.usdc ?? 0);
        if (usdAmount > MAX_USDC) {
          refuse(`amount $${usdAmount} is above the per-action limit of $${MAX_USDC}.`);
          continue;
        }
        if (name === "agent_post" && !acted) {
          const key = `${String(args.index ?? "feed").toLowerCase()}`;
          const day = new Date().toISOString().slice(0, 10);
          if (statusPosts.get(key) === day) {
            refuse("a status post for this index was already made today and nothing changed.");
            continue;
          }
          if (!dryRun) statusPosts.set(key, day);
        }
        if (dryRun && isWrite(name)) {
          log(`[dry-run] would call ${name} ${argStr}`);
          if (name !== "agent_post") acted = true;
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `DRY RUN: ${name} was not executed. Assume it would have succeeded as described by simulate_rebalance.`,
          });
          continue;
        }
        let text: string;
        let isError = false;
        try {
          const r = (await mcp.callTool(
            { name, arguments: args },
            { timeout: TOOL_TIMEOUT_MS },
          )) as ToolRes;
          text = resultText(r);
          isError = !!r.isError;
        } catch (e) {
          text = `MCP error: ${errMsg(e)}`;
          isError = true;
        }
        if (isWrite(name) && !isError && name !== "agent_post") acted = true;
        log(
          `${isWrite(name) ? "ACTION" : "read"} ${name} ${argStr} → ${isError ? "ERROR " : ""}${clip(text.split("\n")[0] ?? "", 240)}`,
        );
        messages.push({ role: "tool", tool_call_id: call.id, content: clip(text, RESULT_CHARS) });
      }
    }
    return true;
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
