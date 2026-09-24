/**
 * bun run seed [-- --cluster devnet --light] [--social-only]
 * Demo data (PLAN §7.9): 3 demo wallets + 1 agent, 7 varied indexes (pre-IPO,
 * clone, follow, agent-managed, big AUM), joins, an agent rebalance, profiles,
 * social follows and 30 days of synthetic history (synthetic = true).
 * Idempotent: existing indexes (by creator + symbol) are reused.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { ASSETS, BENCHMARK_SYMBOL } from "@repo/config";
import { readDeployment } from "@repo/config/node";
import {
  allIndexes,
  BENCHMARK_INDEX,
  closeDb,
  createComment,
  createPost,
  getDb,
  insertPrices,
  insertSnapshots,
  listPosts,
  registerAgent,
  setFollow,
  setIndexMeta,
  setLike,
  setLookupTable,
  updateUser,
  upsertIndex,
} from "@repo/db";
import {
  createIndexFlow,
  ensureSol,
  faucetIxs,
  fetchAllIndexes,
  fetchIndex,
  market,
  marketPda,
  nextIndexId,
  planRebalance,
  rebalanceIxs,
  sendTx,
  setManagersIx,
  toJson,
  valueIndex,
  vault,
  zapIn,
} from "@repo/sdk";
import { loadSigner } from "@repo/sdk/node";
import { type Address, type KeyPairSigner, lamports } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { argValue, chainCtx } from "./lib/chain";
import { log, run } from "./lib/proc";
import { KEYS_DIR, ROOT } from "./lib/toolchain";

const S = "seed";
const light = process.argv.includes("--light");
const socialOnly = process.argv.includes("--social-only");
const c = await chainCtx();
const d0 = readDeployment(c.cluster);
if (!d0)
  throw new Error(
    `deployments/${c.cluster}.json missing — run bun run dev (localnet) or deploy:devnet first`,
  );
const d = d0;
const symbolOf = (m: string) =>
  Object.entries(d.mints).find(([, v]) => v === m)?.[0] ?? m.slice(0, 4);
const dbUrl =
  c.cluster === "devnet"
    ? (() => {
        const u = new URL(
          process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5434/app",
        );
        u.pathname = "/app_devnet";
        return u.toString();
      })()
    : process.env.DATABASE_URL;
const db = getDb(dbUrl);
const mint = (s: string) => {
  const m = d.mints[s];
  if (!m) throw new Error(`mint ${s} missing`);
  return m as Address;
};
const USDC = mint("USDC");
const $ = (usd: number) => BigInt(Math.round(usd * 1e6));

async function demoKey(name: string): Promise<KeyPairSigner> {
  const file = path.join(KEYS_DIR, `demo-${name}.json`);
  if (!existsSync(file))
    await run(["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "-o", file], {
      capture: true,
    });
  return loadSigner(file);
}

async function fund(w: KeyPairSigner, sol: number): Promise<void> {
  if (c.cluster === "localnet") return ensureSol(c, w.address, sol);
  const { value } = await c.rpc.getBalance(w.address).send();
  const want = BigInt(Math.round(sol * 1e9));
  if (value >= want / 2n) return;
  await sendTx(c, c.admin, [
    getTransferSolInstruction({
      source: c.admin,
      destination: w.address,
      amount: lamports(want - value),
    }),
  ]);
}

async function usdc(w: KeyPairSigner, amount: number): Promise<void> {
  const max = c.cluster === "devnet" ? 10_000 : 1_000_000;
  let left = amount;
  while (left > 0) {
    const n = Math.min(left, max);
    await sendTx(c, w, await faucetIxs(w, USDC, $(n)));
    left -= n;
  }
}

interface Spec {
  who: KeyPairSigner;
  name: string;
  symbol: string;
  assets: [string, number][];
  strategy: Partial<vault.StrategyArgs> & { mode: vault.StrategyMode };
  mgmt: number;
  entry?: number;
  exit?: number;
  parent?: string;
  follows?: boolean;
  deposit: number;
  description: string;
  thesis: string;
}

const strategy = (s: Spec["strategy"]): vault.StrategyArgs => ({
  mode: s.mode,
  driftThresholdBps: s.driftThresholdBps ?? 500,
  periodSecs: s.periodSecs ?? 0,
  maxSlippageBps: s.maxSlippageBps ?? 100,
  cooldownSecs: s.cooldownSecs ?? 60,
  allowKeeper: s.allowKeeper ?? true,
});

async function ensureIndex(sp: Spec, created: Map<string, Address>): Promise<Address> {
  const existing = (await fetchAllIndexes(c)).find(
    (x) => x.data.creator === sp.who.address && x.data.symbol === sp.symbol,
  );
  let index = existing?.address as Address | undefined;
  let lookupTable: Address | null = null;
  if (!index) {
    const parent = sp.parent ? created.get(sp.parent) : undefined;
    const r = await createIndexFlow(c, {
      creator: sp.who,
      indexId: await nextIndexId(c, sp.who.address),
      name: sp.name,
      symbol: sp.symbol,
      uri: `${process.env.WEB_URL || "http://localhost:3000"}/api/meta/${sp.symbol}`,
      assets: sp.assets.map(([s, w]) => ({ mint: mint(s), weightBps: w })),
      fees: { mgmtFeeBps: sp.mgmt, entryFeeBps: sp.entry ?? 0, exitFeeBps: sp.exit ?? 0 },
      strategy: strategy(sp.strategy),
      parent: parent ?? null,
      followsParent: sp.follows ?? false,
    });
    index = r.index;
    lookupTable = r.lookupTable;
    log(S, `created ${sp.symbol} ${index}${lookupTable ? ` (ALT ${lookupTable})` : ""}`);
  }
  created.set(sp.symbol, index);
  const st = await fetchIndex(c, index);
  await upsertIndex(db, {
    pubkey: index,
    creator: st.creator,
    indexId: st.indexId,
    shareMint: st.shareMint,
    name: st.name,
    symbol: st.symbol,
    uri: st.uri,
    parent: st.parent.__option === "Some" ? st.parent.value : null,
    followsParent: st.followsParent,
    assets: st.assets.map((a) => ({
      mint: a.mint,
      symbol: symbolOf(a.mint),
      tokenProgram: a.tokenProgram,
      oracle: a.oracle,
      targetWeightBps: a.targetWeightBps,
      kind: ["Stock", "PreIpo", "Stable"][a.kind] ?? "Stock",
      decimals: a.decimals,
      balance: a.balance.toString(),
    })),
    fees: toJson(st.fees),
    strategy: {
      ...(toJson(st.strategy) as object),
      mode: ["Manual", "Threshold", "Periodic"][st.strategy.mode],
    },
    managers: st.managers.filter((m) => m !== "11111111111111111111111111111111"),
    paused: st.paused,
    createdAt: new Date(Number(st.createdAt) * 1000),
    lookupTable,
  });
  if (lookupTable) await setLookupTable(db, index, lookupTable);
  await setIndexMeta(db, index, { description: sp.description, thesis: sp.thesis });
  const val = await valueIndex(c, st);
  if (val.effectiveSupply === 0n) {
    await zapIn(c, sp.who, index, USDC, $(sp.deposit), { lookupTable });
    log(S, `${sp.symbol} seeded with $${sp.deposit.toLocaleString()}`);
  }
  return index;
}

async function join(who: KeyPairSigner, index: Address, usd: number): Promise<void> {
  const row = await db.query.indexes.findFirst({ where: (t, { eq }) => eq(t.pubkey, index) });
  await zapIn(c, who, index, USDC, $(usd), {
    lookupTable: (row?.lookupTable as Address | null) ?? null,
  });
}

/** Deterministic PRNG so repeated seeds produce the same history. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** 30 daily synthetic points ending one day before now, walking back from `endValue`. */
function backfill(
  seed: string,
  endValue: number,
  drift: number,
  vol: number,
): { ts: Date; v: number }[] {
  const r = rng(seed);
  const out: { ts: Date; v: number }[] = [];
  const day = 86_400_000;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  let v = endValue;
  for (let i = 1; i <= 30; i++) {
    const shock = (r() + r() + r() - 1.5) * vol;
    v = v / (1 + drift + shock);
    out.push({ ts: new Date(start.getTime() - i * day), v });
  }
  return out.reverse();
}

