/** MCP context: env, chain, db, deployment, optional agent signer, web API client. */
import { type Deployment, type McpEnv, mcpEnvSchema, parseEnv } from "@repo/config";
import { readDeployment } from "@repo/config/node";
import { type Db, getDb } from "@repo/db";
import { createCtx, type SolanaCtx } from "@repo/sdk";
import { loadSigner } from "@repo/sdk/node";
import type { Address, KeyPairSigner } from "@solana/kit";

export interface McpCtx extends SolanaCtx {
  env: McpEnv;
  db: Db;
  /** Present only when AGENT_KEYPAIR_PATH is set (agent wallet mode). */
  agent: KeyPairSigner | null;
  deployment: () => Deployment;
  mintOf: (symbol: string) => Address | undefined;
  symbolOf: (mint: string) => string | undefined;
  /** GET a JSON route of the web app (single source for computed index data). */
  web: <T>(path: string) => Promise<T>;
}

let cached: Promise<McpCtx> | null = null;

export function getCtx(): Promise<McpCtx> {
  cached ??= createCtx_();
  return cached;
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
  const web = async <T>(path: string): Promise<T> => {
    let r: Response;
    try {
      r = await fetch(new URL(path, env.WEB_URL), { signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error(`The Stockbreak web app is not reachable at ${env.WEB_URL}. Is it running?`);
    }
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
    return body as T;
  };
  return {
    ...chain,
    env,
    db: getDb(env.DATABASE_URL),
    agent: env.AGENT_KEYPAIR_PATH ? await loadSigner(env.AGENT_KEYPAIR_PATH) : null,
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
