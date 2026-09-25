/**
 * Env validation (zod). Each app parses only what it needs and fails fast
 * with a readable message.
 */
import * as z from "zod";
import { CLUSTERS } from "./cluster";

const url = z.url();
const cluster = z.enum(CLUSTERS, {
  error: "CLUSTER must be localnet or devnet (mainnet is not allowed)",
});
const secs = (d: number) => z.coerce.number().int().positive().default(d);

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_CLUSTER: cluster.default("localnet"),
  NEXT_PUBLIC_RPC_URL: url.default("http://127.0.0.1:8899"),
  NEXT_PUBLIC_WS_URL: url.default("ws://127.0.0.1:8900"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Stockbreak"),
  /** Public MCP endpoint shown on the Agents page; empty → `${origin}/api/mcp`. */
  NEXT_PUBLIC_MCP_URL: url.optional(),
});

export const chainEnvSchema = z.object({
  CLUSTER: cluster.default("localnet"),
  RPC_URL: url.default("http://127.0.0.1:8899"),
  WS_URL: url.default("ws://127.0.0.1:8900"),
});

/**
 * Admin secret key as a JSON byte array (the content of `.keys/admin.json`).
 * Alternative to ADMIN_KEYPAIR_PATH for hosts without the repo's `.keys/`
 * (e.g. Vercel, docs/DEPLOY.md). Devnet only; see D038 for the risk.
 */
const keypairJson = z.string().optional();

/**
 * Whether a value is a Solana keypair file's content (JSON array of 64 bytes). Checked
 * where the key is used, not in the env schema: a malformed key must only disable the
 * SOL faucet, never every API route.
 */
export function isKeypairJson(v: string | undefined): boolean {
  if (!v) return false;
  try {
    const a: unknown = JSON.parse(v);
    return (
      Array.isArray(a) &&
      a.length === 64 &&
      a.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    );
  } catch {
    return false;
  }
}

export const serverEnvSchema = chainEnvSchema.extend({
  WEB_URL: url.default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  ADMIN_KEYPAIR_PATH: z.string().default(".keys/admin.json"),
  ADMIN_KEYPAIR_JSON: keypairJson,
  KEEPER_KEYPAIR_PATH: z.string().default(".keys/keeper.json"),
  /** Keeper secret key as a JSON byte array (hosts without `.keys/`, e.g. the Cloudflare cron). */
  KEEPER_KEYPAIR_JSON: keypairJson,
  AGENT_KEYPAIR_PATH: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Agent secret key as a JSON byte array (hosts without `.keys/`); wins over the path. */
  AGENT_KEYPAIR_JSON: keypairJson,
  FAUCET_SOL_PER_REQUEST: z.coerce.number().positive().default(0.2),
  FAUCET_SOL_DAILY_CAP: z.coerce.number().positive().default(5),
  /**
   * Server-only secret that encrypts web-created agent wallets (D045). Optional here and
   * checked (≥32 chars) where used: without it only agent creation / API keys are off.
   */
  AGENT_KEY_SECRET: z.string().optional(),
});

function flagSchema() {
  return z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true");
}
const flag = flagSchema();

export const workerEnvSchema = serverEnvSchema.extend({
  PRICE_MODE: z.enum(["live", "random"]).default("live"),
  JUPITER_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  PYTH_API_KEY: z.string().optional(),
  MAINNET_READ_RPC_URL: url.default("https://api.mainnet-beta.solana.com"),
  PRICE_INTERVAL: secs(15),
  INDEXER_INTERVAL: secs(2),
  RESYNC_INTERVAL: secs(60),
  SNAPSHOT_INTERVAL: secs(60),
  KEEPER_INTERVAL: secs(30),
  FEES_INTERVAL: secs(300),
  FOLLOW_INTERVAL: secs(30),
  GAMIFICATION_INTERVAL: secs(60),
  /**
   * Hosted autopilot (D047). Tick in seconds; AUTOPILOT_ENABLED=false turns the loop off
   * (default on when an LLM key and AGENT_KEY_SECRET exist). LLM settings are read where
   * used (@repo/mcp/autopilot llmConfigFromEnv); empty values fall back to OPENROUTER_*.
   */
  AUTOPILOT_INTERVAL: secs(60),
  AUTOPILOT_ENABLED: z.string().optional(),
  AUTOPILOT_MAX_PER_TICK: z.coerce.number().int().positive().default(3),
  AUTOPILOT_RUN_TIMEOUT: secs(120),
  AUTOPILOT_DRY_RUN: flagSchema(),
  AGENT_LLM_BASE_URL: z.string().optional(),
  AGENT_LLM_API_KEY: z.string().optional(),
  AGENT_LLM_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
});

/**
 * Exposure settings of the MCP HTTP endpoints (standalone server and the web route
 * /api/mcp). Parsed on their own: they never need DATABASE_URL.
 */
export const mcpHttpEnvSchema = z.object({
  /** Standalone server: public mode (bind MCP_HOST, no localhost-only Host check). */
  MCP_PUBLIC: flag,
  MCP_HOST: z.string().min(1).default("127.0.0.1"),
  /** Public mode: allowed Host header hostnames (comma list); empty = any. */
  MCP_ALLOWED_HOSTS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Bearer token that unlocks agent_* tools on a public endpoint (server-only secret). */
  MCP_AGENT_TOKEN: z.string().min(16, "MCP_AGENT_TOKEN must be at least 16 chars").optional(),
  /** Requests per minute per client IP on a public endpoint. */
  MCP_RATE_LIMIT: z.coerce.number().int().positive().default(60),
});

export const mcpEnvSchema = serverEnvSchema.extend({
  ...mcpHttpEnvSchema.shape,
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3333),
  MCP_MAX_USDC_PER_ACTION: z.coerce.number().positive().default(1000),
  /** Base URL the MCP server uses to call the web API (default WEB_URL). */
  MCP_WEB_URL: url.optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ChainEnv = z.infer<typeof chainEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type McpEnv = z.infer<typeof mcpEnvSchema>;
export type McpHttpEnv = z.infer<typeof mcpHttpEnvSchema>;

function blankToUndefined(
  src: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(src)) out[k] = v === "" ? undefined : v;
  return out;
}

/**
 * Public web URL fallback on Vercel: WEB_URL unset → https://$VERCEL_PROJECT_PRODUCTION_URL
 * (Vercel system env). An explicit WEB_URL always wins.
 */
function withHostDefaults(
  src: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (src.WEB_URL || !src.VERCEL_PROJECT_PRODUCTION_URL) return src;
  return { ...src, WEB_URL: `https://${src.VERCEL_PROJECT_PRODUCTION_URL}` };
}

/** Parse env or throw a single readable error listing every problem. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  src: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const res = schema.safeParse(withHostDefaults(blankToUndefined(src)));
  if (!res.success) {
    const lines = res.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return res.data;
}
