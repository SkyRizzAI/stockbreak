/** Read-only research tools (PLAN §7.6). Data comes from the web API so numbers match the UI. */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { McpCtx } from "../ctx";
import { bps, ok, pct, resolveIndex, safe, usd } from "../util";
import type {
  AssetPrice,
  ClientConfig,
  CreatorRow,
  IndexDetail,
  IndexSummary,
  Portfolio,
  SeriesPoint,
} from "./types";

const RO = { readOnlyHint: true, openWorldHint: false } as const;

export function summarize(i: IndexSummary) {
  return {
    address: i.pubkey,
    name: i.name,
    symbol: i.symbol,
    creator: i.creatorHandle ?? i.creator,
    creatorIsAgent: i.creatorIsAgent,
    navUsd: Math.round(i.navUsd),
    sharePrice: i.sharePrice,
    return24h: pct(i.ret24h),
    return7d: pct(i.ret7d),
    return30d: pct(i.ret30d),
    holders: i.holders,
    strategy: i.strategyMode,
    mgmtFee: bps(i.mgmtFeeBps),
    assets: i.assets.map((a) => `${a.symbol} ${bps(a.targetWeightBps)}`).join(", "),
    ...(i.parent ? { parent: i.parentSymbol, followsParent: i.followsParent } : {}),
    ...(i.paused ? { paused: true } : {}),
  };
}

