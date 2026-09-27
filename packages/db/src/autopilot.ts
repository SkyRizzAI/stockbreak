/**
 * Hosted autopilot (D047): per-agent settings, due-run claiming, the run log and the
 * worker heartbeat the web uses for `available`. SQLite dialect (D051): no interactive
 * transactions or row locks; a due run is claimed with a conditional UPDATE instead.
 */
import { and, asc, desc, eq, gt, lt, lte, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import { agentAutopilot, agentRuns, workerStatus } from "./schema";

export type AutopilotRow = typeof agentAutopilot.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AutopilotStatus = "running" | "ok" | "noop" | "error";
export interface AutopilotAction {
  tool: string;
  ok: boolean;
  detail: string;
}

export const AUTOPILOT_KEEP_RUNS = 50;
export const AUTOPILOT_MIN_INTERVAL = 5;
export const AUTOPILOT_MAX_INTERVAL = 1440;
export const AUTOPILOT_MAX_STRATEGY = 1000;
export const AUTOPILOT_MAX_INDEXES = 10;
/** One manual "run now" per agent per this window. */
export const AUTOPILOT_MANUAL_WINDOW_MS = 5 * 60_000;
/** A `running` row older than this belongs to a crashed/stopped worker. */
export const AUTOPILOT_STALE_MS = 10 * 60_000;
/** worker_status.name of the autopilot loop heartbeat. */
export const AUTOPILOT_WORKER = "autopilot";

const MINUTE = 60_000;

export async function getAutopilot(db: Db, wallet: string): Promise<AutopilotRow | null> {
  const [r] = await db
    .select()
    .from(agentAutopilot)
    .where(eq(agentAutopilot.agentWallet, wallet))
    .limit(1);
  return r ?? null;
}

export interface AutopilotPatch {
  enabled?: boolean;
  intervalMinutes?: number;
  strategy?: string;
  indexes?: string[];
}

/**
 * Create/update an agent's settings. Turning autopilot on schedules a run now;
 * shortening the interval pulls the next run forward.
 */
export async function saveAutopilot(
  db: Db,
  wallet: string,
  patch: AutopilotPatch,
  now = new Date(),
): Promise<AutopilotRow> {
  await db.insert(agentAutopilot).values({ agentWallet: wallet }).onConflictDoNothing();
  const cur = await getAutopilot(db, wallet);
  if (!cur) throw new Error("Autopilot settings row missing");
  const enabled = patch.enabled ?? cur.enabled;
  const interval = patch.intervalMinutes ?? cur.intervalMinutes;
  let nextRunAt = cur.nextRunAt;
  if (enabled && !cur.enabled) nextRunAt = now;
  else if (enabled && interval !== cur.intervalMinutes) {
    const byInterval = new Date((cur.lastRunAt ?? now).getTime() + interval * MINUTE);
    if (!nextRunAt || byInterval < nextRunAt) nextRunAt = byInterval;
  }
  const [r] = await db
    .update(agentAutopilot)
    .set({
      enabled,
      intervalMinutes: interval,
      strategy: patch.strategy ?? cur.strategy,
      indexes: patch.indexes ?? cur.indexes,
      nextRunAt,
      updatedAt: now,
    })
    .where(eq(agentAutopilot.agentWallet, wallet))
    .returning();
  if (!r) throw new Error("Could not save autopilot settings");
  return r;
}

export async function hasRunningRun(db: Db, wallet: string, now = new Date()): Promise<boolean> {
  const [r] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentWallet, wallet),
        eq(agentRuns.status, "running"),
        gt(agentRuns.startedAt, new Date(now.getTime() - AUTOPILOT_STALE_MS)),
      ),
    )
    .limit(1);
  return !!r;
}

export type RunRequest =
  | { status: "queued" }
  | { status: "running" }
  | { status: "rate_limited"; retryAfterSecs: number };