async function syntheticHistory(created: Map<string, Address>): Promise<void> {
  for (const [symbol, index] of created) {
    const st = await fetchIndex(c, index);
    const v = await valueIndex(c, st);
    if (v.effectiveSupply === 0n) continue;
    const sp = Number(v.sharePrice);
    const perf =
      {
        MAG4: 0.0035,
        AIFR: 0.004,
        MEGA: 0.0012,
        MAGT: 0.003,
        MAGM: 0.0033,
        ATLS: 0.0045,
        DFSP: 0.0025,
      }[symbol] ?? 0.002;
    const rows = backfill(`idx:${symbol}`, sp, perf, 0.018).map((p) => ({
      index,
      ts: p.ts,
      navMicroUsd: BigInt(Math.round((p.v * Number(v.effectiveSupply)) / 1e6)),
      supply: v.effectiveSupply,
      sharePriceMicroUsd: BigInt(Math.round(p.v)),
      weights: v.assets.map((a) => ({
        mint: a.entry.mint,
        weightBps: a.targetBps,
        targetBps: a.targetBps,
      })),
      synthetic: true,
    }));
    await insertSnapshots(db, rows);
  }
  // Benchmark + asset price history.
  const feeds = await market.fetchAllMaybeOracleFeed(c.rpc, Object.values(d.feeds) as Address[]);
  const bySymbol = new Map(Object.keys(d.feeds).map((s, i) => [s, feeds[i]]));
  for (const a of ASSETS) {
    const f = bySymbol.get(a.symbol);
    if (!f?.exists) continue;
    const usd = Number(f.data.price) * 10 ** f.data.expo;
    const hist = backfill(
      `px:${a.symbol}`,
      usd,
      a.symbol === "USDC" ? 0 : 0.0015,
      a.symbol === "USDC" ? 0 : 0.015,
    );
    await insertPrices(
      db,
      hist.map((p) => ({
        symbol: a.symbol,
        ts: p.ts,
        priceMicroUsd: BigInt(Math.round(p.v * 1e6)),
        source: "synthetic",
        synthetic: true,
      })),
    );
    if (a.symbol === BENCHMARK_SYMBOL) {
      await insertSnapshots(
        db,
        hist.map((p) => {
          const m = BigInt(Math.round(p.v * 1e6));
          return {
            index: BENCHMARK_INDEX,
            ts: p.ts,
            navMicroUsd: m,
            supply: 1_000_000n,
            sharePriceMicroUsd: m,
            weights: [],
            synthetic: true,
          };
        }),
      );
    }
  }
}

