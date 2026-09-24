/**
 * Mock asset registry (PLAN §7.1). Every asset is simulated; UI labels them "Simulated".
 * `mainnetMint` is only used to READ real prices (Jupiter Price v3, D010).
 */
export type AssetKind = "Stock" | "PreIpo" | "Stable";

export interface AssetDef {
  symbol: string;
  name: string;
  kind: AssetKind;
  decimals: number;
  token2022: boolean;
  scaledUi: boolean;
  /** Mainnet mint of the real tokenized asset (xStocks / PreStocks), read-only price source. */
  mainnetMint?: string;
  /** Real ticker for Finnhub fallback (US stocks only). */
  ticker?: string;
  priceSource: "jupiter" | "fixture";
  /** USD price used when no live source is available. */
  fixturePrice: number;
  /** Pre-IPO only: symbol of the stock minted at the IPO event. */
  ipoTarget?: string;
  /** Created at bootstrap (false = created by the IPO script). */
  bootstrap: boolean;
  benchmark?: boolean;
  /** Rough market cap in $T for the "market-cap-like" weight preset (illustrative). */
  capT?: number;
}

const stock = (
  symbol: string,
  name: string,
  mainnetMint: string | undefined,
  ticker: string,
  fixturePrice: number,
  bootstrap = true,
): AssetDef => ({
  symbol,
  name,
  kind: "Stock",
  decimals: 8,
  token2022: true,
  scaledUi: true,
  mainnetMint,
  ticker,
  priceSource: mainnetMint ? "jupiter" : "fixture",
  fixturePrice,
  bootstrap,
});

const preIpo = (
  symbol: string,
  name: string,
  mainnetMint: string,
  fixturePrice: number,
  ipoTarget: string,
): AssetDef => ({
  symbol,
  name,
  kind: "PreIpo",
  decimals: 8,
  token2022: true,
  scaledUi: false,
  mainnetMint,
  priceSource: "jupiter",
  fixturePrice,
  ipoTarget,
  bootstrap: true,
});

export const ASSETS: readonly AssetDef[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    kind: "Stable",
    decimals: 6,
    token2022: false,
    scaledUi: false,
    priceSource: "fixture",
    fixturePrice: 1,
    bootstrap: true,
  },
  stock("AAPLx", "Apple", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", "AAPL", 337.05),
  stock("NVDAx", "NVIDIA", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", "NVDA", 225.45),
  stock("TSLAx", "Tesla", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "TSLA", 380.23),
  stock("MSFTx", "Microsoft", "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", "MSFT", 500.59),
  stock("GOOGLx", "Alphabet", "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", "GOOGL", 339.35),
  stock("AMZNx", "Amazon", "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", "AMZN", 249.88),
  stock("METAx", "Meta", "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", "META", 748.56),
  {
    ...stock("SPYx", "S&P 500 ETF", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "SPY", 768.23),
    benchmark: true,
  },
  preIpo(
    "SPACEX-pre",
    "SpaceX (pre-IPO)",
    "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    115.23,
    "SPCXx",
  ),
  preIpo(
    "OPENAI-pre",
    "OpenAI (pre-IPO)",
    "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
    1331.01,
    "OPENAIx",
  ),
  preIpo(
    "ANTHRP-pre",
    "Anthropic (pre-IPO)",
    "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    1056.97,
    "ANTHRPx",
  ),
  preIpo(
    "ANDURL-pre",
    "Anduril (pre-IPO)",
    "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
    149.76,
    "ANDURLx",
  ),
  // IPO targets: created by `bun run ipo`, not at bootstrap. Ratio 1:1 by default.
  stock("SPCXx", "SpaceX", "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", "SPCX", 149.25, false),
  stock("OPENAIx", "OpenAI", undefined, "OPENAI", 1331.01, false),
  stock("ANTHRPx", "Anthropic", undefined, "ANTHRP", 1056.97, false),
  stock("ANDURLx", "Anduril", undefined, "ANDURL", 149.76, false),
];

export const BENCHMARK_SYMBOL = "SPYx";
export const USDC_SYMBOL = "USDC";

export function assetBySymbol(symbol: string): AssetDef {
  const a = ASSETS.find((x) => x.symbol === symbol);
  if (!a) throw new Error(`Unknown asset ${symbol}`);
  return a;
}

export function findAsset(symbol: string): AssetDef | undefined {
  return ASSETS.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
}

/** Illustrative market caps ($T) for the weight preset. */
export const CAP_T: Record<string, number> = {
  AAPLx: 3.5,
  NVDAx: 4.5,
  TSLAx: 1.2,
  MSFTx: 3.7,
  GOOGLx: 2.3,
  AMZNx: 2.4,
  METAx: 1.9,
  SPYx: 0.6,
  SPCXx: 0.45,
  "SPACEX-pre": 0.4,
  "OPENAI-pre": 0.5,
  OPENAIx: 0.5,
  "ANTHRP-pre": 0.18,
  ANTHRPx: 0.18,
  "ANDURL-pre": 0.03,
  ANDURLx: 0.03,
  USDC: 0.1,
};
