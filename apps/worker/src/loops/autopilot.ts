/**
 * Hosted autopilot (D047): wake agents whose autopilot is due, run one LLM decision
 * cycle each with the same MCP tools acting as that agent (in-process server), and
 * store the run log. Due rows are claimed with row locks, so several workers never run
 * the same agent twice. Never logs the LLM key or agent secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import type { WorkerEnv } from "@repo/config";
import { repoPath } from "@repo/config/node";
import {
  AUTOPILOT_WORKER,
  agentKeySecret,
  type ClaimedRun,
  claimDueAutopilots,
  decryptSecret,
  finishAgentRun,
  getAgentWallet,
  setWorkerStatus,
} from "@repo/db";
import {
  type AutopilotResult,
  type ChatFn,
  createOpenAiChat,
  type LlmConfig,
  llmConfigFromEnv,
  runAgentAutopilot,
} from "@repo/mcp/autopilot";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import type { WorkerCtx } from "../ctx";

/** Pause after the LLM provider kept rate limiting (429). */
export const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

export interface AutopilotAvailability {
  enabled: boolean;
  reason: string | null;
  llm: LlmConfig;
}

/**
 * Whether this worker can run autopilot. `vars` holds the raw LLM variables (worker env
 * plus the dev fallback); the key itself is never part of any message.
 */
export function autopilotAvailability(
  env: Pick<WorkerEnv, "AUTOPILOT_ENABLED" | "AGENT_KEY_SECRET">,
  vars: Record<string, string | undefined>,
): AutopilotAvailability {
  const llm = llmConfigFromEnv(vars);
  const flag = env.AUTOPILOT_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off")
    return { enabled: false, reason: "Autopilot is turned off on this server.", llm };
  if (!agentKeySecret(env.AGENT_KEY_SECRET))
    return {
      enabled: false,
      reason: "Agent wallets are not configured on this server (AGENT_KEY_SECRET).",
      llm,
    };
  if (!llm.apiKey)
    return {
      enabled: false,
      reason: "No LLM API key on the autopilot worker (AGENT_LLM_API_KEY).",
      llm,
    };
  return { enabled: true, reason: null, llm };
}

/** Dev convenience (same as agent:loop): OPENROUTER_* from .env.test when no key is set. */
function devLlmFallback(): Record<string, string> {
  if (process.env.AGENT_LLM_API_KEY || process.env.OPENROUTER_API_KEY || process.env.VERCEL)
    return {};
  const f = repoPath(".env.test");
  if (!existsSync(f)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*(OPENROUTER_(?:API_KEY|MODEL))\s*=\s*(.*)\s*$/);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
  }
  return out;
}

interface State {
  avail: AutopilotAvailability;
  chat: ChatFn | null;
  redact: (s: string) => string;
  cooldownUntil: number;
  /** Per agent: index key → day of its last status-only post. */
  statusPosts: Map<string, Map<string, string>>;
}

let state: State | null = null;

function init(c: WorkerCtx): State {
  const e = c.env;
  const vars = {
    ...devLlmFallback(),
    ...Object.fromEntries(
      Object.entries({
        AGENT_LLM_BASE_URL: e.AGENT_LLM_BASE_URL,
        AGENT_LLM_API_KEY: e.AGENT_LLM_API_KEY,
        AGENT_LLM_MODEL: e.AGENT_LLM_MODEL,
        OPENROUTER_API_KEY: e.OPENROUTER_API_KEY,
        OPENROUTER_MODEL: e.OPENROUTER_MODEL,
      }).filter(([, v]) => !!v),
    ),
  };
  const avail = autopilotAvailability(e, vars);
  const secrets = [avail.llm.apiKey ?? "", e.AGENT_KEY_SECRET ?? ""].filter((s) => s.length >= 8);
  const redact = (s: string) => {
    let out = s;
    for (const x of secrets) out = out.split(x).join("***");
    return out.replace(/(Bearer\s+)[\w.-]+/gi, "$1***");
  };
  const log = (m: string) => c.log("autopilot", redact(m));
  if (avail.enabled)
    log(
      `enabled: model ${avail.llm.model} via ${avail.llm.baseUrl}; up to ${e.AUTOPILOT_MAX_PER_TICK} agents per tick, ${e.AUTOPILOT_RUN_TIMEOUT} s per run${e.AUTOPILOT_DRY_RUN ? "; DRY RUN (no writes)" : ""}`,
    );
  else log(`off: ${avail.reason}`);
  return {
    avail,
    chat: avail.enabled
      ? createOpenAiChat({
          ...avail.llm,
          log,
          title: "Stockbreak autopilot",
          maxBackoffMs: 30_000,
          requestTimeoutMs: 60_000,
        })
      : null,
    redact,
    cooldownUntil: 0,
    statusPosts: new Map(),
  };
}

