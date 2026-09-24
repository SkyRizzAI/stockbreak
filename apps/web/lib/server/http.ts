import "server-only";
import { NextResponse } from "next/server";
import { toJsonSafe } from "../json";

export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(toJsonSafe(data), init);
}

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** An expected, user-facing failure (bad input, wrong state); mapped to its status. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Integer query param with bounds; NaN / missing → fallback. */
export function intParam(v: string | null, fallback: number, min: number, max: number): number {
  const n = v === null || v === "" ? Number.NaN : Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export async function guard<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const r = await fn();
    return r instanceof NextResponse ? r : ok(r);
  } catch (e) {
    // A malformed request body is the caller's mistake, not a server error.
    if (e instanceof SyntaxError && /JSON/.test(e.message)) return fail(400, "Invalid JSON body");
    if (e instanceof UserError) return fail(e.status, e.message);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api]", msg);
    return fail(500, msg.split("\n")[0] ?? "Internal error");
  }
}

export const isAddress = (s: string | null | undefined): s is string =>
  !!s && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