/** Demo posts, comments and likes for the feed (D033). Idempotent. */
async function seedSocial(
  w: { alice: string; bob: string; carol: string; agent: string },
  bySymbol: Map<string, string>,
): Promise<void> {
  if ((await listPosts(db, { author: w.alice }, null, 1)).length) return;
  const at = (s: string) => bySymbol.get(s) ?? null;
  const a = await createPost(db, {
    author: w.alice,
    index: at("MAG4"),
    cardVariant: at("MAG4") ? "mark" : null,
    body: "MAG4 thesis: megacap leaders plus a 10% SpaceX pre-IPO sleeve. The vault converts the sleeve 1:1 at the listing, so holders keep their exposure without doing anything.",
  });
  const g = await createPost(db, {
    author: w.agent,
    index: at("ATLS"),
    cardVariant: at("ATLS") ? "chart" : null,
    body: "Atlas here (AI). I rebalance ATLS only when max drift passes the mandate threshold, and the vault rejects any swap that moves weights away from target. Ask me for the current plan over MCP.",
  });
  await createPost(db, {
    author: w.bob,
    index: at("MEGA"),
    cardVariant: at("MEGA") ? "tokens" : null,
    body: "Joined MAG4 and MEGA this week. One deposit, one position, and the rebalancing happens in the vault instead of me juggling five swaps.",
  });
  if (at("MAGT"))
    await createPost(db, {
      author: w.carol,
      index: at("MAGT"),
      body: "MAGT is my tilt of MAG4: more NVDAx, less TSLAx. Clone royalties go back to @alice.",
    });
  await createComment(db, {
    postId: a.id,
    author: w.bob,
    body: "Does the keeper also trade the pre-IPO sleeve?",
  });
  await createComment(db, {
    postId: a.id,
    author: w.alice,
    body: "No. Keepers never trade pre-IPO tokens; only the creator or a manager can.",
  });
  await setLike(db, a.id, w.bob, true);
  await setLike(db, a.id, w.carol, true);
  await setLike(db, g.id, w.alice, true);
  log(S, "social: demo posts, comments and likes");
}

