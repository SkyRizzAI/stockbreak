import "server-only";
/**
 * Sign-in sessions for social writes (D033): the wallet signs once, the server
 * sets an httpOnly cookie; only a SHA-256 hash of the token is stored.
 */
import { createHash, randomBytes } from "node:crypto";
import { createSession, deleteSession, sessionWallet } from "@repo/db";
import { cookies } from "next/headers";
import { db } from "./ctx";
import { fail } from "./http";

export const SESSION_COOKIE = "stk_session";
const TTL_MS = 24 * 60 * 60 * 1000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function startSession(wallet: string): Promise<Date> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await createSession(db(), { tokenHash: hash(token), wallet, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" &&
      !/localhost|127\.0\.0\.1/.test(process.env.WEB_URL ?? ""),
    path: "/",
    expires: expiresAt,
  });
  return expiresAt;
}

export async function currentWallet(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sessionWallet(db(), hash(token)) : null;
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(db(), hash(token));
  jar.delete(SESSION_COOKIE);
}

/** CSRF guard for cookie-authenticated writes: the Origin must be this site. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetch from older browsers / server tools
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Session wallet for a write, or an error response (401 / 403). */
export async function requireWriter(req: Request): Promise<string | Response> {
  if (!sameOrigin(req)) return fail(403, "Cross-site request blocked");
  const w = await currentWallet();
  return w ?? fail(401, "Sign in with your wallet to continue");
}
