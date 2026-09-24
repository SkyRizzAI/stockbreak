"use client";
import {
  ata,
  estimateZapInLamports,
  fetchIndex,
  fetchTokenBalances,
  joinWithHeld,
  MIN_INITIAL_USDC,
  planJoinWithHeld,
  planZapIn,
  planZapOut,
  TOKEN_PROGRAM,
  zapIn,
  zapOut,
} from "@repo/sdk";
import type { Address } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useBalances } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useZapRecovery } from "@/components/wallet/recovery";
import { useConfig } from "@/lib/api";
import { price as fmtPrice, num, toRaw, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { stepLabel, useRun } from "@/lib/tx";
import type { IndexDetail } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

const QUICK = [100, 1_000, 10_000];
const DECIMALS = 6;

/** Exact decimal string of a raw 6-decimal amount (round-trips through toRaw). */
function fromRaw(raw: bigint): string {
  const s = raw.toString().padStart(DECIMALS + 1, "0");
  const i = s.slice(0, -DECIMALS);
  const f = s.slice(-DECIMALS).replace(/0+$/, "");
  return f ? `${i}.${f}` : i;
}

/** Keep digits and one dot, at most 6 decimals. */
function cleanAmount(v: string): string {
  const t = v.replace(/[^\d.]/g, "");
  const [i = "", ...rest] = t.split(".");
  return rest.length ? `${i}.${rest.join("").slice(0, DECIMALS)}` : i;
}

function useShareBalance(address: string | null, shareMint: string) {
  return useQuery({
    queryKey: ["shares", address, shareMint],
    enabled: !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const a = await ata(address as Address, shareMint as Address, TOKEN_PROGRAM);
      return (await fetchTokenBalances(chain(), [a])).get(a) ?? 0n;
    },
  });
}

