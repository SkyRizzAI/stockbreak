"use client";
import {
  accrueFeesIx,
  applyUpdateIx,
  cancelUpdateIx,
  claimFeesIxs,
  fetchIndex,
  proposeUpdateIx,
  sendTx,
  setManagersIx,
  setPausedIx,
  vault,
} from "@repo/sdk";
import type { Address } from "@solana/kit";
import { cn } from "cn";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserLink } from "@/components/data/addr";
import { TickerMono } from "@/components/data/glyph";
import { ErrorState, KV, RowsSkeleton, Section } from "@/components/data/states";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, useConfig, useIndex } from "@/lib/api";
import { signedPayload } from "@/lib/auth";
import { bps, duration, num, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import type { IndexDetail } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

function useNow(chainNow: number) {
  const [offset] = useState(() => chainNow - Math.floor(Date.now() / 1000));
  const [now, setNow] = useState(chainNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

function Pending({ d }: { d: IndexDetail }) {
  const w = useWallet();
  const { run, busy } = useRun();
  const now = useNow(d.chainNow);
  if (!d.pending) return <p className="text-sm text-muted-foreground">No pending update.</p>;
  const left = d.pending.eta - now;
  const ready = left <= 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Scheduled update</span>
        <span className={cn("num text-sm", ready ? "text-up" : "text-warn")} data-testid="timelock">
          {ready ? "Ready to apply" : `Timelock ${duration(left)}`}
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {d.pending.assets ? (
          <li className="flex flex-wrap gap-2">
            <span className="text-muted-foreground">Weights:</span>
            {d.pending.assets.map((a) => (
              <span key={a.mint} className="num">
                {a.symbol} {bps(a.targetWeightBps)}
              </span>
            ))}
          </li>
        ) : null}
        {d.pending.fees ? (
          <li>
            <span className="text-muted-foreground">Fees:</span>{" "}
            <span className="num">
              mgmt {bps(d.pending.fees.mgmtFeeBps)}, entry {bps(d.pending.fees.entryFeeBps)}, exit{" "}
              {bps(d.pending.fees.exitFeeBps)}
            </span>
          </li>
        ) : null}
        {d.pending.strategy ? (
          <li>
            <span className="text-muted-foreground">Strategy:</span> {d.pending.strategy.mode},
            drift {bps(d.pending.strategy.driftThresholdBps)}, slippage{" "}
            {bps(d.pending.strategy.maxSlippageBps)}
          </li>
        ) : null}
      </ul>
      <div className="flex gap-2">
        <Button
          disabled={!ready || busy || !w.signer}
          onClick={() =>
            void run("Apply update", async () => {
              const s = w.signer as NonNullable<typeof w.signer>;
              const st = await fetchIndex(chain(), d.pubkey as Address);
              return {
                signature: await sendTx(chain(), s, [
                  await applyUpdateIx(s, d.pubkey as Address, st),
                ]),
              };
            })
          }
          data-testid="apply-update"
        >
          Apply
        </Button>
        <Button
          variant="outline"
          disabled={busy || !w.signer}
          onClick={() =>
            void run("Cancel update", async () => {
              const s = w.signer as NonNullable<typeof w.signer>;
              return {
                signature: await sendTx(chain(), s, [await cancelUpdateIx(s, d.pubkey as Address)]),
              };
            })
          }
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Propose({ d }: { d: IndexDetail }) {
  const w = useWallet();
  const cfg = useConfig();
  const { run, busy } = useRun();
  const [rows, setRows] = useState(
    d.live.map((a) => ({
      mint: a.mint,
      symbol: a.symbol,
      weight: a.targetWeightBps / 100,
      funded: BigInt(a.balance) > 0n,
    })),
  );
  const [mgmt, setMgmt] = useState(d.fees.mgmtFeeBps / 100);
  const [entry, setEntry] = useState(d.fees.entryFeeBps / 100);
  const [exit, setExit] = useState(d.fees.exitFeeBps / 100);
  const [drift, setDrift] = useState(d.strategy.driftThresholdBps / 100);
  const [slip, setSlip] = useState(d.strategy.maxSlippageBps / 100);
  const [keeper, setKeeper] = useState(d.strategy.allowKeeper);
  const [add, setAdd] = useState("");
  const total = Math.round(rows.reduce((a, r) => a + r.weight, 0) * 100) / 100;
  const weightsChanged =
    rows.length !== d.live.length ||
    rows.some(
      (r, i) =>
        Math.round(r.weight * 100) !== d.live[i]?.targetWeightBps || r.mint !== d.live[i]?.mint,
    );
  const feesChanged =
    Math.round(mgmt * 100) !== d.fees.mgmtFeeBps ||
    Math.round(entry * 100) !== d.fees.entryFeeBps ||
    Math.round(exit * 100) !== d.fees.exitFeeBps;
  const stratChanged =
    Math.round(drift * 100) !== d.strategy.driftThresholdBps ||
    Math.round(slip * 100) !== d.strategy.maxSlippageBps ||
    keeper !== d.strategy.allowKeeper;
  const valid = !weightsChanged || Math.abs(total - 100) < 0.005;
  const candidates = (cfg.data?.assets ?? []).filter(
    (a) => a.listed && !a.benchmark && !rows.some((r) => r.mint === a.mint),
  );
  const MODE = {
    Manual: vault.StrategyMode.Manual,
    Threshold: vault.StrategyMode.Threshold,
    Periodic: vault.StrategyMode.Periodic,
  };
  const submit = () =>
    run("Propose update", async () => {
      const s = w.signer as NonNullable<typeof w.signer>;
      const st = await fetchIndex(chain(), d.pubkey as Address);
      const assets = weightsChanged
        ? rows.map((r) => ({ mint: r.mint as Address, weightBps: Math.round(r.weight * 100) }))
        : undefined;
      if (assets) {
        const diff = 10_000 - assets.reduce((a, x) => a + x.weightBps, 0);
        const first = assets.find((a) => a.weightBps > 0);
        if (first) first.weightBps += diff;
      }
      const ix = await proposeUpdateIx(s, d.pubkey as Address, st, {
        assets,
        fees: feesChanged
          ? {
              mgmtFeeBps: Math.round(mgmt * 100),
              entryFeeBps: Math.round(entry * 100),
              exitFeeBps: Math.round(exit * 100),
            }
          : undefined,
        strategy: stratChanged
          ? {
              mode: MODE[d.strategy.mode],
              driftThresholdBps: Math.round(drift * 100),
              periodSecs: d.strategy.periodSecs,
              maxSlippageBps: Math.round(slip * 100),
              cooldownSecs: d.strategy.cooldownSecs,
              allowKeeper: keeper,
            }
          : undefined,
      });
      return { signature: await sendTx(chain(), s, [ix]) };
    });
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Target weights</span>
          <span
            className={cn(
              "num text-sm",
              Math.abs(total - 100) < 0.005 ? "text-muted-foreground" : "text-warn",
            )}
          >
            Total {total.toFixed(2)}%
          </span>
        </div>
        {rows.map((r) => (
          <div key={r.mint} className="flex items-center gap-2">
            <TickerMono symbol={r.symbol} />
            <span className="num flex-1 text-sm">{r.symbol}</span>
            <Input
              aria-label={`${r.symbol} target`}
              className="num h-9 w-20 text-right"
              value={String(r.weight)}
              onChange={(e) =>
                setRows((rs) =>
                  rs.map((x) =>
                    x.mint === r.mint
                      ? { ...x, weight: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 }
                      : x,
                  ),
                )
              }
              data-testid={`target-${r.symbol}`}
            />
            <span className="text-sm text-muted-foreground">%</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={r.funded}
              title={r.funded ? "Set to 0% and rebalance before removing" : "Remove"}
              onClick={() => setRows((rs) => rs.filter((x) => x.mint !== r.mint))}
            >
              Remove
            </Button>
          </div>
        ))}
        {candidates.length && rows.length < 10 ? (
          <div className="flex gap-2">
            <Select value={add} onValueChange={(v) => setAdd(String(v))}>
              <SelectTrigger className="h-9 w-48" aria-label="Add asset">
                <SelectValue>
                  {add ? candidates.find((c) => c.mint === add)?.symbol : "Add asset"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.mint} value={c.mint}>
                    {c.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!add}
              onClick={() => {
                const c = candidates.find((x) => x.mint === add);
                if (c)
                  setRows((rs) => [
                    ...rs,
                    { mint: c.mint, symbol: c.symbol, weight: 0, funded: false },
                  ]);
                setAdd("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label="Mgmt fee %/yr" value={mgmt} onChange={setMgmt} />
        <NumField label="Entry fee %" value={entry} onChange={setEntry} />
        <NumField label="Exit fee %" value={exit} onChange={setExit} />
        {d.strategy.mode === "Threshold" ? (
          <NumField label="Drift threshold %" value={drift} onChange={setDrift} />
        ) : null}
        <NumField label="Max slippage %" value={slip} onChange={setSlip} />
        <div className="flex items-end justify-between gap-2 pb-2">
          <Label htmlFor="pkeeper">Allow keeper</Label>
          <Switch id="pkeeper" checked={keeper} onCheckedChange={setKeeper} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Changes wait for the timelock ({d.timelockSecs ? duration(d.timelockSecs) : "none"}). Fee
        cuts apply immediately. Followers sync automatically.
      </p>
      <Button
        disabled={busy || !valid || !(weightsChanged || feesChanged || stratChanged)}
        onClick={() => void submit()}
        data-testid="propose-update"
      >
        Propose update
      </Button>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        className="num h-9"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
      />
    </div>
  );
}

function Managers({ d }: { d: IndexDetail }) {
  const w = useWallet();
  const { run, busy } = useRun();
  const [addr, setAddr] = useState("");
  const set = (list: string[]) =>
    run("Update managers", async () => {
      const s = w.signer as NonNullable<typeof w.signer>;
      return {
        signature: await sendTx(chain(), s, [
          await setManagersIx(s, d.pubkey as Address, list as Address[]),
        ]),
      };
    });
  return (
    <div className="flex flex-col gap-3">
      {d.managers.length ? (
        <ul className="divide-y rounded-lg border text-sm">
          {d.managers.map((m) => (
            <li key={m.wallet} className="flex items-center justify-between px-3 py-2">
              <UserLink wallet={m.wallet} handle={m.handle} isAgent={m.isAgent} />
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void set(d.managers.filter((x) => x.wallet !== m.wallet).map((x) => x.wallet))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No managers.</p>
      )}
      {d.managers.length < 3 ? (
        <div className="flex gap-2">
          <Input
            value={addr}
            onChange={(e) => setAddr(e.target.value.trim())}
            placeholder="Manager wallet address"
            className="num"
            data-testid="manager-input"
          />
          <Button
            disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)}
            onClick={() =>
              void set([...d.managers.map((m) => m.wallet), addr]).then(() => setAddr(""))
            }
            data-testid="manager-add"
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ManageView({ pubkey }: { pubkey: string }) {
  const q = useIndex(pubkey);
  const w = useWallet();
  const { run, busy } = useRun();
  const [desc, setDesc] = useState<string | null>(null);
  const [thesis, setThesis] = useState<string | null>(null);
  if (q.isLoading)
    return (
      <div className="mx-auto max-w-[640px] px-4 py-6">
        <RowsSkeleton rows={6} />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-[640px] px-4 py-6">
        <ErrorState message="Index not found." onRetry={() => void q.refetch()} />
      </div>
    );
  const d = q.data;
  if (!w.address)
    return (
      <div className="mx-auto flex max-w-[640px] flex-col items-start gap-3 px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Connect the creator wallet to manage {d.name}.
        </p>
        <Button onClick={openConnect}>Connect wallet</Button>
      </div>
    );
  if (w.address !== d.creator)
    return (
      <div className="mx-auto flex max-w-[640px] flex-col items-start gap-3 px-4 py-10">
        <p className="text-sm text-muted-foreground">Only the creator can manage this index.</p>
        <Link href={`/i/${d.pubkey}`} className="text-sm underline">
          Back to {d.name}
        </Link>
      </div>
    );
  const owed = Number(d.owed.creator) / 1e6;
  const signer = w.signer as NonNullable<typeof w.signer>;
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/i/${d.pubkey}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {d.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Manage</h1>
      </div>

      <Section title="Creator fees">
        <KV
          rows={[
            [
              "Unclaimed",
              <span key="o" className="num">
                {num(owed)} shares · {usd(owed * d.sharePriceLive)}
              </span>,
            ],
            [
              "Management fee",
              <span key="m" className="num">
                {bps(d.fees.mgmtFeeBps)} / yr
              </span>,
            ],
          ]}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run("Accrue fees", async () => ({
                signature: await sendTx(chain(), signer, [
                  await accrueFeesIx(
                    d.pubkey as Address,
                    await fetchIndex(chain(), d.pubkey as Address),
                  ),
                ]),
              }))
            }
          >
            Refresh accrual
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run("Claim creator fees", async () => ({
                signature: await sendTx(
                  chain(),
                  signer,
                  await claimFeesIxs(
                    signer,
                    d.pubkey as Address,
                    await fetchIndex(chain(), d.pubkey as Address),
                    vault.FeeKind.Creator,
                  ),
                ),
              }))
            }
            data-testid="claim-creator"
          >
            Claim
          </Button>
        </div>
      </Section>

      <Section title="Scheduled update">
        <Pending d={d} />
      </Section>

      <Section title="Propose an update">
        <Propose
          key={JSON.stringify(d.live.map((a) => a.targetWeightBps)) + JSON.stringify(d.fees)}
          d={d}
        />
      </Section>

      <Section title="Managers">
        <Managers d={d} />
      </Section>

      <Section title="Status">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <span className="flex flex-col">
            <Label htmlFor="paused">Paused</Label>
            <span className="text-xs text-muted-foreground">
              Stops joins and rebalances. Redeem stays open.
            </span>
          </span>
          <Switch
            id="paused"
            checked={d.paused}
            disabled={busy}
            onCheckedChange={(v) =>
              void run(v ? "Pause" : "Unpause", async () => ({
                signature: await sendTx(chain(), signer, [
                  await setPausedIx(signer, d.pubkey as Address, v),
                ]),
              }))
            }
          />
        </div>
      </Section>

      <Section title="Description">
        <div className="flex flex-col gap-2">
          <Input
            value={desc ?? d.description ?? ""}
            maxLength={280}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="One line"
          />
          <Textarea
            value={thesis ?? d.thesis ?? ""}
            maxLength={1000}
            rows={3}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="Thesis"
          />
          <Button
            variant="outline"
            className="self-start"
            disabled={busy || (desc === null && thesis === null)}
            onClick={async () => {
              try {
                const auth = await signedPayload(w.address as string, "index-meta");
                await api(`/api/indexes/${d.pubkey}/meta`, {
                  method: "POST",
                  body: JSON.stringify({
                    description: desc ?? d.description,
                    thesis: thesis ?? d.thesis,
                    wallet: w.address,
                    ...auth,
                  }),
                });
                toast.success("Saved");
                void q.refetch();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save");
              }
            }}
          >
            Save
          </Button>
        </div>
      </Section>
    </div>
  );
}