async function main(): Promise<void> {
  const alice = await demoKey("alice");
  const bob = await demoKey("bob");
  const carol = await demoKey("carol");
  const agent = await loadSigner(process.env.AGENT_KEYPAIR_PATH || ".keys/agent.json");
  const who = {
    alice: alice.address,
    bob: bob.address,
    carol: carol.address,
    agent: agent.address,
  };
  if (socialOnly) {
    const mine = new Set<string>(Object.values(who));
    const bySymbol = new Map(
      (await allIndexes(db)).filter((r) => mine.has(r.creator)).map((r) => [r.symbol, r.pubkey]),
    );
    return seedSocial(who, bySymbol);
  }
  const scale = light ? 0.05 : 1;
  const sol = c.cluster === "devnet" ? 0.25 : 20;
  for (const w of [alice, bob, carol, agent]) await fund(w, sol);
  const need = { alice: 260_000, bob: 110_000, carol: 150_000, agent: 60_000 };
  for (const [w, n] of [
    [alice, need.alice],
    [bob, need.bob],
    [carol, need.carol],
    [agent, need.agent],
  ] as const)
    await usdc(w, Math.ceil(n * scale));

  await updateUser(db, alice.address, { handle: "alice", bio: "Long-term tech allocator." });
  await updateUser(db, bob.address, { handle: "bob", bio: "Boring megacaps, low fees." });
  await updateUser(db, carol.address, { handle: "carol", bio: "Remixes good ideas." });
  await registerAgent(db, agent.address, "Atlas (demo agent)");
  await updateUser(db, agent.address, {
    handle: "atlas",
    bio: "Autonomous rebalancing agent via MCP.",
  });

  const T = vault.StrategyMode.Threshold;
  const specs: Spec[] = [
    {
      who: alice,
      name: "Magnificent Four",
      symbol: "MAG4",
      deposit: 150_000,
      mgmt: 500,
      entry: 50,
      assets: [
        ["AAPLx", 4000],
        ["NVDAx", 3000],
        ["TSLAx", 2000],
        ["SPACEX-pre", 1000],
      ],
      strategy: { mode: T, driftThresholdBps: 500, cooldownSecs: 30 },
      description: "Three megacap leaders plus a SpaceX pre-IPO sleeve.",
      thesis:
        "Concentrated exposure to category leaders; the pre-IPO sleeve converts to stock at the listing event.",
    },
    {
      who: alice,
      name: "AI Frontier",
      symbol: "AIFR",
      deposit: 80_000,
      mgmt: 200,
      assets: [
        ["NVDAx", 3000],
        ["MSFTx", 2500],
        ["GOOGLx", 2000],
        ["OPENAI-pre", 1500],
        ["ANTHRP-pre", 1000],
      ],
      strategy: { mode: vault.StrategyMode.Periodic, periodSecs: 7 * 86_400, cooldownSecs: 60 },
      description: "Picks and shovels plus the two leading private labs.",
      thesis: "Compute, platforms and frontier model makers. Rebalanced weekly.",
    },
    {
      who: bob,
      name: "Steady Megacaps",
      symbol: "MEGA",
      deposit: 60_000,
      mgmt: 100,
      assets: [
        ["AAPLx", 2000],
        ["MSFTx", 2000],
        ["GOOGLx", 2000],
        ["AMZNx", 2000],
        ["METAx", 2000],
      ],
      strategy: { mode: T, driftThresholdBps: 300 },
      description: "Equal-weight five megacaps.",
      thesis: "Low-cost, equal-weight core holding.",
    },
    {
      who: carol,
      name: "Mag Four Tilt",
      symbol: "MAGT",
      deposit: 120_000,
      mgmt: 300,
      parent: "MAG4",
      assets: [
        ["AAPLx", 3000],
        ["NVDAx", 4000],
        ["TSLAx", 2000],
        ["SPACEX-pre", 1000],
      ],
      strategy: { mode: T, driftThresholdBps: 500 },
      description: "Clone of Magnificent Four with more NVIDIA.",
      thesis: "Same idea, heavier on compute.",
    },
    {
      who: carol,
      name: "Mag Four Mirror",
      symbol: "MAGM",
      deposit: 20_000,
      mgmt: 100,
      parent: "MAG4",
      follows: true,
      assets: [
        ["AAPLx", 4000],
        ["NVDAx", 3000],
        ["TSLAx", 2000],
        ["SPACEX-pre", 1000],
      ],
      strategy: { mode: T, driftThresholdBps: 500 },
      description: "Follows Magnificent Four automatically.",
      thesis: "Copy the parent's weights; my own vault.",
    },
    {
      who: agent,
      name: "Atlas Momentum",
      symbol: "ATLS",
      deposit: 50_000,
      mgmt: 150,
      assets: [
        ["NVDAx", 3500],
        ["METAx", 2500],
        ["AMZNx", 2000],
        ["TSLAx", 2000],
      ],
      strategy: { mode: T, driftThresholdBps: 400 },
      description: "Managed by an AI agent over MCP.",
      thesis:
        "Agent tilts toward momentum within the mandate; the program enforces slippage and direction.",
    },
    {
      who: bob,
      name: "Defense & Space",
      symbol: "DFSP",
      deposit: 30_000,
      mgmt: 200,
      assets: [
        ["SPACEX-pre", 4000],
        ["ANDURL-pre", 3000],
        ["TSLAx", 3000],
      ],
      strategy: { mode: vault.StrategyMode.Manual, allowKeeper: false },
      description: "Private defense and space names plus Tesla.",
      thesis: "Pre-IPO heavy; manual rebalancing only.",
    },
  ];
  const selected = light ? specs.filter((s) => ["MAG4", "MEGA", "ATLS"].includes(s.symbol)) : specs;
  const created = new Map<string, Address>();
  for (const sp of selected)
    await ensureIndex({ ...sp, deposit: Math.max(50, Math.round(sp.deposit * scale)) }, created);

  // Joins from other users.
  const joins: [KeyPairSigner, string, number][] = [
    [bob, "MAG4", 5_000],
    [carol, "AIFR", 3_000],
    [alice, "ATLS", 2_000],
    [agent, "MEGA", 1_000],
    [bob, "ATLS", 1_500],
  ];
  for (const [who, sym, usd] of joins) {
    const idx = created.get(sym);
    if (!idx) continue;
    await join(who, idx, Math.max(20, Math.round(usd * scale)));
  }
  log(S, "joins done");

  // Agent as manager of AIFR (ai_manager badge) and a manager rebalance on ATLS.
  const aifr = created.get("AIFR");
  if (aifr) await sendTx(c, alice, [await setManagersIx(alice, aifr, [agent.address])]);
  const atls = created.get("ATLS");
  if (atls) {
    const st = await fetchIndex(c, atls);
    const spread = (await market.fetchMarket(c.rpc, await marketPda())).data.spreadBps;
    const v = await valueIndex(c, st);
    const plan = planRebalance(st, v, {
      keeper: false,
      now: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
      spreadBps: spread,
    });
    if (plan?.triggered && plan.amountOut > 0n) {
      try {
        await sendTx(c, agent, await rebalanceIxs(agent, atls, st, plan), {
          computeUnitLimit: 800_000,
        });
        log(S, "agent rebalanced ATLS");
      } catch (e) {
        log(S, `agent rebalance skipped: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
  }

  await setFollow(db, bob.address, alice.address, true);
  await setFollow(db, carol.address, alice.address, true);
  await setFollow(db, alice.address, agent.address, true);
  await seedSocial(who, new Map([...created].map(([k, v]) => [k, v as string])));

  if (!light) await syntheticHistory(created);
  log(
    S,
    `done: ${created.size} indexes. Demo keys in ${path.relative(ROOT, KEYS_DIR)}/demo-*.json`,
  );
  void argValue;
}

await main();
await closeDb(dbUrl);
process.exit(0);
