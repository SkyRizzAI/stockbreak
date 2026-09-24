"use client";
/** Transaction runner: toasts with progress + explorer links, human errors, cache refresh. */
import { humanizeError, PartialZapError } from "@repo/sdk";
import {
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isTransactionModifyingSigner,
  isTransactionPartialSigner,
  type Signature,
  type Transaction,
  type TransactionSigner,
} from "@solana/kit";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { chain, txUrl } from "./solana";

export interface Progress {
  step: string;
  done: number;
  total: number;
  signature?: Signature;
}

function Explorer({ sig }: { sig: string }) {
  return (
    <a href={txUrl(sig)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      View transaction
    </a>
  );
}

/** Human label for a zap progress step. */
export function stepLabel(step: string): string {
  switch (step) {
    case "swap":
      return "Swapping";
    case "join":
      return "Joining";
    case "prepare":
      return "Preparing accounts";
    case "redeem":
      return "Redeeming";
    case "wait":
      return "Waiting for fresh prices";
    default:
      return step;
  }
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface RunOptions {
  /**
   * Recovery offered when a multi-transaction flow stopped halfway: the first
   * action is the main one, the optional second is shown as the alternative.
   */
  recover?: (e: PartialZapError) => ToastAction[];
}

/** Errors stay long enough to read; partial results stay until dismissed. */
const ERROR_MS = 12_000;

export function useRun() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const run = useCallback(
    async <T,>(
      label: string,
      fn: (onProgress: (p: Progress) => void) => Promise<T>,
      success?: (r: T) => string,
      opts: RunOptions = {},
    ): Promise<T | null> => {
      setBusy(true);
      setProgress(null);
      const id = toast.loading(label);
      try {
        const r = await fn((p) => {
          setProgress(p);
          toast.loading(`${label} · ${stepLabel(p.step)} ${p.done}/${p.total}`, {
            id,
            description: p.signature ? <Explorer sig={p.signature} /> : undefined,
          });
        });
        const sig =
          (r as { signatures?: string[]; signature?: string } | null)?.signatures?.at(-1) ??
          (r as { signature?: string } | null)?.signature;
        toast.success(success ? success(r) : `${label} — done`, {
          id,
          description: sig ? <Explorer sig={sig} /> : undefined,
        });
        return r;
      } catch (e) {
        console.error(e);
        if (e instanceof PartialZapError) {
          const [main, alt] = opts.recover?.(e) ?? [];
          const last = e.completed.at(-1);
          toast.warning(e.message, {
            id,
            duration: Number.POSITIVE_INFINITY,
            closeButton: true,
            description: (
              <span className="flex flex-col gap-1">
                <span>
                  {e.completed.length} of {e.totalSteps} steps completed. {e.reason}
                </span>
                {last ? <Explorer sig={last} /> : null}
              </span>
            ),
            action: main,
            cancel: alt,
          });
        } else {
          toast.error(humanizeError(e), {
            id,
            description: label,
            duration: ERROR_MS,
            closeButton: true,
          });
        }
        return null;
      } finally {
        setBusy(false);
        setProgress(null);
        // Refresh balances on success and on failure (a failed flow may have moved funds).
        void qc.invalidateQueries();
        setTimeout(() => void qc.invalidateQueries(), 4000);
      }
    },
    [qc],
  );
  return { run, busy, progress };
}

/** Sign a server-built base64 transaction with a wallet signer, send and confirm. */
export async function signAndSendBase64(
  signer: TransactionSigner,
  b64: string,
): Promise<Signature> {
  const c = chain();
  let tx = getTransactionDecoder().decode(getBase64Encoder().encode(b64)) as Transaction;
  if (isTransactionModifyingSigner(signer)) {
    [tx] = (await signer.modifyAndSignTransactions([tx as never])) as unknown as Transaction[];
  } else if (isTransactionPartialSigner(signer)) {
    const [sigs] = await signer.signTransactions([tx as never]);
    tx = { ...tx, signatures: { ...tx.signatures, ...sigs } };
  } else {
    throw new Error("This wallet cannot sign transactions");
  }
  const wire = getBase64EncodedWireTransaction(tx as never);
  const sig = await c.rpc
    .sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" })
    .send();
  for (let i = 0; i < 60; i++) {
    const { value } = await c.rpc.getSignatureStatuses([sig]).send();
    const s = value[0];
    if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    await new Promise((r) => setTimeout(r, 500));
  }
  void getSignatureFromTransaction;
  throw new Error("Transaction was not confirmed in time");
}