export async function autopilotTick(c: WorkerCtx): Promise<number> {
  state ??= init(c);
  const s = state;
  const log = (m: string) => c.log("autopilot", s.redact(m));
  await setWorkerStatus(c.db, AUTOPILOT_WORKER, {
    available: s.avail.enabled,
    reason: s.avail.reason,
    model: s.avail.enabled ? s.avail.llm.model : null,
  });
  if (!s.avail.enabled || !s.chat) return 0;
  if (Date.now() < s.cooldownUntil) return 0;
  let ran = 0;
  for (let i = 0; i < c.env.AUTOPILOT_MAX_PER_TICK; i++) {
    const [job] = await claimDueAutopilots(c.db, 1);
    if (!job) break;
    const r = await runOne(c, s, job, log);
    ran++;
    if (r.rateLimited) {
      s.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      log(`LLM rate limited; pausing autopilot for ${RATE_LIMIT_COOLDOWN_MS / 60_000} min`);
      break;
    }
  }
  return ran;
}

async function runOne(
  c: WorkerCtx,
  s: State,
  job: ClaimedRun,
  log: (m: string) => void,
): Promise<AutopilotResult> {
  const tag = `${job.agentWallet.slice(0, 6)}… run #${job.runId}${job.manual ? " (manual)" : ""}`;
  let result: AutopilotResult;
  try {
    result = await execute(c, s, job, (m) => log(`${tag}: ${m}`));
  } catch (e) {
    result = {
      status: "error",
      summary: s.redact(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "error",
      actions: [],
    };
  }
  const safe: AutopilotResult = {
    ...result,
    summary: s.redact(result.summary),
    actions: result.actions.map((a) => ({ ...a, detail: s.redact(a.detail) })),
  };
  await finishAgentRun(c.db, job.runId, safe);
  log(`${tag}: ${safe.status}, ${safe.actions.length} action(s)`);
  return safe;
}

async function execute(
  c: WorkerCtx,
  s: State,
  job: ClaimedRun,
  log: (m: string) => void,
): Promise<AutopilotResult> {
  const secret = agentKeySecret(c.env.AGENT_KEY_SECRET);
  const row = await getAgentWallet(c.db, job.agentWallet);
  if (!row || !secret) return { status: "error", summary: "Agent wallet not found.", actions: [] };
  let seed: Uint8Array;
  try {
    seed = decryptSecret(row.secretEnc, secret);
  } catch {
    return {
      status: "error",
      summary: "This agent's wallet cannot be unlocked on this server.",
      actions: [],
    };
  }
  const agent = await createKeyPairSignerFromPrivateKeyBytes(seed);
  seed.fill(0);
  if (agent.address !== row.wallet)
    return {
      status: "error",
      summary: "This agent's wallet cannot be unlocked on this server.",
      actions: [],
    };
  let posts = s.statusPosts.get(row.wallet);
  if (!posts) {
    posts = new Map();
    s.statusPosts.set(row.wallet, posts);
  }
  const timeoutMs = c.env.AUTOPILOT_RUN_TIMEOUT * 1000;
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Hard timeout: abort the cycle, and stop waiting shortly after even if a call ignores it.
  const hardStop = new Promise<AutopilotResult>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      setTimeout(
        () =>
          resolve({
            status: "error",
            summary: `Timed out after ${c.env.AUTOPILOT_RUN_TIMEOUT} s.`,
            actions: [],
          }),
        5_000,
      );
    }, timeoutMs);
  });
  try {
    const r = await Promise.race([
      runAgentAutopilot({
        agent,
        chat: s.chat as ChatFn,
        strategy: job.strategy,
        indexes: job.indexes,
        dryRun: c.env.AUTOPILOT_DRY_RUN,
        log,
        signal: ac.signal,
        statusPosts: posts,
        maxUsdcPerAction: Number(process.env.MCP_MAX_USDC_PER_ACTION) || 1000,
      }),
      hardStop,
    ]);
    return ac.signal.aborted && r.status === "error"
      ? { ...r, summary: `Timed out after ${c.env.AUTOPILOT_RUN_TIMEOUT} s. ${r.summary}`.trim() }
      : r;
  } finally {
    clearTimeout(timer);
  }
}