export function registerReadTools(s: McpServer, ctx: () => Promise<McpCtx>): void {
  s.registerTool(
    "list_assets",
    {
      title: "List assets",
      description:
        "List the tokenized stocks, pre-IPO tokens and USDC that indexes can hold, with current prices. All assets and prices are simulated (localnet/devnet), fed from real market data where available.",
      inputSchema: z.object({}),
      annotations: RO,
    },
    safe(async () => {
      const c = await ctx();
      const [prices, cfg] = await Promise.all([
        c.web<AssetPrice[]>("/api/prices"),
        c.web<ClientConfig>("/api/config"),
      ]);
      const rows = cfg.assets
        .filter((a) => a.listed && !a.benchmark)
        .map((a) => {
          const p = prices.find((x) => x.symbol === a.symbol);
          return {
            symbol: a.symbol,
            name: a.name,
            kind: a.kind,
            priceUsd: p?.price ?? null,
            change24h: pct(p?.change24h),
            priceSource: p?.source ?? null,
            ...(a.ipoTarget ? { becomesOnIpo: a.ipoTarget } : {}),
          };
        });
      return ok(
        `${rows.length} assets on ${cfg.cluster}. Prices are simulated. Pre-IPO tokens migrate to the listed stock on an IPO event.`,
        rows,
      );
    }),
  );

  s.registerTool(
    "list_indexes",
    {
      title: "List indexes",
      description:
        "Search and sort indexes. Returns address, symbol, NAV, returns, holders, strategy and composition for each.",
      inputSchema: z.object({
        query: z.string().max(64).optional().describe("Name, symbol or creator handle"),
        sort: z.enum(["aum", "return", "holders", "newest"]).default("aum"),
        creatorType: z.enum(["all", "human", "ai"]).default("all"),
        hasPreIpo: z.boolean().optional().describe("Only indexes holding pre-IPO tokens"),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      annotations: RO,
    },
    safe(async ({ query, sort, creatorType, hasPreIpo, limit }) => {
      const c = await ctx();
      const qs = new URLSearchParams({ sort, type: creatorType, limit: String(limit) });
      if (query) qs.set("q", query);
      if (hasPreIpo) qs.set("preipo", "1");
      const { items } = await c.web<{ items: IndexSummary[] }>(`/api/indexes?${qs}`);
      return ok(`${items.length} indexes (sorted by ${sort}).`, items.map(summarize));
    }),
  );

  s.registerTool(
    "get_index",
    {
      title: "Get index",
      description:
        "Full detail of one index: live weights vs targets and drift, NAV, share price, fees, strategy (the mandate), managers, pending update, clones and IPO history.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol, e.g. MAG4"),
      }),
      annotations: RO,
    },
    safe(async ({ index }) => {
      const c = await ctx();
      const ref = await resolveIndex(c, index);
      const d = await c.web<IndexDetail>(`/api/indexes/${ref.pubkey}`);
      const cooldownLeft = Math.max(0, d.lastRebalanceTs + d.strategy.cooldownSecs - d.chainNow);
      const data = {
        ...summarize(d),
        description: d.description,
        thesis: d.thesis,
        url: `${c.env.WEB_URL}/i/${d.pubkey}`,
        navUsd: Math.round(d.navLiveUsd),
        sharePrice: d.sharePriceLive,
        assets: d.live.map((a) => ({
          symbol: a.symbol,
          kind: a.kind,
          target: bps(a.targetWeightBps),
          current: bps(a.weightBps),
          drift: bps(a.weightBps - a.targetWeightBps),
          valueUsd: Math.round(a.valueUsd),
          priceUsd: a.priceUsd,
        })),
        drift: { sum: bps(d.driftSumBps), max: bps(d.driftMaxBps) },
        fees: {
          management: `${bps(d.fees.mgmtFeeBps)} / yr`,
          entry: bps(d.fees.entryFeeBps),
          exit: bps(d.fees.exitFeeBps),
          platform: `${bps(d.fees.platformFeeBps)} / yr`,
        },
        mandate: {
          mode: d.strategy.mode,
          driftThreshold: bps(d.strategy.driftThresholdBps),
          periodDays: +(d.strategy.periodSecs / 86_400).toFixed(2),
          maxSlippage: bps(d.strategy.maxSlippageBps),
          cooldownSecs: d.strategy.cooldownSecs,
          cooldownRemainingSecs: cooldownLeft,
          keeperAllowed: d.strategy.allowKeeper,
        },
        creator: d.creator,
        managers: d.managers.map((m) => ({
          wallet: m.wallet,
          handle: m.handle,
          isAgent: m.isAgent,
        })),
        pendingUpdate: d.pending
          ? {
              appliesAfter: new Date(d.pending.eta * 1000).toISOString(),
              assets: d.pending.assets?.map((a) => `${a.symbol} ${bps(a.targetWeightBps)}`),
            }
          : null,
        timelockSecs: d.timelockSecs,
        clones: d.children.map((ch) => ({
          address: ch.pubkey,
          symbol: ch.symbol,
          follows: ch.followsParent,
        })),
        ipoEvents: d.ipoEvents,
      };
      return ok(
        `${d.name} (${d.symbol}): NAV ${usd(d.navLiveUsd)}, share ${d.sharePriceLive.toFixed(4)}, max drift ${bps(d.driftMaxBps)}. Simulated assets.`,
        data,
      );
    }),
  );

  s.registerTool(
    "get_index_performance",
    {
      title: "Index performance",
      description:
        "Share price history of an index versus the SPYx benchmark, with total returns for the range.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        range: z.enum(["1D", "1W", "1M", "ALL"]).default("1M"),
      }),
      annotations: RO,
    },
    safe(async ({ index, range }) => {
      const c = await ctx();
      const ref = await resolveIndex(c, index);
      const series = await c.web<SeriesPoint[]>(
        `/api/indexes/${ref.pubkey}/performance?range=${range}`,
      );
      if (series.length < 2) return ok(`Not enough history for ${ref.symbol} yet.`);
      const first = series[0] as SeriesPoint;
      const last = series.at(-1) as SeriesPoint;
      const benchRet =
        first.benchmark && last.benchmark ? last.benchmark / first.benchmark - 1 : null;
      const step = Math.max(1, Math.ceil(series.length / 40));
      const points = series
        .filter((_, i) => i % step === 0 || i === series.length - 1)
        .map((p) => ({
          t: new Date(p.t).toISOString(),
          sharePrice: +p.index.toFixed(6),
          spyx: p.benchmark,
        }));
      return ok(
        `${ref.symbol} ${range}: ${pct(last.index / first.index - 1)} vs SPYx ${pct(benchRet)}.${series.some((p) => p.synthetic) ? " Includes simulated history." : ""}`,
        points,
      );
    }),
  );

  s.registerTool(
    "get_leaderboard",
    {
      title: "Leaderboard",
      description: "Top indexes by return, or top creators by AUM. Filter humans vs AI agents.",
      inputSchema: z.object({
        board: z.enum(["indexes", "creators"]).default("indexes"),
        range: z.enum(["24h", "7d", "30d", "all"]).default("7d"),
        creatorType: z.enum(["all", "human", "ai"]).default("all"),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      annotations: RO,
    },
    safe(async ({ board, range, creatorType, limit }) => {
      const c = await ctx();
      const qs = new URLSearchParams({ board, range, type: creatorType });
      if (board === "creators") {
        const r = await c.web<{ rows: CreatorRow[] }>(`/api/leaderboard?${qs}`);
        const rows = r.rows.slice(0, limit).map((x, i) => ({
          rank: i + 1,
          wallet: x.wallet,
          handle: x.handle,
          isAgent: x.isAgent,
          aumUsd: Math.round(x.aumUsd),
          feesUsd: +x.feesUsd.toFixed(2),
          joiners: x.joiners,
          clones: x.clones,
          indexes: x.indexes,
          bestReturn7d: pct(x.bestReturn7d),
          level: x.level,
        }));
        return ok(`Top ${rows.length} creators by AUM.`, rows);
      }
      const r = await c.web<{ rows: IndexSummary[]; benchmark: number | null }>(
        `/api/leaderboard?${qs}`,
      );
      const rows = r.rows.slice(0, limit).map((x, i) => ({ rank: i + 1, ...summarize(x) }));
      return ok(
        `Top ${rows.length} indexes by ${range} return. SPYx ${range}: ${pct(r.benchmark)}.`,
        rows,
      );
    }),
  );

  s.registerTool(
    "get_portfolio",
    {
      title: "Portfolio",
      description:
        "Positions, value and PnL of a wallet, plus indexes it created. Defaults to the agent wallet when agent mode is on.",
      inputSchema: z.object({ wallet: z.string().optional().describe("Wallet address") }),
      annotations: RO,
    },
    safe(async ({ wallet }) => {
      const c = await ctx();
      const w = wallet ?? c.agent?.address;
      if (!w) throw new Error("Pass a wallet address (agent wallet mode is off).");
      const p = await c.web<Portfolio>(`/api/portfolio/${w}`);
      return ok(
        `Wallet ${w}: ${usd(p.totalUsd)} across ${p.positions.length} positions, PnL ${usd(p.pnlUsd)}.`,
        {
          positions: p.positions.map((x) => ({
            index: x.index,
            symbol: x.symbol,
            shares: x.shares,
            valueUsd: +x.valueUsd.toFixed(2),
            pnlUsd: +x.pnlUsd.toFixed(2),
            pnlPct: pct(x.pnlPct),
          })),
          created: p.created.map((x) => ({
            ...summarize(x),
            feesOwedUsd: +x.owedCreatorUsd.toFixed(2),
          })),
        },
      );
    }),
  );
}
