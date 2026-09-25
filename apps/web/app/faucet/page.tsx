"use client";
import { faucetIxs, sendTx } from "@repo/sdk";
import type { Address } from "@solana/kit";
import { useState } from "react";
import { SimulatedBadge } from "@/components/data/states";
import { openConnect, useBalances } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, useConfig } from "@/lib/api";
import { CLUSTER, CLUSTER_LABEL } from "@/lib/env";
import { num } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

const MIN_SOL_FOR_USDC = 0.003;

export default function FaucetPage() {
  const w = useWallet();
  const cfg = useConfig();
  const bal = useBalances(w.address);
  const { run, busy } = useRun();
  const max = Number(cfg.data?.params.faucetMaxUsdc ?? "0") / 1e6;
  const options = CLUSTER === "devnet" ? [1_000, 5_000, 10_000] : [10_000, 100_000, 500_000];
  const [amount, setAmount] = useState(String(options[1]));
  const usdcMint = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint as Address | undefined;
  // One faucet tx may create the USDC account (~0.002 SOL rent) plus the fee.
  const needsSol = !!bal.data && bal.data.sol < MIN_SOL_FOR_USDC;
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Faucet</h1>
          <SimulatedBadge />
        </div>
        <p className="text-sm text-muted-foreground">
          Free SOL for fees and simulated USDC on {CLUSTER_LABEL}. No real value.
        </p>
      </div>
      {!w.address ? (
        <Button size="lg" className="self-start" onClick={openConnect}>
          Connect wallet
        </Button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border p-4">
              <div className="text-xs text-muted-foreground">SOL</div>
              <div className="num text-2xl" data-testid="sol-balance">
                {bal.data ? num(bal.data.sol, 3) : "—"}
              </div>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="text-xs text-muted-foreground">USDC</div>
              <div className="num text-2xl" data-testid="usdc-balance">
                {bal.data ? num(bal.data.usdc) : "—"}
              </div>
            </div>
          </div>
          <section className="flex flex-col gap-3 rounded-2xl border p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">1. SOL for transaction fees</h2>
              <p className="text-xs text-muted-foreground">
                {CLUSTER === "devnet"
                  ? `Sends ${cfg.data?.faucetSolPerRequest ?? 0.2} SOL from the app's faucet wallet. Limited per wallet per day.`
                  : "Airdrops 2 SOL on the local validator."}
              </p>
            </div>
            {cfg.data?.faucetSol === false ? (
              <p className="text-sm">
                The in-app SOL faucet is off on this deployment. Get free devnet SOL at{" "}
                <a
                  href="https://faucet.solana.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  faucet.solana.com
                </a>{" "}
                for <span className="mono break-all">{w.address}</span>.
              </p>
            ) : (
              <Button
                variant="outline"
                className="self-start"
                disabled={busy}
                onClick={() =>
                  void run("Get SOL", async () =>
                    api<{ signature?: string }>("/api/faucet/sol", {
                      method: "POST",
                      body: JSON.stringify({ wallet: w.address }),
                    }),
                  )
                }
                data-testid="faucet-sol"
              >
                Get SOL
              </Button>
            )}
          </section>
          <section className="flex flex-col gap-3 rounded-2xl border p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">2. Simulated USDC</h2>
              <p className="text-xs text-muted-foreground">
                Minted by the mock market. Up to {num(max)} per request. You sign one transaction.
              </p>
            </div>
            <ToggleGroup
              value={[amount]}
              onValueChange={(v) => setAmount((v as string[])[0] ?? amount)}
              variant="outline"
              size="sm"
            >
              {options.map((o) => (
                <ToggleGroupItem key={o} value={String(o)} className="num px-3">
                  {num(o)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              className="self-start"
              disabled={busy || !w.signer || !usdcMint || !bal.data || needsSol}
              onClick={() =>
                void run(`Get ${num(Number(amount))} USDC`, async () => ({
                  signature: await sendTx(
                    chain(),
                    w.signer as NonNullable<typeof w.signer>,
                    await faucetIxs(
                      w.signer as NonNullable<typeof w.signer>,
                      usdcMint as Address,
                      BigInt(amount) * 1_000_000n,
                    ),
                  ),
                }))
              }
              data-testid="faucet-usdc"
            >
              {needsSol ? "Get SOL first" : `Get ${num(Number(amount))} USDC`}
            </Button>
          </section>
        </>
      )}
    </div>
  );
}
