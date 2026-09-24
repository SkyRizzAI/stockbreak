/** Shared chain context for scripts: cluster, RPC, project keypairs. */
import { type Cluster, parseCluster } from "@repo/config";
import { createCtx, type SolanaCtx, wsFromRpc } from "@repo/sdk";
import { loadSigner } from "@repo/sdk/node";
import { address, type KeyPairSigner, lamports } from "@solana/kit";

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=").slice(1).join("=");
}

export function clusterFromArgs(): Cluster {
  return parseCluster(argValue("cluster") ?? process.env.CLUSTER);
}

export function rpcUrlFor(cluster: Cluster): { rpcUrl: string; wsUrl: string } {
  if (cluster === "devnet") {
    const rpcUrl = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
    return { rpcUrl, wsUrl: wsFromRpc(rpcUrl) };
  }
  return {
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8899",
    wsUrl: process.env.WS_URL || "ws://127.0.0.1:8900",
  };
}

export interface ChainCtx extends SolanaCtx {
  admin: KeyPairSigner;
  keeper: KeyPairSigner;
  agent: KeyPairSigner;
}

export async function chainCtx(cluster = clusterFromArgs()): Promise<ChainCtx> {
  const { rpcUrl, wsUrl } = rpcUrlFor(cluster);
  const ctx = createCtx(cluster, rpcUrl, wsUrl);
  const admin = await loadSigner(process.env.ADMIN_KEYPAIR_PATH || ".keys/admin.json");
  const keeper = await loadSigner(process.env.KEEPER_KEYPAIR_PATH || ".keys/keeper.json");
  const agent = await loadSigner(process.env.AGENT_KEYPAIR_PATH || ".keys/agent.json");
  return { ...ctx, admin, keeper, agent };
}

export async function accountExists(ctx: SolanaCtx, addr: string): Promise<boolean> {
  const { value } = await ctx.rpc.getAccountInfo(address(addr), { encoding: "base64" }).send();
  return value !== null;
}

export async function balanceSol(ctx: SolanaCtx, addr: string): Promise<number> {
  const { value } = await ctx.rpc.getBalance(address(addr)).send();
  return Number(value) / 1e9;
}

/** Localnet only: top up to `minSol`. */
export async function ensureSol(ctx: SolanaCtx, addr: string, minSol: number): Promise<void> {
  if (ctx.cluster !== "localnet") return;
  const bal = await balanceSol(ctx, addr);
  if (bal >= minSol) return;
  await ctx.rpc
    .requestAirdrop(address(addr), lamports(BigInt(Math.ceil((minSol - bal + 1) * 1e9))))
    .send();
  for (let i = 0; i < 40; i++) {
    if ((await balanceSol(ctx, addr)) >= minSol) return;
    await Bun.sleep(250);
  }
  throw new Error(`airdrop to ${addr} did not land`);
}

export async function waitForRpc(rpcUrl: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      const j = (await r.json()) as { result?: string };
      if (j.result === "ok") return;
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`RPC ${rpcUrl} not healthy after ${timeoutMs}ms`);
}

/** USD float → oracle integer with expo -8. */
export function toOraclePrice(usd: number): bigint {
  return BigInt(Math.round(usd * 1e8));
}
