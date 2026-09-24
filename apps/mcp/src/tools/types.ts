/** Subset of the web API JSON shapes used by MCP tools (see apps/web/lib/types.ts). */
export interface AssetPrice {
  symbol: string;
  name: string;
  kind: string;
  mint: string;
  price: number;
  change24h: number | null;
  source: string;
  benchmark: boolean;
}

export interface ClientConfig {
  cluster: string;
  params: {
    timelockSecs: number;
    spreadBps: number;
    platformFeeBps: number;
    cloneRoyaltyBps: number;
  };
  assets: {
    symbol: string;
    name: string;
    kind: string;
    mint: string;
    listed: boolean;
    benchmark: boolean;
    ipoTarget: string | null;
  }[];
}

export interface IndexSummary {
  pubkey: string;
  name: string;
  symbol: string;
  creator: string;
  creatorHandle: string | null;
  creatorIsAgent: boolean;
  parent: string | null;
  parentSymbol: string | null;
  followsParent: boolean;
  hasPreIpo: boolean;
  assets: { mint: string; symbol: string; kind: string; targetWeightBps: number }[];
  strategyMode: string;
  mgmtFeeBps: number;
  navUsd: number;
  sharePrice: number;
  ret24h: number | null;
  ret7d: number | null;
  ret30d: number | null;
  retAll: number | null;
  holders: number;
  clones: number;
  paused: boolean;
}

export interface IndexDetail extends IndexSummary {
  description: string | null;
  thesis: string | null;
  shareMint: string;
  lookupTable: string | null;
  managers: { wallet: string; handle: string | null; isAgent: boolean }[];
  live: {
    mint: string;
    symbol: string;
    kind: string;
    targetWeightBps: number;
    weightBps: number;
    valueUsd: number;
    priceUsd: number;
  }[];
  navLiveUsd: number;
  sharePriceLive: number;
  driftSumBps: number;
  driftMaxBps: number;
  fees: {
    mgmtFeeBps: number;
    entryFeeBps: number;
    exitFeeBps: number;
    platformFeeBps: number;
    cloneRoyaltyBps: number;
  };
  strategy: {
    mode: string;
    driftThresholdBps: number;
    periodSecs: number;
    maxSlippageBps: number;
    cooldownSecs: number;
    allowKeeper: boolean;
  };
  pending: { eta: number; assets: { symbol: string; targetWeightBps: number }[] | null } | null;
  lastRebalanceTs: number;
  chainNow: number;
  timelockSecs: number;
  children: { pubkey: string; symbol: string; followsParent: boolean }[];
  ipoEvents: { oldSymbol: string; newSymbol: string; ts: string }[];
}

export interface SeriesPoint {
  t: number;
  index: number;
  benchmark: number | null;
  synthetic: boolean;
}

export interface CreatorRow {
  wallet: string;
  handle: string | null;
  isAgent: boolean;
  aumUsd: number;
  feesUsd: number;
  joiners: number;
  clones: number;
  indexes: number;
  bestReturn7d: number | null;
  level: number;
}

export interface Portfolio {
  wallet: string;
  totalUsd: number;
  costUsd: number;
  pnlUsd: number;
  positions: {
    index: string;
    name: string;
    symbol: string;
    shares: number;
    valueUsd: number;
    pnlUsd: number;
    pnlPct: number | null;
  }[];
  created: (IndexSummary & { owedCreatorUsd: number })[];
}
