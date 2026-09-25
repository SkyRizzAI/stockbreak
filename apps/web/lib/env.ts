/** Public (browser) env, inlined at build time (K10: app name from env only). */
import { CHAIN_ID, parseCluster } from "@repo/config";

export const CLUSTER = parseCluster(process.env.NEXT_PUBLIC_CLUSTER);
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8900";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Stockbreak";
export const WALLET_CHAIN = (process.env.NEXT_PUBLIC_WALLET_CHAIN || CHAIN_ID[CLUSTER]) as
  | "solana:localnet"
  | "solana:devnet";
export const CLUSTER_LABEL = CLUSTER === "devnet" ? "Devnet" : "Localnet";
