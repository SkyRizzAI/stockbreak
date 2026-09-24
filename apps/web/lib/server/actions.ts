import "server-only";
/** Solana Actions (Blinks) helpers: CORS + headers (A09). */
import { CAIP2 } from "@repo/config";
import { NextResponse } from "next/server";
import { toJsonSafe } from "../json";
import { serverEnv } from "./ctx";

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