/** Manual "run now": the worker picks it up on its next tick (even when disabled). */
export async function requestAutopilotRun(
  db: Db,
  wallet: string,
  now = new Date(),
): Promise<RunRequest> {
  await db.insert(agentAutopilot).values({ agentWallet: wallet }).onConflictDoNothing();
  const cur = await getAutopilot(db, wallet);
  if (!cur) throw new Error("Autopilot settings row missing");
  if (cur.runRequested || (await hasRunningRun(db, wallet, now))) return { status: "running" };
  const since = cur.lastManualRunAt ? now.getTime() - cur.lastManualRunAt.getTime() : Infinity;
  if (since < AUTOPILOT_MANUAL_WINDOW_MS)
    return {
      status: "rate_limited",
      retryAfterSecs: Math.ceil((AUTOPILOT_MANUAL_WINDOW_MS - since) / 1000),
    };
  // Only one of two concurrent requests flips run_requested (the other sees "running").
  const [set] = await db
    .update(agentAutopilot)
    .set({ runRequested: true, nextRunAt: now, lastManualRunAt: now })
    .where(and(eq(agentAutopilot.agentWallet, wallet), eq(agentAutopilot.runRequested, false)))
    .returning({ w: agentAutopilot.agentWallet });
  return set ? { status: "queued" } : { status: "running" };
}

export interface ClaimedRun {
  runId: number;
  agentWallet: string;
  strategy: string;
  indexes: string[];
  intervalMinutes: number;
  manual: boolean;
}

/**
 * Pick up to `limit` due agents (enabled or run requested, next_run_at <= now, no run in
 * progress), claim each with a conditional UPDATE on its old next_run_at (only one worker
 * wins a race) and open a `running` run row for the ones this worker claimed.
 */
export async function claimDueAutopilots(
  db: Db,
  limit: number,
  now = new Date(),
): Promise<ClaimedRun[]> {
  await failStaleRuns(db, now);
  const staleBefore = new Date(now.getTime() - AUTOPILOT_STALE_MS);
  const due = await db
    .select()
    .from(agentAutopilot)
    .where(
      and(
        lte(agentAutopilot.nextRunAt, now),
        or(eq(agentAutopilot.enabled, true), eq(agentAutopilot.runRequested, true)),
        sql`not exists (select 1 from ${agentRuns} where ${agentRuns.agentWallet} = ${agentAutopilot.agentWallet} and ${agentRuns.status} = 'running' and ${agentRuns.startedAt} > ${staleBefore.getTime()})`,
      ),
    )
    .orderBy(asc(agentAutopilot.nextRunAt))
    .limit(Math.max(0, limit));
  const out: ClaimedRun[] = [];
  for (const a of due) {
    if (!a.nextRunAt) continue;
    const [claimed] = await db
      .update(agentAutopilot)
      .set({
        runRequested: false,
        nextRunAt: a.enabled ? new Date(now.getTime() + a.intervalMinutes * MINUTE) : null,
      })
      .where(
        and(
          eq(agentAutopilot.agentWallet, a.agentWallet),
          eq(agentAutopilot.nextRunAt, a.nextRunAt),
        ),
      )
      .returning({ w: agentAutopilot.agentWallet });
    if (!claimed) continue; // another worker took it
    const [run] = await db
      .insert(agentRuns)
      .values({ agentWallet: a.agentWallet, status: "running", startedAt: now })
      .returning({ id: agentRuns.id });
    if (!run) throw new Error("Could not open a run");
    out.push({
      runId: run.id,
      agentWallet: a.agentWallet,
      strategy: a.strategy,
      indexes: a.indexes,
      intervalMinutes: a.intervalMinutes,
      manual: a.runRequested,
    });
  }
  return out;
}

/** Close `running` rows left behind by a stopped worker. */
export async function failStaleRuns(db: Db, now = new Date()): Promise<number> {
  const r = await db
    .update(agentRuns)
    .set({
      status: "error",
      finishedAt: now,
      summary: "Interrupted: the worker stopped before the run finished.",
    })
    .where(
      and(
        eq(agentRuns.status, "running"),
        lt(agentRuns.startedAt, new Date(now.getTime() - AUTOPILOT_STALE_MS)),
      ),
    )
    .returning({ id: agentRuns.id });
  return r.length;
}

