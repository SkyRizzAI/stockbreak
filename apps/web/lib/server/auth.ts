import "server-only";
/** Wallet signature auth over a one-time nonce (A08). */
import { consumeNonce } from "@repo/db";
import {
  type Address,
  getBase64Encoder,
  getPublicKeyFromAddress,
  type SignatureBytes,
  verifySignature,
} from "@solana/kit";
import { authMessage } from "../auth-message";
import { db } from "./ctx";

export async function verifyWallet(
  wallet: string,
  purpose: string,
  nonce: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const key = await getPublicKeyFromAddress(wallet as Address);
    const sig = getBase64Encoder().encode(signatureB64) as SignatureBytes;
    const msg = new TextEncoder().encode(authMessage(wallet, purpose, nonce));
    if (!(await verifySignature(key, sig, msg))) return false;
    return consumeNonce(db(), nonce, wallet, purpose);
  } catch {
    return false;
  }
}
