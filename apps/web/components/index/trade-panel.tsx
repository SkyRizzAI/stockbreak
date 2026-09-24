"use client";
import {
  ata,
  fetchIndex,
  fetchTokenBalances,
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
import { useConfig } from "@/lib/api";
import { price as fmtPrice, num, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import type { IndexDetail } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

const QUICK = [100, 1_000, 10_000];

function useShareBalance(address: string | null, shareMint: string) {
  return useQuery({
    queryKey: ["shares", address, shareMint],
    enabled: !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const a = await ata(address as Address, shareMint as Address, TOKEN_PROGRAM);
      return Number((await fetchTokenBalances(chain(), [a])).get(a) ?? 0n) / 1e6;
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
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= 1;
  const est = useQuery({
    queryKey: ["zapin", d.pubkey, amount, d.navLiveUsd],
    enabled: valid && !!usdcMint,
    queryFn: async () => {
      const st = await fetchIndex(chain(), d.pubkey as Address);
      return planZapIn(chain(), st, usdcMint as Address, BigInt(Math.round(value * 1e6)));
    },
  });
  const insufficient = !!bal.data && valid && value > bal.data.usdc;
  const noSol = !!bal.data && bal.data.sol < 0.01;
  const legs = est.data?.legs.filter((l) => l.usdcIn > 0n) ?? [];
  const submit = () =>
    run(
      `Join ${d.symbol}`,
      (onProgress) =>
        zapIn(
          chain(),
          w.signer as NonNullable<typeof w.signer>,
          d.pubkey as Address,
          usdcMint as Address,
          BigInt(Math.round(value * 1e6)),
          {
            lookupTable: d.lookupTable as Address | null,
            onProgress,
          },
        ),
      (r) => `Joined ${d.symbol}: ${num(Number(r.shares) / 1e6)} shares`,
    );
  return (
    <div className="flex flex-col gap-4">
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
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          data-testid="join-amount"
        />
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
      <div className="flex flex-col gap-2 rounded-lg border p-3">
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
                  <span className="num">{d.live.find((a) => a.mint === l.mint)?.symbol}</span>
                  <span className="num text-muted-foreground">{usd(Number(l.usdcIn) / 1e6)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {progress ? (
        <Stepper
          label={progress.step === "join" ? "Joining" : "Swapping USDC"}
          done={progress.done}
          total={progress.total}
        />
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
          disabled={!valid || busy || !usdcMint}
          onClick={() => void submit()}
          data-testid="join-submit"
        >
          {busy ? "Confirm in wallet…" : `Join with ${usd(valid ? value : 0)}`}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Swaps USDC into each asset at oracle prices (0.3% spread), then deposits. Needs{" "}
        {Math.max(1, legs.length > 2 ? 3 : 2)} signatures.
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
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= (shares.data ?? 0) + 1e-9;
  const raw = BigInt(Math.floor(value * 1e6));
  const est = useQuery({
    queryKey: ["zapout", d.pubkey, amount],
    enabled: valid && !!usdcMint,
    queryFn: async () =>
      planZapOut(chain(), await fetchIndex(chain(), d.pubkey as Address), usdcMint as Address, raw),
  });
  const submit = () =>
    run(`Redeem ${d.symbol}`, (onProgress) =>
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
              onClick={() => setAmount(String(shares.data))}
            >
              Max {num(shares.data)}
            </button>
          ) : null}
        </div>
        <Input
          id="redeem-amount"
          inputMode="decimal"
          className="num h-11 text-lg"
          value={amount}
          placeholder="0"
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          data-testid="redeem-amount"
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <Label htmlFor="to-usdc" className="text-sm">
          Receive USDC
        </Label>
        <Switch id="to-usdc" checked={toUsdc} onCheckedChange={setToUsdc} />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-3">
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
                <span className="num">{a.symbol}</span>
                <span className="num text-muted-foreground">
                  {num(Number(est.data.amounts[i] ?? 0n) / 10 ** a.decimals, 4)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {progress ? <Stepper label="Redeeming" done={progress.done} total={progress.total} /> : null}
      {!w.signer ? (
        <Button size="lg" className="h-11" onClick={onConnect}>
          Connect wallet
        </Button>
      ) : (shares.data ?? 0) === 0 ? (
        <Button size="lg" className="h-11" disabled>
          You hold no shares
        </Button>
      ) : (
        <Button
          size="lg"
          className="h-11"
          disabled={!valid || busy}
          onClick={() => void submit()}
          data-testid="redeem-submit"
        >
          {busy ? "Confirm in wallet…" : "Redeem"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Redeem is always available, even when the index is paused.
      </p>
    </div>
  );
}

export function TradePanel({ d, onConnect }: { d: IndexDetail; onConnect: () => void }) {
  const w = useWallet();
  const shares = useShareBalance(w.address, d.shareMint);
  return (
    <div className="flex flex-col gap-4">
      {shares.data ? (
        <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Your position</span>
          <span className="num">
            {num(shares.data)} · {usd(shares.data * d.sharePriceLive)}
          </span>
        </div>
      ) : null}
      <Tabs defaultValue="join">
        <TabsList className="w-full">
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
