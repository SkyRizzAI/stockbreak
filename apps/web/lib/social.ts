"use client";
/** Client helpers for social writes: one wallet signature per 24 h session (D033). */
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { signedPayload } from "./auth";

/** Make sure the connected wallet has a live session; asks for one signature if not. */
export async function ensureSession(qc: QueryClient, wallet: string): Promise<void> {
  const s = await qc.fetchQuery({
    queryKey: ["session"],
    queryFn: () => api<{ wallet: string | null }>("/api/auth/session"),
    staleTime: 0,
  });
  if (s.wallet === wallet) return;
  const auth = await signedPayload(wallet, "sign-in");
  await api("/api/auth/session", { method: "POST", body: JSON.stringify({ wallet, ...auth }) });
  qc.setQueryData(["session"], { wallet });
}

/** Run a social write; on 401 (expired session) sign in again once and retry. */
export async function socialWrite<T>(
  qc: QueryClient,
  wallet: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  await ensureSession(qc, wallet);
  try {
    return await api<T>(path, init);
  } catch (e) {
    if ((e as { status?: number }).status !== 401) throw e;
    qc.setQueryData(["session"], { wallet: null });
    await ensureSession(qc, wallet);
    return api<T>(path, init);
  }
}
