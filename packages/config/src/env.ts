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
  AGENT_KEYPAIR_PATH: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  FAUCET_SOL_PER_REQUEST: z.coerce.number().positive().default(0.2),
  FAUCET_SOL_DAILY_CAP: z.coerce.number().positive().default(5),
});

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
});

export const mcpEnvSchema = serverEnvSchema.extend({
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(3333),
  MCP_MAX_USDC_PER_ACTION: z.coerce.number().positive().default(1000),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ChainEnv = z.infer<typeof chainEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type McpEnv = z.infer<typeof mcpEnvSchema>;

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
