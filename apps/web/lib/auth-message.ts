/** Message the wallet signs for profile/metadata changes (shared client/server). */
export function authMessage(wallet: string, purpose: string, nonce: string): string {
  return `${process.env.NEXT_PUBLIC_APP_NAME || "Stockbreak"}\nAction: ${purpose}\nWallet: ${wallet}\nNonce: ${nonce}`;
}
