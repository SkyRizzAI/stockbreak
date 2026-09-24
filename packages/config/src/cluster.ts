export const CLUSTERS = ["localnet", "devnet"] as const;
export type Cluster = (typeof CLUSTERS)[number];

/** Mainnet is refused everywhere (K1). */
export function parseCluster(value: string | undefined): Cluster {
  const v = (value ?? "localnet").toLowerCase();
  if (v === "localnet" || v === "devnet") return v;
  throw new Error(`Unsupported cluster "${value}". Only localnet and devnet are allowed.`);
}

export const CHAIN_ID: Record<Cluster, `solana:${string}`> = {
  localnet: "solana:localnet",
  devnet: "solana:devnet",
};

/** CAIP-2 ids used by Solana Actions (Blinks). */
export const CAIP2: Record<Cluster, string> = {
  localnet: "solana:localnet",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export function explorerTx(cluster: Cluster, signature: string, rpcUrl?: string): string {
  if (cluster === "devnet") return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  const custom = encodeURIComponent(rpcUrl ?? "http://127.0.0.1:8899");
  return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${custom}`;
}

export function explorerAddress(cluster: Cluster, address: string, rpcUrl?: string): string {
  if (cluster === "devnet") return `https://explorer.solana.com/address/${address}?cluster=devnet`;
  const custom = encodeURIComponent(rpcUrl ?? "http://127.0.0.1:8899");
  return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${custom}`;
}

/** Per-cluster program parameters (D007). */
export const CLUSTER_PARAMS: Record<
  Cluster,
  {
    timelockSecs: number;
    faucetMaxUsdc: bigint;
    oracleMaxAgeSecs: number;
    spreadBps: number;
    platformFeeBps: number;
    cloneRoyaltyBps: number;
  }
> = {
  localnet: {
    timelockSecs: 0,
    faucetMaxUsdc: 1_000_000n * 1_000_000n,
    oracleMaxAgeSecs: 120,
    spreadBps: 30,
    platformFeeBps: 100,
    cloneRoyaltyBps: 1000,
  },
  devnet: {
    timelockSecs: 120,
    faucetMaxUsdc: 10_000n * 1_000_000n,
    oracleMaxAgeSecs: 600,
    spreadBps: 30,
    platformFeeBps: 100,
    cloneRoyaltyBps: 1000,
  },
};
