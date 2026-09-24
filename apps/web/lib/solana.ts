"use client";
/** Browser chain context + explorer links. */
import { explorerAddress, explorerTx } from "@repo/config";
import { createCtx, type SolanaCtx } from "@repo/sdk";
import { CLUSTER, RPC_URL, WS_URL } from "./env";

let ctx: SolanaCtx | null = null;
export function chain(): SolanaCtx {
  ctx ??= createCtx(CLUSTER, RPC_URL, WS_URL);
  return ctx;
}

export const txUrl = (sig: string) => explorerTx(CLUSTER, sig, RPC_URL);
export const addrUrl = (a: string) => explorerAddress(CLUSTER, a, RPC_URL);
