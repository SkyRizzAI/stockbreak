"use client";
import { type Address, createClient, type TransactionSigner } from "@solana/kit";
/**
 * Wallet Standard wallets via @solana/kit-plugin-wallet (A08). One module-level
 * client (SSR-safe: inert on the server). The Dev Wallet registers itself on
 * localnet/devnet only.
 */
import { walletSigner } from "@solana/kit-plugin-wallet";
import { useConnectedWallet, useWalletStatus } from "@solana/kit-plugin-wallet/react";
import { useSyncExternalStore } from "react";
import { registerDevWallet } from "./dev-wallet";
import { WALLET_CHAIN } from "./env";

if (typeof window !== "undefined") registerDevWallet();

export const walletClient = createClient().use(
  walletSigner({ chain: WALLET_CHAIN, storageKey: "stocklana:wallet" }),
);
export type WalletClient = typeof walletClient;

export interface WalletInfo {
  address: Address | null;
  signer: TransactionSigner | null;
  walletName: string | null;
  status: ReturnType<typeof useWalletStatus>;
  canSignMessage: boolean;
}

const noop = () => () => {};

/** False during SSR and hydration, true afterwards (avoids hydration mismatches). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function useWallet(): WalletInfo {
  const hydrated = useHydrated();
  const live = useConnectedWallet(walletClient);
  const liveStatus = useWalletStatus(walletClient);
  // The server never sees a wallet: report "disconnected" until hydrated so both renders match.
  const connected = hydrated ? live : null;
  const status = hydrated ? liveStatus : ("disconnected" as typeof liveStatus);
  const signer = connected?.signer ?? null;
  return {
    address: (connected?.account.address as Address | undefined) ?? null,
    signer,
    walletName: null,
    status,
    canSignMessage: !!signer && "signMessages" in signer,
  };
}
