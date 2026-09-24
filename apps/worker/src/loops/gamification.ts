/**
 * XP & badges (PLAN §7.7). Idempotent: every award has a unique (wallet, reason, ref).
 */
import {
  allIndexes,
  awardBadge,
  awardXp,
  BENCHMARK_INDEX,
  eventsOfType,
  getUsers,
  holderCounts,
  snapshotSeries,
} from "@repo/db";
import type { WorkerCtx } from "../ctx";

const DAY = 86_400_000;

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / DAY + 1) / 7)}`;
}

export async function gamificationTick(c: WorkerCtx): Promise<number> {
  const db = c.db;
  const idx = await allIndexes(db);
  const creatorOf = new Map(idx.map((i) => [i.pubkey, i.creator]));
  const xp: { wallet: string; amount: number; reason: string; ref: string }[] = [];
  const badges: { wallet: string; badge: string }[] = [];

  for (const e of await eventsOfType(db, ["IndexCreated"])) {
    const d = e.data as { index: string; creator: string; parent: string | null };
    xp.push({ wallet: d.creator, amount: 50, reason: "create", ref: d.index });
    badges.push({ wallet: d.creator, badge: "first_index" });
    if (d.parent) {
      const parentCreator = creatorOf.get(d.parent);
      if (parentCreator && parentCreator !== d.creator) {
        xp.push({ wallet: parentCreator, amount: 30, reason: "cloned", ref: d.index });
        badges.push({ wallet: parentCreator, badge: "cloned" });
      }
    }
  }
  for (const e of await eventsOfType(db, ["Joined"])) {
    const d = e.data as { index: string; user: string };
    xp.push({ wallet: d.user, amount: 10, reason: "join", ref: d.index });
    badges.push({ wallet: d.user, badge: "first_join" });
    const creator = creatorOf.get(d.index);
    if (creator && creator !== d.user)
      xp.push({ wallet: creator, amount: 20, reason: "joined_by", ref: `${d.index}:${d.user}` });
  }
  const managerEvents = await eventsOfType(db, ["ManagersSet"]);
  const managerWallets = [
    ...new Set(managerEvents.flatMap((e) => (e.data as { managers: string[] }).managers)),
  ];
  const agentUsers = await getUsers(db, managerWallets);
  for (const e of managerEvents) {
    const d = e.data as { index: string; managers: string[] };
    const creator = creatorOf.get(d.index);
    if (creator && d.managers.some((m) => agentUsers.get(m)?.isAgent))
      badges.push({ wallet: creator, badge: "ai_manager" });
  }
  for (const e of await eventsOfType(db, ["IpoMigrated"])) {
    const creator = creatorOf.get((e.data as { index: string }).index);
    if (creator) badges.push({ wallet: creator, badge: "ipo_survivor" });
  }

  // Holding streaks: +5 per full day held, up to 30 days.
  const positions = await db.query.positions.findMany();
  for (const p of positions) {
    if (p.shares <= 0n || p.wallet === p.index) continue;
    const days = Math.min(30, Math.floor((Date.now() - p.firstJoinedAt.getTime()) / DAY));
    for (let d = 1; d <= days; d++)
      xp.push({ wallet: p.wallet, amount: 5, reason: "hold", ref: `${p.index}:${d}` });
  }

  // Holders & beat-SPY (7d, synthetic history counts).
  const holders = await holderCounts(db);
  const since = new Date(Date.now() - 7 * DAY - 3_600_000);
  const bench = await snapshotSeries(db, BENCHMARK_INDEX, since);
  const benchRet =
    bench.length >= 2
      ? Number(bench.at(-1)?.sharePriceMicroUsd) / Number(bench[0]?.sharePriceMicroUsd) - 1
      : null;
  for (const i of idx) {
    if ((holders.get(i.pubkey) ?? 0) >= 10)
      badges.push({ wallet: i.creator, badge: "ten_holders" });
    if (benchRet === null) continue;
    const s = await snapshotSeries(db, i.pubkey, since);
    const first = s[0];
    const last = s.at(-1);
    if (!first || !last || last.ts.getTime() - first.ts.getTime() < 7 * DAY - 3_600_000) continue;
    const ret = Number(last.sharePriceMicroUsd) / Number(first.sharePriceMicroUsd) - 1;
    if (ret > benchRet) {
      xp.push({
        wallet: i.creator,
        amount: 100,
        reason: "beat_spy_7d",
        ref: `${i.pubkey}:${isoWeek(new Date())}`,
      });
      badges.push({ wallet: i.creator, badge: "beat_spy_7d" });
    }
  }

  const added = await awardXp(db, xp);
  let newBadges = 0;
  for (const b of badges) if (await awardBadge(db, b.wallet, b.badge)) newBadges++;
  if (added || newBadges) c.log("gamification", `+${added} xp rows, +${newBadges} badges`);
  return added + newBadges;
}
