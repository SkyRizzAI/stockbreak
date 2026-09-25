import "server-only";
/** Autopilot settings + run log for the agent console (D047). */
import {
  AUTOPILOT_MAX_INDEXES,
  AUTOPILOT_MAX_INTERVAL,
  AUTOPILOT_MAX_STRATEGY,
  AUTOPILOT_MIN_INTERVAL,
  AUTOPILOT_WORKER,
  type AutopilotAction,
  type AutopilotStatus,
  getAgentWallet,
  getAutopilot,
  getWorkerStatus,
  listAgentRuns,
} from "@repo/db";
import * as z from "zod";
import { db } from "./ctx";
import { fail, isAddress } from "./http";

/** A worker heartbeat older than this means no autopilot worker is running. */
const HEARTBEAT_MAX_AGE_MS = 5 * 60_000;

export interface AutopilotView {
  enabled: boolean;
  intervalMinutes: number;
  strategy: string;
  indexes: string[];
  model: string | null;
  available: boolean;
  reason: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runs: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: AutopilotStatus;
    summary: string;
    actions: AutopilotAction[];
  }[];
}

export const AutopilotBody = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z
    .number()
    .int("Interval: whole minutes")
    .min(AUTOPILOT_MIN_INTERVAL, `Interval: at least ${AUTOPILOT_MIN_INTERVAL} minutes`)
    .max(AUTOPILOT_MAX_INTERVAL, `Interval: at most ${AUTOPILOT_MAX_INTERVAL} minutes`)
    .optional(),
  strategy: z
    .string()
    .max(AUTOPILOT_MAX_STRATEGY, `Strategy: up to ${AUTOPILOT_MAX_STRATEGY} characters`)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), {
      message: "Strategy contains invalid characters",
    })
    .transform((v) => v.trim())
    .optional(),
  indexes: z
    .array(z.string().refine((v) => isAddress(v), { message: "Invalid index address" }))
    .max(AUTOPILOT_MAX_INDEXES, `Up to ${AUTOPILOT_MAX_INDEXES} indexes`)
    .transform((v) => [...new Set(v)])
    .optional(),
});

/** The owner's agent wallet, or a 400/404 JSON response. */
export async function ownedAgent(owner: string, wallet: string): Promise<string | Response> {
  if (!isAddress(wallet)) return fail(400, "Invalid wallet");
  const a = await getAgentWallet(db(), wallet);
  if (!a || a.owner !== owner) return fail(404, "Agent not found");
  return a.wallet;
}

/** Whether a worker currently runs autopilot, from its heartbeat. */
export async function autopilotAvailability(): Promise<{
  available: boolean;
  reason: string | null;
  model: string | null;
}> {
  const hb = await getWorkerStatus(db(), AUTOPILOT_WORKER);
  if (!hb || Date.now() - hb.updatedAt.getTime() > HEARTBEAT_MAX_AGE_MS)
    return {
      available: false,
      reason: "The autopilot worker is not running on this server.",
      model: null,
    };
  const available = hb.info.available === true;
  return {
    available,
    reason: available
      ? null
      : typeof hb.info.reason === "string"
        ? hb.info.reason
        : "Autopilot is not available on this server.",
    model: typeof hb.info.model === "string" ? hb.info.model : null,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function autopilotView(wallet: string): Promise<AutopilotView> {
  const [row, runs, avail] = await Promise.all([
    getAutopilot(db(), wallet),
    listAgentRuns(db(), wallet, 10),
    autopilotAvailability(),
  ]);
  return {
    enabled: row?.enabled ?? false,
    intervalMinutes: row?.intervalMinutes ?? 30,
    strategy: row?.strategy ?? "",
    indexes: row?.indexes ?? [],
    ...avail,
    lastRunAt: iso(row?.lastRunAt ?? null),
    nextRunAt: iso(row?.nextRunAt ?? null),
    runs: runs.map((r) => ({
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      status: r.status as AutopilotStatus,
      summary: r.summary,
      actions: r.actions,
    })),
  };
}
