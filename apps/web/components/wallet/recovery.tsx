"use client";
/** Recovery actions for a zap that stopped halfway (PartialZapError). */
import { joinWithHeld, type PartialZapError, swapToUsdc } from "@repo/sdk";
import type { Address, TransactionSigner } from "@solana/kit";
import { useEffect, useRef } from "react";
import { num } from "@/lib/format";
import { chain } from "@/lib/solana";
import type { Progress, RunOptions, ToastAction, useRun } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

type Run = ReturnType<typeof useRun>["run"];

/** Always-current signer (the toast action may fire long after the render that built it). */
export function useSignerRef() {
  const w = useWallet();
  const ref = useRef<TransactionSigner | null>(w.signer);
  useEffect(() => {
    ref.current = w.signer;
  }, [w.signer]);
  return ref;
}

const noWallet = () => Promise.reject(new Error("Wallet not connected"));

/**
 * Builds the toast actions for a partial zap: "Finish join" (when an index is
 * given and the flow allows it) and "Swap to USDC" for the assets it left behind.
 */
export function useZapRecovery(
  run: Run,
  usdcMint: Address | undefined,
  index?: { pubkey: string; symbol: string; lookupTable: string | null },
): NonNullable<RunOptions["recover"]> {
  const signer = useSignerRef();
  // A plain function (not memoised): "Finish join" passes itself on as the recovery.
  const recover = (e: PartialZapError): ToastAction[] => {
    const actions: ToastAction[] = [];
    const swapBack: ToastAction = {
      label: "Swap to USDC",
      onClick: () =>
        void run(
          "Swap to USDC",
          (onProgress: (p: Progress) => void) =>
            signer.current && usdcMint
              ? swapToUsdc(
                  chain(),
                  signer.current,
                  usdcMint,
                  e.held.map((h) => ({ mint: h.mint as Address, amount: h.amount })),
                  { onProgress },
                )
              : noWallet(),
          () => "Swapped the assets back to USDC",
        ),
    };
    if (index && e.recovery.includes("finish-join")) {
      actions.push({
        label: "Finish join",
        onClick: () =>
          void run(
            `Join ${index.symbol}`,
            (onProgress: (p: Progress) => void) =>
              signer.current
                ? joinWithHeld(chain(), signer.current, index.pubkey as Address, {
                    lookupTable: index.lookupTable as Address | null,
                    onProgress,
                  })
                : noWallet(),
            (r) => `Joined ${index.symbol}: ${num(Number(r.shares) / 1e6)} shares`,
            { recover },
          ),
      });
    }
    if (e.recovery.includes("swap-to-usdc") && e.held.length) actions.push(swapBack);
    return actions;
  };
  return recover;
}
