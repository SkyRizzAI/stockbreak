import "server-only";
import { NextResponse } from "next/server";
import { toJsonSafe } from "../json";

export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(toJsonSafe(data), init);
}

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function guard<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const r = await fn();
    return r instanceof NextResponse ? r : ok(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api]", msg);
    return fail(500, msg.split("\n")[0] ?? "Internal error");
  }
}

export const isAddress = (s: string | null | undefined): s is string =>
  !!s && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
