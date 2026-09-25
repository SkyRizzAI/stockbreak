/** MCP context: env, chain, db, deployment, optional agent signer, web API client. */
import { existsSync } from "node:fs";
import { type Deployment, isKeypairJson, type McpEnv, mcpEnvSchema, parseEnv } from "@repo/config";
import { readDeployment, repoPath } from "@repo/config/node";
import { type Db, getDb } from "@repo/db";
import { createCtx, type SolanaCtx } from "@repo/sdk";
import { loadSigner } from "@repo/sdk/node";
import { type Address, createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

export interface McpCtx extends SolanaCtx {
  env: McpEnv;
  db: Db;
  /** Present only when AGENT_KEYPAIR_JSON / AGENT_KEYPAIR_PATH is set (agent wallet mode). */
  agent: KeyPairSigner | null;
  deployment: () => Deployment;
  mintOf: (symbol: string) => Address | undefined;
  symbolOf: (mint: string) => string | undefined;
  /** GET a JSON route of the web app (single source for computed index data). */
  web: <T>(path: string) => Promise<T>;
}

let cached: Promise<McpCtx> | null = null;

export function getCtx(): Promise<McpCtx> {
  cached ??= createCtx_().catch((e: unknown) => {
    cached = null; // retry on the next call (e.g. env fixed, web app started)
    throw e;
  });
  return cached;
}

/**
 * Whether an agent keypair is configured: a valid AGENT_KEYPAIR_JSON, or
 * AGENT_KEYPAIR_PATH. With `requireFile`, the path must also exist (hosted checks).
 */
export function agentKeyConfigured(requireFile = false): boolean {
  const json = process.env.AGENT_KEYPAIR_JSON;
  if (json) return isKeypairJson(json);
  const p = process.env.AGENT_KEYPAIR_PATH;
  if (!p) return false;
  return !requireFile || existsSync(repoPath(p));
}

async function loadAgent(env: McpEnv): Promise<KeyPairSigner | null> {
  if (env.AGENT_KEYPAIR_JSON) {
    if (!isKeypairJson(env.AGENT_KEYPAIR_JSON))
      throw new Error("AGENT_KEYPAIR_JSON is not a 64-byte keypair array");
    return createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(env.AGENT_KEYPAIR_JSON) as number[]),
    );
  }
  return env.AGENT_KEYPAIR_PATH ? loadSigner(env.AGENT_KEYPAIR_PATH) : null;
}

/**
 * On Cloudflare Workers (/api/mcp served by the web Worker) a Worker can't fetch its own
 * public URL (error 1042): call the web API through OpenNext's self service binding.
 */
function selfFetch(): typeof fetch {
  const self = (
    globalThis as unknown as Record<
      symbol,
      { env?: { WORKER_SELF_REFERENCE?: { fetch: typeof fetch } } } | undefined
    >
  )[Symbol.for("__cloudflare-context__")]?.env?.WORKER_SELF_REFERENCE;
  return self ? self.fetch.bind(self) : fetch;
}

async function createCtx_(): Promise<McpCtx> {
  const env = parseEnv(mcpEnvSchema);
  // PLAN §7.6: never touch any cluster other than localnet/devnet.
  if (env.CLUSTER !== "localnet" && env.CLUSTER !== "devnet")
    throw new Error(`Unsupported cluster ${env.CLUSTER}`);
  const chain = createCtx(env.CLUSTER, env.RPC_URL, env.WS_URL);
  const deployment = (): Deployment => {
    const d = readDeployment(env.CLUSTER);
    if (!d)
      throw new Error(`No deployment for ${env.CLUSTER}. Start the stack first (bun run dev).`);
    return d;
  };
  // Internal base for API calls (MCP_WEB_URL, e.g. the same host when served by the web
  // app); user-facing links (sign URLs, index pages, metadata URIs) always use WEB_URL.
  const webBase = env.MCP_WEB_URL ?? env.WEB_URL;
  const web = async <T>(path: string): Promise<T> => {
    let r: Response;
    try {
      r = await selfFetch()(new URL(path, webBase), { signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error(`The Stockbreak web app is not reachable at ${webBase}. Is it running?`);
    }
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
    return body as T;
  };
  return {
    ...chain,
    env,
    db: getDb(env.DATABASE_URL),
    agent: await loadAgent(env),
    deployment,
    mintOf: (symbol) => {
      const m = deployment().mints;
      const key = Object.keys(m).find((k) => k.toLowerCase() === symbol.toLowerCase());
      return key ? (m[key] as Address) : undefined;
    },
    symbolOf: (mint) => Object.entries(deployment().mints).find(([, m]) => m === mint)?.[0],
    web,
  };
}
