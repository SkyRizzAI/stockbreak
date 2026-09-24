import type { Cluster } from "./cluster";

/** Addresses written by bootstrap / ipo scripts to `deployments/{cluster}.json`. */
export interface Deployment {
  cluster: Cluster;
  indexVaultProgram: string;
  mockMarketProgram: string;
  market: string;
  config: string;
  admin: string;
  keeper: string;
  agent?: string;
  platformTreasury: string;
  /** symbol → mint / feed */
  mints: Record<string, string>;
  feeds: Record<string, string>;
  /** Pre-IPO symbol → completed IPO event. */
  ipos: Record<
    string,
    { newSymbol: string; newMint: string; ratioNum: string; ratioDen: string; at: string }
  >;
  updatedAt: string;
}

export const INDEX_VAULT_PROGRAM_ID = "4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me";
export const MOCK_MARKET_PROGRAM_ID = "9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8";
