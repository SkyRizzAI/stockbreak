"use client";
/** Sign a server nonce with the connected wallet (profile, follow, index metadata). */
import { getBase64Decoder } from "@solana/kit";
import { api } from "./api";
import { walletClient } from "./wallet";

export async function signedPayload(
  wallet: string,
  purpose: string,
): Promise<{ nonce: string; signature: string }> {
  const { nonce, message } = await api<{ nonce: string; message: string }>(
    `/api/auth/nonce?wallet=${wallet}&purpose=${purpose}`,
  );
  const sig = await walletClient.wallet.signMessage(new TextEncoder().encode(message));
  return { nonce, signature: getBase64Decoder().decode(sig) };
}
