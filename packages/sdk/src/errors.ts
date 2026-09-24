/**
 * Map program / RPC failures to short human messages (used by web & MCP).
 */
import { INDEX_VAULT, MOCK_MARKET } from "./pda";

const VAULT_MESSAGES: Record<string, string> = {
  InvalidWeights: "Target weights must add up to 100%.",
  FeeTooHigh: "A fee is above the allowed maximum.",
  InvalidSlippage: "Max slippage must be between 0.5% and 5%.",
  TooManyAssets: "An index can hold at most 10 assets.",
  DuplicateAsset: "Each asset can only appear once.",
  Paused: "This index is paused. Redeem is still available.",
  SlippageExceeded: "Prices moved more than your slippage limit. Try again.",
  ZeroShares: "The amount is too small to mint any shares.",
  InitialValueTooSmall: "The first deposit must be at least $1.",
  InitialWeightMismatch: "The first deposit must match the target weights.",
  Unauthorized: "Your wallet is not allowed to do this.",
  CooldownActive: "Rebalance cooldown is still active.",
  TriggerNotMet: "The strategy does not allow a rebalance yet.",
  RebalanceInProgress: "A rebalance is in progress. Try again in a moment.",
  NoTicket: "No rebalance in progress.",
  SameAsset: "Pick two different assets.",
  MissingEndInstruction: "Rebalance transaction is incomplete.",
  InvalidRebalanceTx: "Rebalance transaction contains a disallowed step.",
  NotTopLevel: "This action cannot be called from another program.",
  OracleStale: "Prices are stale. Wait for the next price update and retry.",
  OracleConfidence: "Price confidence is too low right now.",
  InvalidPrice: "An asset has no valid price.",
  InvalidOracle: "Oracle account is invalid.",
  InvalidMarketProgram: "Market program is not trusted.",
  WrongDirection: "That trade would move the index away from its targets.",
  TimelockActive: "The update is still timelocked.",
  NoPendingUpdate: "There is no pending update.",
  AssetStillFunded:
    "An asset that still holds funds cannot be removed. Set its weight to 0 and rebalance first.",
  NotPreIpo: "This asset is not a pre-IPO asset.",
  NoIpoConversion: "No IPO conversion is registered for this asset.",
  ConversionMismatch: "IPO conversion returned an unexpected amount.",
  NotFollowing: "This index does not follow a parent.",
  InvalidParent: "Parent index is invalid.",
  AccountOrderMismatch: "Accounts do not match the index. Refresh and try again.",
  MathOverflow: "Amount is too large.",
  InvalidMetadata: "Name, symbol or URI is invalid.",
  InvalidAssetIndex: "Invalid asset.",
  InsufficientBalance: "The vault does not hold that much of this asset.",
  InvalidManagers: "Up to 3 unique managers are allowed.",
  InvalidConfig: "Invalid configuration value.",
};

const MARKET_MESSAGES: Record<string, string> = {
  FaucetLimitExceeded: "Faucet limit exceeded for one request.",
  OracleStale: "Prices are stale. Wait for the next price update and retry.",
  SlippageExceeded: "Swap output is below your minimum. Try again.",
  InvalidPrice: "An asset has no valid price.",
  ZeroAmount: "Enter an amount greater than zero.",
};

/** Order of the #[error_code] enums (code = 6000 + index). */
const VAULT_ERRORS = Object.keys(VAULT_MESSAGES);
const MARKET_ERRORS = [
  "Unauthorized",
  "InvalidSymbol",
  "InvalidDecimals",
  "InvalidSpread",
  "InvalidPrice",
  "OracleStale",
  "FaucetLimitExceeded",
  "SameMint",
  "SlippageExceeded",
  "MathOverflow",
  "NotMarketMint",
  "InvalidTokenProgram",
  "IpoInactive",
  "InvalidRatio",
  "FeedMismatch",
  "ZeroAmount",
  "InvalidMultiplier",
  "TooManyPrices",
];

export interface ProgramFailure {
  program: "index_vault" | "mock_market" | "other";
  name: string;
  message: string;
}