function Stepper({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="num">
          {done}/{total}
        </span>
      </div>
      <Progress value={(done / Math.max(total, 1)) * 100} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function JoinTab({ d, onConnect }: { d: IndexDetail; onConnect: () => void }) {
  const w = useWallet();
  const cfg = useConfig();
  const bal = useBalances(w.address);
  const [amount, setAmount] = useState("1000");
  const { run, busy, progress } = useRun();
  const usdcMint = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint as Address | undefined;
  const index = { pubkey: d.pubkey, symbol: d.symbol, lookupTable: d.lookupTable };
  const recover = useZapRecovery(run, usdcMint, index);
  const initial = BigInt(d.effectiveSupply || "0") === 0n;
  const raw = toRaw(amount, DECIMALS);
  const minRaw = initial ? MIN_INITIAL_USDC : 1n;
  const valid = raw !== null && raw >= minRaw;
  const value = raw === null ? 0 : Number(raw) / 1e6;
  const est = useQuery({
    queryKey: ["zapin", d.pubkey, amount, d.navLiveUsd],
    enabled: valid && !!usdcMint,
    queryFn: async () => {
      const st = await fetchIndex(chain(), d.pubkey as Address);
      return planZapIn(chain(), st, usdcMint as Address, raw as bigint);
    },
  });
  // SOL for fees + rent of every token account the first join creates.
  const cost = useQuery({
    queryKey: ["zapin-cost", w.address, d.pubkey, usdcMint],
    enabled: !!w.address && !!usdcMint,
    queryFn: () =>
      estimateZapInLamports(
        chain(),
        w.address as Address,
        d.live.map((a) => ({ mint: a.mint as Address, tokenProgram: a.tokenProgram as Address })),
        d.shareMint as Address,
        usdcMint as Address,
      ),
  });
  // Index assets already in the wallet (e.g. a join that stopped after the swaps).
  const held = useQuery({
    queryKey: ["held-join", w.address, d.pubkey, d.navLiveUsd],
    enabled: !!w.address && !initial,
    refetchInterval: 15_000,
    queryFn: async () =>
      planJoinWithHeld(
        chain(),
        w.address as Address,
        await fetchIndex(chain(), d.pubkey as Address),
      ),
  });
  const insufficient = !!bal.data && valid && value > bal.data.usdc;
  const needSol = cost.data ? Number(cost.data.lamports) / 1e9 : 0.005;
  const noSol = !!bal.data && bal.data.sol < needSol;
  const legs = est.data?.legs.filter((l) => l.usdcIn > 0n) ?? [];
  const tooSmall = est.data?.expectedShares === 0n;
  const submit = () =>
    run(
      `Join ${d.symbol}`,
      (onProgress) =>
        zapIn(
          chain(),
          w.signer as NonNullable<typeof w.signer>,
          d.pubkey as Address,
          usdcMint as Address,
          raw as bigint,
          {
            lookupTable: d.lookupTable as Address | null,
            onProgress,
          },
        ),
      (r) => `Joined ${d.symbol}: ${num(Number(r.shares) / 1e6)} shares`,
      { recover },
    );
  const finishJoin = () =>
    run(
      `Join ${d.symbol}`,
      (onProgress) =>
        joinWithHeld(chain(), w.signer as NonNullable<typeof w.signer>, d.pubkey as Address, {
          lookupTable: d.lookupTable as Address | null,
          onProgress,
        }),
      (r) => `Joined ${d.symbol}: ${num(Number(r.shares) / 1e6)} shares`,
    );
  const hint =
    raw !== null && raw > 0n && raw < minRaw
      ? "The first deposit must be at least $1.10: the program needs $1 of assets after swap costs."
      : tooSmall
        ? "This amount is too small to mint any shares."
        : null;
  return (
    <div className="flex flex-col gap-4">
      {w.signer && held.data && held.data.shares > 0n ? (
        <div className="flex flex-col gap-2 rounded-2xl border p-3 text-sm">
          <span className="text-muted-foreground">
            Your wallet holds this index&apos;s assets, worth about{" "}
            <span className="num text-foreground">
              {num(Number(held.data.shares) / 1e6)} shares
            </span>
            .
          </span>
          <Button
            variant="outline"
            disabled={busy || d.paused}
            onClick={() => void finishJoin()}
            data-testid="finish-join"
          >
            Finish join with assets in your wallet
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Label htmlFor="join-amount">Amount (USDC)</Label>
          {bal.data ? (
            <button
              type="button"
              className="num hover:text-foreground"
              onClick={() => setAmount(String(Math.floor(bal.data.usdc)))}
            >
              Balance {num(bal.data.usdc)}
            </button>
          ) : null}
        </div>
        <Input
          id="join-amount"
          inputMode="decimal"
          className="num h-11 text-lg"
          value={amount}
          onChange={(e) => setAmount(cleanAmount(e.target.value))}
          aria-invalid={!!hint}
          data-testid="join-amount"
        />
        {hint ? <p className="text-xs text-destructive">{hint}</p> : null}
        <div className="flex gap-2">
          {QUICK.map((q) => (
            <Button
              key={q}
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setAmount(String(q))}
            >
              {usd(q)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border p-3">
        <Row
          k="Estimated shares"
          v={
            <span className="num">
              {est.data ? num(Number(est.data.expectedShares) / 1e6) : "—"}
            </span>
          }
        />
        <Row k="Share price" v={<span className="num">{fmtPrice(d.sharePriceLive)}</span>} />
        <Row
          k="Entry fee"
          v={<span className="num">{(d.fees.entryFeeBps / 100).toFixed(2)}%</span>}
        />
        {legs.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Swap breakdown ({legs.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1">
              {legs.map((l) => (
                <li key={l.mint} className="flex justify-between text-xs">
                  <span className="mono">{d.live.find((a) => a.mint === l.mint)?.symbol}</span>
                  <span className="num text-muted-foreground">{usd(Number(l.usdcIn) / 1e6)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {progress ? (
        <Stepper label={stepLabel(progress.step)} done={progress.done} total={progress.total} />
      ) : null}
      {!w.signer ? (
        <Button size="lg" className="h-11" onClick={onConnect}>
          Connect wallet
        </Button>
      ) : d.paused ? (
        <Button size="lg" className="h-11" disabled>
          Index is paused
        </Button>
      ) : noSol ? (
        <Button
          size="lg"
          className="h-11"
          variant="outline"
          onClick={() => (window.location.href = "/faucet")}
        >
          Get SOL for fees
        </Button>
      ) : insufficient ? (
        <Button
          size="lg"
          className="h-11"
          variant="outline"
          onClick={() => (window.location.href = "/faucet")}
        >
          Not enough USDC — open faucet
        </Button>
      ) : (
        <Button
          size="lg"
          className="h-11"
          disabled={!valid || busy || !usdcMint || tooSmall || !est.data}
          onClick={() => void submit()}
          data-testid="join-submit"
        >
          {busy ? "Confirm in wallet…" : `Join with ${usd(valid ? value : 0)}`}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Swaps USDC into each asset at oracle prices (
        {((cfg.data?.params.spreadBps ?? 30) / 100).toFixed(1)}% spread), then deposits. You approve
        each transaction: the swaps, then the deposit.
        {noSol && cost.data
          ? ` Needs about ${num(needSol, 3)} SOL for fees${cost.data.missingAccounts ? ` and ${cost.data.missingAccounts} new token accounts` : ""}.`
          : ""}
      </p>
    </div>
  );
}

function RedeemTab({ d, onConnect }: { d: IndexDetail; onConnect: () => void }) {
  const w = useWallet();
  const cfg = useConfig();
  const shares = useShareBalance(w.address, d.shareMint);
  const [amount, setAmount] = useState("");
  const [toUsdc, setToUsdc] = useState(true);
  const { run, busy, progress } = useRun();
  const usdcMint = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint as Address | undefined;
  const recover = useZapRecovery(run, usdcMint);
  const held = shares.data ?? 0n;
  const raw = toRaw(amount, DECIMALS) ?? 0n;
  const valid = raw > 0n && raw <= held;
  const est = useQuery({
    queryKey: ["zapout", d.pubkey, raw.toString()],
    enabled: valid && !!usdcMint,
    queryFn: async () =>
      planZapOut(chain(), await fetchIndex(chain(), d.pubkey as Address), usdcMint as Address, raw),
  });
  const nothingOut = !!est.data && est.data.amounts.every((a) => a === 0n);
  const hint =
    amount && raw === 0n
      ? "Enter an amount greater than zero."
      : raw > held
        ? "You do not hold that many shares."
        : nothingOut
          ? "This amount is too small to redeem any assets."
          : null;
  const submit = () =>
    run(
      `Redeem ${d.symbol}`,
      (onProgress) =>
        zapOut(
          chain(),
          w.signer as NonNullable<typeof w.signer>,
          d.pubkey as Address,
          usdcMint as Address,
          raw,
          {
            toUsdc,
            lookupTable: d.lookupTable as Address | null,
            onProgress,
          },
        ),
      undefined,
      { recover },
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Label htmlFor="redeem-amount">Shares</Label>
          {shares.data !== undefined ? (
            <button
              type="button"
              className="num hover:text-foreground"
              onClick={() => setAmount(fromRaw(held))}
            >
              Max {num(Number(held) / 1e6)}
            </button>
          ) : null}
        </div>
        <Input
          id="redeem-amount"
          inputMode="decimal"
          className="num h-11 text-lg"
          value={amount}
          placeholder="0"
          onChange={(e) => setAmount(cleanAmount(e.target.value))}
          aria-invalid={!!hint}
          data-testid="redeem-amount"
        />
        {hint ? <p className="text-xs text-destructive">{hint}</p> : null}
      </div>
      <div className="flex items-center justify-between rounded-2xl border p-3">
        <Label htmlFor="to-usdc" className="text-sm">
          Receive USDC
        </Label>
        <Switch id="to-usdc" checked={toUsdc} onCheckedChange={setToUsdc} />
      </div>
      <div className="flex flex-col gap-2 rounded-2xl border p-3">
        <Row
          k={toUsdc ? "Estimated USDC" : "Estimated value"}
          v={
            <span className="num">{est.data ? usd(Number(est.data.expectedUsdc) / 1e6) : "—"}</span>
          }
        />
        <Row
          k="Exit fee"
          v={<span className="num">{(d.fees.exitFeeBps / 100).toFixed(2)}%</span>}
        />
        {!toUsdc && est.data ? (
          <ul className="flex flex-col gap-1">
            {d.live.map((a, i) => (
              <li key={a.mint} className="flex justify-between text-xs">
                <span className="mono">{a.symbol}</span>
                <span className="num text-muted-foreground">
                  {num(Number(est.data.amounts[i] ?? 0n) / 10 ** a.decimals, 4)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {progress ? (
        <Stepper label={stepLabel(progress.step)} done={progress.done} total={progress.total} />
      ) : null}
      {!w.signer ? (
        <Button size="lg" className="h-11" onClick={onConnect}>
          Connect wallet
        </Button>
      ) : held === 0n ? (
        <Button size="lg" className="h-11" disabled>
          You hold no shares
        </Button>
      ) : (
        <Button
          size="lg"
          className="h-11"
          disabled={!valid || busy || nothingOut || !usdcMint}
          onClick={() => void submit()}
          data-testid="redeem-submit"
        >
          {busy ? "Confirm in wallet…" : "Redeem"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Redeem works even when the index is paused. It is briefly unavailable only while a rebalance
        is running.
      </p>
    </div>
  );
}

export function TradePanel({ d, onConnect }: { d: IndexDetail; onConnect: () => void }) {
  const w = useWallet();
  const shares = useShareBalance(w.address, d.shareMint);
  const ui = Number(shares.data ?? 0n) / 1e6;
  return (
    <div className="flex flex-col gap-4">
      {shares.data ? (
        <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Your position</span>
          <span className="num">
            {num(ui)} · {usd(ui * d.sharePriceLive)}
          </span>
        </div>
      ) : null}
      <Tabs defaultValue="join">
        <TabsList variant="line" className="w-full justify-start gap-4">
          <TabsTrigger value="join" className="flex-1">
            Join
          </TabsTrigger>
          <TabsTrigger value="redeem" className="flex-1">
            Redeem
          </TabsTrigger>
        </TabsList>
        <TabsContent value="join" className="pt-3">
          <JoinTab d={d} onConnect={onConnect} />
        </TabsContent>
        <TabsContent value="redeem" className="pt-3">
          <RedeemTab d={d} onConnect={onConnect} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
