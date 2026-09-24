/** Worker context: env, chain, signers, db, deployment. */
import { ASSETS, type Deployment, parseEnv, type WorkerEnv, workerEnvSchema } from "@repo/config";
import { readDeployment } from "@repo/config/node";
import { type Db, getDb } from "@repo/db";
import { chainClock, createCtx, type SolanaCtx } from "@repo/sdk";
import { loadSigner } from "@repo/sdk/node";
import type { Address, KeyPairSigner } from "@solana/kit";

export interface WorkerCtx extends SolanaCtx {
  env: WorkerEnv;
  db: Db;
  admin: KeyPairSigner;
  keeper: KeyPairSigner;
  /** Re-read on each call (ipo script adds mints). */
  deployment: () => Deployment;
  symbolOf: (mint: string) => string | undefined;
  log: (scope: string, msg: string) => void;
}

export async function createWorkerCtx(): Promise<WorkerCtx> {
  const env = parseEnv(workerEnvSchema);
  const chain = createCtx(env.CLUSTER, env.RPC_URL, env.WS_URL);
  const deployment = (): Deployment => {
    const d = readDeployment(env.CLUSTER);
    if (!d) throw new Error(`deployments/${env.CLUSTER}.json missing — run bootstrap first`);
    return d;
  };
  const symbolOf = (mint: string) => {
    const d = deployment();
    return Object.entries(d.mints).find(([, m]) => m === mint)?.[0];
  };
  return {
    ...chain,
    env,
    db: getDb(env.DATABASE_URL),
    admin: await loadSigner(env.ADMIN_KEYPAIR_PATH),
    keeper: await loadSigner(env.KEEPER_KEYPAIR_PATH),
    deployment,
    symbolOf,
    log: (scope, msg) => console.log(`${new Date().toISOString().slice(11, 19)} [${scope}] ${msg}`),
  };
}

export function assetMeta(symbol: string | undefined) {
  return ASSETS.find((a) => a.symbol === symbol);
}

export const nowSecs = () => BigInt(Math.floor(Date.now() / 1000));

/** Cluster clock as programs see it (follows `bun run warp`). */
export async function chainNow(c: SolanaCtx): Promise<bigint> {
  return chainClock(c);
}
export type { Address };
