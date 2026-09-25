import type { Cluster } from "@repo/config";
import {
  type Address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createSolanaRpcSubscriptions,
  isSolanaError,
  type Rpc as KitRpc,
  type RpcSubscriptions as KitRpcSubscriptions,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";

export type Rpc = KitRpc<SolanaRpcApi>;
export type RpcSubscriptions = KitRpcSubscriptions<SolanaRpcSubscriptionsApi>;

export interface SolanaCtx {
  cluster: Cluster;
  rpcUrl: string;
  rpc: Rpc;
  rpcSubscriptions: RpcSubscriptions;
}

/** HTTP 429 from a rate-limited RPC (e.g. free Helius plan on devnet). */
function isRateLimited(e: unknown): boolean {
  return (
    isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    (e.context as { statusCode?: number }).statusCode === 429
  );
}

/**
 * Transient failures worth retrying: 5xx gateway errors and network drops (fetch threw,
 * socket closed). Safe for every call we make: reads are idempotent, and resending the
 * same signed transaction yields the same signature (no double spend).
 */
function isTransient(e: unknown): boolean {
  if (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const code = (e.context as { statusCode?: number }).statusCode ?? 0;
    return code === 502 || code === 503 || code === 504;
  }
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /fetch failed|Failed to fetch|NetworkError|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|Unable to connect|network/i.test(
    msg,
  );
}

/** Default transport + retry with jittered exponential backoff on 429 and transient errors. */
function retryingTransport(url: string): ReturnType<typeof createDefaultRpcTransport> {
  const base = createDefaultRpcTransport({ url });
  return (async (req) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await base(req);
      } catch (e) {
        const limited = isRateLimited(e);
        if (!(limited ? attempt < 6 : attempt < 3 && isTransient(e))) throw e;
        const delay = 250 * 2 ** attempt + Math.random() * 250;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }) as ReturnType<typeof createDefaultRpcTransport>;
}

export function createCtx(cluster: Cluster, rpcUrl: string, wsUrl: string): SolanaCtx {
  // Same API as createSolanaRpc(url); the cast narrows the cluster-generic transport type.
  const rpc = createSolanaRpcFromTransport(retryingTransport(rpcUrl)) as unknown as Rpc;
  const rpcSubscriptions: RpcSubscriptions = createSolanaRpcSubscriptions(wsUrl as string);
  return { cluster, rpcUrl, rpc, rpcSubscriptions };
}

/** Derive the websocket URL from an http(s) RPC URL (Helius, localhost, …). */
export function wsFromRpc(rpcUrl: string): string {
  const u = new URL(rpcUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost")
    u.port = String(Number(u.port || 8899) + 1);
  return u.toString();
}

const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111" as Address;

/**
 * Cluster clock as the programs see it (Clock sysvar `unix_timestamp`).
 * Unlike getBlockTime, this follows Surfpool time travel (`bun run warp`).
 */
export async function chainClock(ctx: SolanaCtx): Promise<bigint> {
  try {
    const { value } = await ctx.rpc
      .getAccountInfo(CLOCK_SYSVAR, { encoding: "base64", commitment: "confirmed" })
      .send();
    if (value) {
      // Clock: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64
      // No Buffer: this also runs in the browser (it silently fell back to wall time there).
      const raw = atob(value.data[0]);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new DataView(bytes.buffer).getBigInt64(32, true);
    }
  } catch {
    // fall through
  }
  return BigInt(Math.floor(Date.now() / 1000));
}