/** Store a run's outcome, stamp last_run_at and keep the newest AUTOPILOT_KEEP_RUNS runs. */
export async function finishAgentRun(
  db: Db,
  runId: number,
  result: {
    status: Exclude<AutopilotStatus, "running">;
    summary: string;
    actions: AutopilotAction[];
  },
  now = new Date(),
): Promise<void> {
  const [run] = await db
    .update(agentRuns)
    .set({
      status: result.status,
      summary: result.summary.slice(0, 4000),
      actions: result.actions.slice(0, 50).map((a) => ({ ...a, detail: a.detail.slice(0, 500) })),
      finishedAt: now,
    })
    .where(eq(agentRuns.id, runId))
    .returning({ agentWallet: agentRuns.agentWallet });
  if (!run) return;
  await db
    .update(agentAutopilot)
    .set({ lastRunAt: now })
    .where(eq(agentAutopilot.agentWallet, run.agentWallet));
  await pruneAgentRuns(db, run.agentWallet);
}

export async function pruneAgentRuns(
  db: Db,
  wallet: string,
  keep = AUTOPILOT_KEEP_RUNS,
): Promise<void> {
  const newest = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.agentWallet, wallet))
    .orderBy(desc(agentRuns.id))
    .limit(keep);
  if (newest.length < keep) return;
  await db.delete(agentRuns).where(
    and(
      eq(agentRuns.agentWallet, wallet),
      notInArray(
        agentRuns.id,
        newest.map((r) => r.id),
      ),
    ),
  );
}

/** Newest first. */
export async function listAgentRuns(db: Db, wallet: string, limit = 10): Promise<AgentRunRow[]> {
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agentWallet, wallet))
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(limit);
}

// ---------------- worker heartbeat ----------------

export async function setWorkerStatus(
  db: Db,
  name: string,
  info: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  await db
    .insert(workerStatus)
    .values({ name, info, updatedAt: now })
    .onConflictDoUpdate({ target: workerStatus.name, set: { info, updatedAt: now } });
}

export async function getWorkerStatus(
  db: Db,
  name: string,
): Promise<{ info: Record<string, unknown>; updatedAt: Date } | null> {
  const [r] = await db
    .select({ info: workerStatus.info, updatedAt: workerStatus.updatedAt })
    .from(workerStatus)
    .where(eq(workerStatus.name, name))
    .limit(1);
  return r ?? null;
}

// ---------------- worker lease ----------------

/**
 * Take (or keep) a named lease for `holder` until `now + ttlMs`; false when another holder
 * owns a live lease. One conditional UPSERT, so two overlapping cron invocations never both
 * win (D1 has no row locks). Stored in worker_status (`info.holder`, `info.until`).
 */
export async function acquireLease(
  db: Db,
  name: string,
  holder: string,
  ttlMs: number,
  now = new Date(),
): Promise<boolean> {
  const info = JSON.stringify({ holder, until: now.getTime() + ttlMs });
  const rows = await db.all(sql`
    insert into ${workerStatus} (name, info, updated_at) values (${name}, ${info}, ${now.getTime()})
    on conflict (name) do update set info = excluded.info, updated_at = excluded.updated_at
    where json_extract(${workerStatus.info}, '$.until') < ${now.getTime()}
       or json_extract(${workerStatus.info}, '$.holder') = ${holder}
    returning name`);
  return rows.length > 0;
}

/** Give the lease back early (only when `holder` still owns it). */
export async function releaseLease(db: Db, name: string, holder: string): Promise<void> {
  await db
    .update(workerStatus)
    .set({ info: { holder, until: 0 } })
    .where(
      and(
        eq(workerStatus.name, name),
        sql`json_extract(${workerStatus.info}, '$.holder') = ${holder}`,
      ),
    );
}
