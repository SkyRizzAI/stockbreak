/** JSON shapes returned by the API routes (bigint → string or number). */

export type AssetKindName = "Stock" | "PreIpo" | "Stable";
export type StrategyModeName = "Manual" | "Threshold" | "Periodic";

export interface AssetRow {
  mint: string;
  symbol: string;
  name: string;
  kind: AssetKindName;
  targetWeightBps: number;
}

export interface IndexSummary {
  pubkey: string;
  name: string;
  symbol: string;
  description: string | null;
  creator: string;
  creatorHandle: string | null;
  creatorIsAgent: boolean;
  parent: string | null;
  parentSymbol: string | null;
  followsParent: boolean;
  hasPreIpo: boolean;
  assets: AssetRow[];
  strategyMode: StrategyModeName;
  mgmtFeeBps: number;
  navUsd: number;
  sharePrice: number;
  ret24h: number | null;
  ret7d: number | null;
  ret30d: number | null;
  retAll: number | null;
  holders: number;
  clones: number;
  createdAt: string;
  spark: number[];
  syntheticHistory: boolean;
  paused: boolean;
}

/** Live PreStocks reference data for one of our pre-IPO assets (read-only mainnet, D037). */
export interface PrestocksRow {
  symbol: string;
  mint: string;
  prestocksSymbol: string;
  url: string;
  tokenPrice: number;
  markPrice: number | null;
  impliedValuation: number | null;
  markValuation: number | null;
  supply: number | null;
  /** tokenPrice / markPrice - 1 (null without a mark). */
  premium: number | null;
}
export interface PrestocksResponse {
  available: boolean;
  source: string;
  fetchedAt: string | null;
  rows: PrestocksRow[];
}

export interface AssetPrice {
  symbol: string;
  name: string;
  kind: AssetKindName;
  mint: string;
  price: number;
  change24h: number | null;
  source: string;
  benchmark: boolean;
}

export interface LiveAsset {
  mint: string;
  symbol: string;
  name: string;
  kind: AssetKindName;
  tokenProgram: string;
  oracle: string;
  decimals: number;
  balance: string;
  targetWeightBps: number;
  weightBps: number;
  valueUsd: number;
  priceUsd: number;
  multiplier: number;
}

export interface PendingUpdateJson {
  eta: number;
  assets: { mint: string; symbol: string; targetWeightBps: number }[] | null;
  fees: { mgmtFeeBps: number; entryFeeBps: number; exitFeeBps: number } | null;
  strategy: StrategyJson | null;
}

export interface StrategyJson {
  mode: StrategyModeName;
  driftThresholdBps: number;
  periodSecs: number;
  maxSlippageBps: number;
  cooldownSecs: number;
  allowKeeper: boolean;
}

export interface IndexDetail extends IndexSummary {
  thesis: string | null;
  uri: string;
  shareMint: string;
  indexId: string;
  lookupTable: string | null;
  managers: { wallet: string; handle: string | null; isAgent: boolean }[];
  live: LiveAsset[];
  navLiveUsd: number;
  sharePriceLive: number;
  supply: string;
  effectiveSupply: string;
  driftSumBps: number;
  driftMaxBps: number;
  fees: {
    mgmtFeeBps: number;
    entryFeeBps: number;
    exitFeeBps: number;
    platformFeeBps: number;
    cloneRoyaltyBps: number;
  };
  owed: { creator: string; platform: string; parent: string };
  strategy: StrategyJson;
  pending: PendingUpdateJson | null;
  lastRebalanceTs: number;
  lastFeeTs: number;
  chainNow: number;
  timelockSecs: number;
  children: { pubkey: string; name: string; symbol: string; followsParent: boolean }[];
  ipoEvents: { oldSymbol: string; newSymbol: string; ts: string }[];
  platformTreasury: string;
}

export interface SeriesPoint {
  t: number;
  index: number;
  benchmark: number | null;
  synthetic: boolean;
}

export interface ActivityItem {
  signature: string;
  type: string;
  ts: string;
  wallet: string | null;
  handle: string | null;
  index: string | null;
  indexSymbol: string | null;
  summary: string;
}

export interface Holder {
  wallet: string;
  handle: string | null;
  shares: number;
  pct: number;
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

export interface Profile {
  wallet: string;
  handle: string | null;
  bio: string | null;
  isAgent: boolean;
  agentName: string | null;
  xp: number;
  level: number;
  nextLevelXp: number;
  badges: { badge: string; awardedAt: string }[];
  followers: number;
  following: number;
  isFollowing: boolean;
  created: IndexSummary[];
  positions: PositionRow[];
  createdAt: string | null;
}

export interface PositionRow {
  index: string;
  name: string;
  symbol: string;
  shares: number;
  valueUsd: number;
  costUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
  sharePrice: number;
  ret7d: number | null;
}

export interface Portfolio {
  wallet: string;
  totalUsd: number;
  costUsd: number;
  pnlUsd: number;
  positions: PositionRow[];
  created: (IndexSummary & {
    owedCreatorShares: number;
    owedCreatorUsd: number;
    claimedShares: number;
    /** Fees keep accruing (fee > 0 and a funded vault): claiming accrues first. */
    accruing: boolean;
  })[];
  parentRoyalties: {
    index: string;
    symbol: string;
    parent: string;
    owedShares: number;
    owedUsd: number;
    accruing: boolean;
  }[];
}

// ---------------- social feed (D033) ----------------

export interface AuthorInfo {
  wallet: string;
  handle: string | null;
  isAgent: boolean;
  /** An AI agent's display name, when it has no handle. */
  name?: string | null;
}

export interface IndexRef {
  pubkey: string;
  symbol: string;
  name: string;
  /** Holdings' symbols by weight, for the feed's logo stack. */
  assets?: string[];
}

/** Index card looks for sharing (D035). */
export const CARD_VARIANTS = ["mark", "tokens", "chart"] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

export interface PostItem {
  kind: "post";
  id: number;
  ts: string;
  author: AuthorInfo;
  /** The attached index, with what its card needs. */
  index: IndexSummary | null;
  cardVariant: CardVariant | null;
  body: string;
  likes: number;
  comments: number;
  liked: boolean;
}

export interface ActivityFeedItem {
  kind: "activity";
  id: string;
  ts: string;
  author: AuthorInfo | null;
  index: IndexRef | null;
  type: string;
  summary: string;
}

export type FeedItem = PostItem | ActivityFeedItem;

export interface FeedPage {
  items: FeedItem[];
  /** Pass as `before` to load older items; null when exhausted. */
  next: string | null;
}

export interface CommentItem {
  id: number;
  ts: string;
  author: AuthorInfo;
  body: string;
}

export interface Benchmark {
  symbol: string;
  spark: number[];
  ret30d: number | null;
}
