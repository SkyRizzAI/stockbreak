import "server-only";
/**
 * Sign-intent progress (PLAN §7.6). The server owns the step cursor so a reload,
 * a retry or a second tab resumes where the flow stopped instead of re-running
 * finished steps (double swaps, "account already in use" on create).
 *
 * Private keys inside `params` (never returned to clients):
 *   _state  opaque step state      _next   next step to build (default 0)
 *   _built  { step, next, txs, at, sigs } the step handed out and not yet finished
 */
import type { IntentRow } from "@repo/db";
import type { Address, Signature } from "@solana/kit";
import { chain } from "./ctx";

export interface Built {
  step: number;
  next: number | null;
  txs: number;
  at: number;
  sigs: number;
}

export interface Progress {
  state: Record<string, unknown>;
  next: number;
  built: Built | null;
  rest: Record<string, unknown>;
}

/** Signing lock: another tab asked for the same step this recently and reported nothing. */
export const LOCK_MS = 60_000;
/** An intent the user started stays usable this long past its expiry. */
export const GRACE_MS = 60 * 60_000;

export function progressOf(it: IntentRow): Progress {
  const { _state, _next, _built, ...rest } = (it.params ?? {}) as Record<string, unknown>;
  return {
    state: (_state as Record<string, unknown>) ?? {},
    next: typeof _next === "number" ? _next : 0,
    built: (_built as Built | undefined) ?? null,
    rest,
  };
}

export function paramsOf(p: Progress): Record<string, unknown> {
  return { ...p.rest, _state: p.state, _next: p.next, _built: p.built };
}

/** Public status: pending intents expire at expiresAt; started ones after a grace period. */
export function publicStatus(it: IntentRow, now = Date.now()): string {
  const exp = new Date(it.expiresAt).getTime();
  if (it.status === "pending" && exp < now) return "expired";
  if ((it.status === "in_progress" || it.status === "failed") && exp + GRACE_MS < now)
    return "expired";
  return it.status;
}

/**
 * Confirmed, successful signatures whose transaction was signed by `wallet`.
 * Anything unconfirmed, failed or signed by someone else is dropped.
 */
export async function verifiedSignatures(wallet: string, sigs: string[]): Promise<string[]> {
  if (!sigs.length) return [];
  const c = chain();
  const { value } = await c.rpc.getSignatureStatuses(sigs as Signature[]).send();
  const out: string[] = [];
  for (const [i, s] of value.entries()) {
    const sig = sigs[i] as string;
    if (!s || s.err || !s.confirmationStatus || s.confirmationStatus === "processed") continue;
    const tx = await c.rpc
      .getTransaction(sig as Signature, {
        encoding: "json",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })
      .send();
    const keys = tx?.transaction.message.accountKeys ?? [];
    const signers = keys.slice(0, tx?.transaction.message.header.numRequiredSignatures ?? 0);
    if (signers.includes(wallet as Address)) out.push(sig);
  }
  return out;
}