function collectText(e: unknown, depth = 0): string {
  if (depth > 4 || e == null) return "";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const ctx = (e as Error & { context?: unknown }).context;
    return [
      e.message,
      collectText(ctx, depth + 1),
      collectText((e as Error & { cause?: unknown }).cause, depth + 1),
    ].join("\n");
  }
  if (typeof e === "object") {
    try {
      return JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/** Extract the failing program + Anchor error name from an error or logs. */
export function parseFailure(e: unknown, logs?: readonly string[]): ProgramFailure | null {
  const text = [collectText(e), ...(logs ?? [])].join("\n");
  const named = /Error Code: (\w+)\./.exec(text);
  const failed = /Program (\w+) failed: custom program error: 0x([0-9a-f]+)/i.exec(text);
  const program =
    failed?.[1] === MOCK_MARKET
      ? "mock_market"
      : failed?.[1] === INDEX_VAULT
        ? "index_vault"
        : "other";
  let name = named?.[1];
  if (!name && failed) {
    const code = Number.parseInt(failed[2] as string, 16) - 6000;
    name = (program === "mock_market" ? MARKET_ERRORS : VAULT_ERRORS)[code];
  }
  if (!name) {
    const custom = /"Custom":\s*(\d+)|custom program error: 0x([0-9a-f]+)/i.exec(text);
    if (custom) {
      const code =
        (custom[1] ? Number(custom[1]) : Number.parseInt(custom[2] as string, 16)) - 6000;
      name = VAULT_ERRORS[code];
    }
  }
  if (!name) return null;
  const message =
    (program === "mock_market" ? MARKET_MESSAGES[name] : undefined) ??
    VAULT_MESSAGES[name] ??
    MARKET_MESSAGES[name] ??
    name;
  return { program, name, message };
}

/** One short sentence for toasts / MCP responses. */
/** An error whose message is already written for end users (thrown by SDK pre-checks). */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}

export function humanizeError(e: unknown, logs?: readonly string[]): string {
  if (e instanceof UserFacingError) return e.message;
  const f = parseFailure(e, logs);
  if (f) return f.message;
  const text = collectText(e);
  if (/insufficient (funds|lamports)|0x1\b/i.test(text))
    return "Not enough SOL or tokens to complete this transaction.";
  if (/User rejected|rejected the request/i.test(text))
    return "You rejected the request in your wallet.";
  if (/blockhash not found|block height exceeded/i.test(text))
    return "The transaction expired. Please try again.";
  if (/Too Many Requests|statusCode=429|"statusCode":429/i.test(text))
    return "The network is busy (rate limited). Wait a few seconds and retry.";
  if (/Timeout|timed out|was not confirmed/i.test(text))
    return "The network did not confirm in time. Check your balance before retrying.";
  if (/fetch failed|ECONNREFUSED|Failed to fetch/i.test(text))
    return "Cannot reach the Solana RPC. Is the network running?";
  return "Transaction failed. Please try again.";
}

/**
 * Technical one-line description for logs (worker, scripts): program error name,
 * RPC HTTP status, kit error code/context, or the root cause. API keys are masked.
 * UI code should use humanizeError instead.
 */
export function describeError(e: unknown): string {
  const f = parseFailure(e);
  const mask = (s: string) => s.replace(/([?&](api[-_]?key|key|token)=)[^&\s"']+/gi, "$1***");
  if (f) return `${f.program}::${f.name} — ${f.message}`;
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    if (cur instanceof Error) {
      const ctx = (cur as Error & { context?: Record<string, unknown> }).context;
      const code = ctx?.__code;
      const status = ctx?.statusCode;
      if (status) parts.push(`RPC HTTP ${String(status)}`);
      else if (code !== undefined)
        parts.push(`kit #${String(code)}${ctx?.message ? ` ${String(ctx.message)}` : ""}`);
      else parts.push(cur.message.split("\n")[0] ?? cur.name);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return mask(parts.join(" ← ") || "unknown error");
}
