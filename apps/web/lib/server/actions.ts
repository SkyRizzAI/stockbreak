import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
/** Solana Actions (Blinks) helpers: CORS + headers (A09). */
import { CAIP2 } from "@repo/config";
import { NextResponse } from "next/server";
import { toJsonSafe } from "../json";
import { serverEnv } from "./ctx";
import { UserError } from "./http";

export function actionHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
    "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
    "X-Action-Version": "2.4",
    "X-Blockchain-Ids": CAIP2[serverEnv().CLUSTER],
  };
}

export const actionJson = (body: unknown, status = 200) =>
  NextResponse.json(toJsonSafe(body), { status, headers: actionHeaders() });

export const actionError = (message: string, status = 400) => actionJson({ message }, status);

export const preflight = () => new NextResponse(null, { status: 204, headers: actionHeaders() });

export function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

export function fromB64url<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Map a thrown error to an Action error: user errors keep their status, a missing index is 404. */
export function actionFail(e: unknown) {
  if (e instanceof UserError) return actionError(e.message, e.status);
  const msg = e instanceof Error ? (e.message.split("\n")[0] ?? "Failed") : "Failed";
  if (/Account not found|not a valid IndexAccount|discriminator/i.test(msg))
    return actionError("Index not found", 404);
  return actionError(msg, 500);
}

const stateKey = () =>
  createHmac("sha256", "stocklana-blink-state").update(serverEnv().DATABASE_URL).digest();

/**
 * Chained-Blink state travels in the URL; sign it (bound to account, index and
 * amount) so a crafted link cannot swap in a different baseline or USDC leg.
 */
export function signState(o: unknown, bind: string): string {
  const body = b64url(o);
  const mac = createHmac("sha256", stateKey()).update(`${bind}.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState<T>(s: string | null, bind: string): T | null {
  const [body, mac] = (s ?? "").split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", stateKey()).update(`${bind}.${body}`).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return fromB64url<T>(body);
}
