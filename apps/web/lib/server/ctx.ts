import "server-only";
import path from "node:path";
/** Server context for route handlers and server components. */
import { type Deployment, parseEnv, type ServerEnv, serverEnvSchema } from "@repo/config";
import { REPO_ROOT, readDeployment } from "@repo/config/node";
import { type Db, getDb } from "@repo/db";
import { createCtx, type SolanaCtx } from "@repo/sdk";
import { loadSigner } from "@repo/sdk/node";
import type { KeyPairSigner } from "@solana/kit";

let envCache: ServerEnv | null = null;
export function serverEnv(): ServerEnv {
  // Route workers may not inherit what next.config loaded; load the monorepo .env here too.
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(path.join(REPO_ROOT, ".env"));
    } catch {
      // no .env: rely on the real environment
    }
  }
  envCache ??= parseEnv(serverEnvSchema);
  return envCache;
}

export function db(): Db {
  return getDb(serverEnv().DATABASE_URL);
}

let chainCache: SolanaCtx | null = null;
export function chain(): SolanaCtx {
  const e = serverEnv();
  chainCache ??= createCtx(e.CLUSTER, e.RPC_URL, e.WS_URL);
  return chainCache;
}

export function deployment(): Deployment | null {
  return readDeployment(serverEnv().CLUSTER);
}

export function requireDeployment(): Deployment {
  const d = deployment();
  if (!d)
    throw new Error(
      "Deployment not found. Run `bun run dev` (localnet) or `bun run deploy:devnet`.",
    );
  return d;
}

let adminCache: Promise<KeyPairSigner> | null = null;
/** Admin keypair (server only): devnet SOL faucet source. */
export function admin(): Promise<KeyPairSigner> {
  adminCache ??= loadSigner(serverEnv().ADMIN_KEYPAIR_PATH);
  return adminCache;
}

export function symbolOf(mint: string): string {
  const d = deployment();
  return (d && Object.entries(d.mints).find(([, m]) => m === mint)?.[0]) ?? mint.slice(0, 4);
}
