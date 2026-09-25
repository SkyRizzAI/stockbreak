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
import { type Address, isAddress } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { UserLink } from "@/components/data/addr";
import { DecimalInput } from "@/components/data/decimal-input";
import { TickerMono } from "@/components/data/glyph";
import { ErrorState, KV, RowsSkeleton, Section } from "@/components/data/states";
import { openConnect } from "@/components/shell/wallet-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { bps, duration, num, short, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import type { IndexDetail, StrategyModeName } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { pendingLines, useChainNow } from "./pending-update";
import { RebalanceNow } from "./rebalance-now";

/** Program limits (anchor/programs/index_vault/src/constants.rs), in percent. */
const LIMITS = {
  mgmt: 5,
  entry: 1,
  exit: 1,
  slipMin: 0.5,
  slipMax: 5,
  driftMax: 50, // program allows ≤ 100%; above 50% the rule is meaningless
  periodMaxDays: 365,
  cooldownMaxMin: 30 * 24 * 60,
} as const;
const DEFAULT_PUBKEY = "11111111111111111111111111111111";
const MODE_LABEL: Record<StrategyModeName, string> = {
  Manual: "Hold (manual)",
  Threshold: "Rebalance on drift",
  Periodic: "Periodic",
};
const MODE = {
  Manual: vault.StrategyMode.Manual,
  Threshold: vault.StrategyMode.Threshold,
  Periodic: vault.StrategyMode.Periodic,
};

function Pending({ d }: { d: IndexDetail }) {
  const w = useWallet();
  const { run, busy } = useRun();
  const now = useChainNow(d.chainNow);
  if (!d.pending) return <p className="text-sm text-muted-foreground">No pending update.</p>;
  const left = d.pending.eta - now;
  const ready = left <= 0;
  // apply_update rejects dropping an asset the vault still holds (AssetStillFunded).
  const next = d.pending.assets ? new Set(d.pending.assets.map((a) => a.mint)) : null;
  const stranded = next ? d.live.filter((a) => BigInt(a.balance) > 0n && !next.has(a.mint)) : [];
  const blocked = stranded.length > 0;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Scheduled update</span>
        <span className={cn("num text-sm", ready ? "text-up" : "text-warn")} data-testid="timelock">
          {ready ? "Ready to apply" : `Timelock ${duration(left)}`}
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {pendingLines(d.pending).map((l) => (
          <li key={l.label} className="flex flex-wrap gap-x-2">
            <span className="text-muted-foreground">{l.label}:</span>
            <span className="num">{l.value}</span>
          </li>
        ))}
      </ul>
      {blocked ? (
        <Alert>
          <TriangleAlert className="text-warn" />
          <AlertTitle>This update can no longer be applied</AlertTitle>
          <AlertDescription>
            The vault now holds {stranded.map((a) => a.symbol).join(", ")}, which this update
            removes. Cancel and re-propose with {stranded.map((a) => a.symbol).join(", ")} at 0%.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button
          disabled={!ready || busy || !w.signer || blocked}
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
  const follower = d.followsParent;
  const [rows, setRows] = useState(
    d.live.map((a) => ({
      mint: a.mint,
      symbol: a.symbol,
      weight: a.targetWeightBps / 100,
      funded: BigInt(a.balance) > 0n,
      added: false,
    })),
  );
  const [mgmt, setMgmt] = useState(d.fees.mgmtFeeBps / 100);
  const [entry, setEntry] = useState(d.fees.entryFeeBps / 100);
  const [exit, setExit] = useState(d.fees.exitFeeBps / 100);
  const [mode, setMode] = useState<StrategyModeName>(d.strategy.mode);
  const [drift, setDrift] = useState(d.strategy.driftThresholdBps / 100 || 5);
  const [periodDays, setPeriodDays] = useState(d.strategy.periodSecs / 86400 || 7);
  const [cooldownMin, setCooldownMin] = useState(d.strategy.cooldownSecs / 60);
  const [slip, setSlip] = useState(d.strategy.maxSlippageBps / 100);
  const [keeper, setKeeper] = useState(d.strategy.allowKeeper);
  const [add, setAdd] = useState("");
  const [confirming, setConfirming] = useState(false);

  const total = Math.round(rows.reduce((a, r) => a + r.weight, 0) * 100) / 100;
  const weightsChanged =
    !follower &&
    (rows.length !== d.live.length ||
      rows.some(
        (r, i) =>
          Math.round(r.weight * 100) !== d.live[i]?.targetWeightBps || r.mint !== d.live[i]?.mint,
      ));
  const fees = {
    mgmtFeeBps: Math.round(mgmt * 100),
    entryFeeBps: Math.round(entry * 100),
    exitFeeBps: Math.round(exit * 100),
  };
  const feesChanged =
    fees.mgmtFeeBps !== d.fees.mgmtFeeBps ||
    fees.entryFeeBps !== d.fees.entryFeeBps ||
    fees.exitFeeBps !== d.fees.exitFeeBps;
  const strategy = {
    mode: MODE[mode],
    driftThresholdBps:
      mode === "Threshold" ? Math.round(drift * 100) : d.strategy.driftThresholdBps,
    periodSecs: mode === "Periodic" ? Math.round(periodDays * 86400) : d.strategy.periodSecs,
    maxSlippageBps: Math.round(slip * 100),
    cooldownSecs: Math.round(cooldownMin * 60),
    allowKeeper: keeper,
  };
  const stratChanged =
    mode !== d.strategy.mode ||
    strategy.driftThresholdBps !== d.strategy.driftThresholdBps ||
    strategy.periodSecs !== d.strategy.periodSecs ||
    strategy.maxSlippageBps !== d.strategy.maxSlippageBps ||
    strategy.cooldownSecs !== d.strategy.cooldownSecs ||
    keeper !== d.strategy.allowKeeper;
  // Fee-only decreases skip the timelock and leave any pending update untouched.
  const immediateCut =
    feesChanged &&
    !weightsChanged &&
    !stratChanged &&
    fees.mgmtFeeBps <= d.fees.mgmtFeeBps &&
    fees.entryFeeBps <= d.fees.entryFeeBps &&
    fees.exitFeeBps <= d.fees.exitFeeBps;
  const replaces = !!d.pending && !immediateCut;

  const errors = {
    mgmt: mgmt > LIMITS.mgmt ? `At most ${LIMITS.mgmt}%` : null,
    entry: entry > LIMITS.entry ? `At most ${LIMITS.entry}%` : null,
    exit: exit > LIMITS.exit ? `At most ${LIMITS.exit}%` : null,
    slip:
      slip < LIMITS.slipMin || slip > LIMITS.slipMax
        ? `Between ${LIMITS.slipMin}% and ${LIMITS.slipMax}%`
        : null,
    drift:
      mode === "Threshold" && (drift <= 0 || drift > LIMITS.driftMax)
        ? `Above 0% and at most ${LIMITS.driftMax}%`
        : null,
    period:
      mode === "Periodic" && (periodDays <= 0 || periodDays > LIMITS.periodMaxDays)
        ? `Above 0 and at most ${LIMITS.periodMaxDays} days`
        : null,
    cooldown: cooldownMin > LIMITS.cooldownMaxMin ? "At most 30 days" : null,
  };
  const fieldsOk = Object.values(errors).every((e) => e === null);
  const weightsOk = !weightsChanged || Math.abs(total - 100) < 0.005;
  const zeroAdded = rows.filter((r) => r.added && r.weight <= 0);
  const valid = fieldsOk && weightsOk;
  const changed = weightsChanged || feesChanged || stratChanged;

  const candidates = (cfg.data?.assets ?? []).filter(
    (a) => a.listed && !a.benchmark && !rows.some((r) => r.mint === a.mint),
  );
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
        fees: feesChanged ? fees : undefined,
        strategy: stratChanged ? strategy : undefined,
      });
      return { signature: await sendTx(chain(), s, [ix]) };
    });
  const onPropose = () => {
    if (replaces && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void submit();
  };
  const followers = d.children.filter((c) => c.followsParent).length;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Target weights</span>
          {follower ? null : (
            <span
              className={cn(
                "num text-sm",
                Math.abs(total - 100) < 0.005 ? "text-muted-foreground" : "text-warn",
              )}
            >
              Total {total.toFixed(2)}%
            </span>
          )}
        </div>
        {follower ? (
          <>
            <p className="text-sm text-muted-foreground">
              This index follows {d.parentSymbol ?? (d.parent ? short(d.parent) : "its parent")}, so
              its weights sync automatically. Fees and strategy can still be changed.
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {d.live.map((a) => (
                <li key={a.mint} className="flex items-center gap-2">
                  <span className="mono">{a.symbol}</span>
                  <span className="num text-muted-foreground">{bps(a.targetWeightBps)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.mint} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <TickerMono symbol={r.symbol} />
                  <span className="mono flex-1 text-sm">{r.symbol}</span>
                  <DecimalInput
                    aria-label={`${r.symbol} target`}
                    className="num h-9 w-20 text-right"
                    value={r.weight}
                    onCommit={(v) =>
                      setRows((rs) =>
                        rs.map((x) =>
                          x.mint === r.mint ? { ...x, weight: Math.min(100, Math.max(0, v)) } : x,
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
                    title={
                      r.funded
                        ? "Set to 0%, apply, then use Rebalance now before removing"
                        : "Remove"
                    }
                    onClick={() => setRows((rs) => rs.filter((x) => x.mint !== r.mint))}
                  >
                    Remove
                  </Button>
                </div>
                {r.added && r.weight <= 0 ? (
                  <span className="text-xs text-warn">
                    Set a weight above 0%, or {r.symbol} is dropped when the update applies.
                  </span>
                ) : null}
              </div>
            ))}
            {!weightsOk ? (
              <span className="text-xs text-warn">Target weights must add up to 100%.</span>
            ) : null}
            {candidates.length && rows.length < 10 ? (
              <div className="flex gap-2">
                <Select value={add} onValueChange={(v) => setAdd(String(v ?? ""))}>
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
                        { mint: c.mint, symbol: c.symbol, weight: 0, funded: false, added: true },
                      ]);
                    setAdd("");
                  }}
                >
                  Add
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label="Mgmt fee %/yr" value={mgmt} onChange={setMgmt} error={errors.mgmt} />
        <NumField label="Entry fee %" value={entry} onChange={setEntry} error={errors.entry} />
        <NumField label="Exit fee %" value={exit} onChange={setExit} error={errors.exit} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Rebalancing</Label>
          <Select
            value={mode}
            onValueChange={(v) => {
              if (v === "Manual" || v === "Threshold" || v === "Periodic") setMode(v);
            }}
          >
            <SelectTrigger className="h-9 w-full" aria-label="Rebalancing">
              <SelectValue>{MODE_LABEL[mode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABEL) as StrategyModeName[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {mode === "Threshold" ? (
          <NumField
            label="Drift threshold %"
            value={drift}
            onChange={setDrift}
            error={errors.drift}
          />
        ) : null}
        {mode === "Periodic" ? (
          <NumField
            label="Period (days)"
            value={periodDays}
            onChange={setPeriodDays}
            error={errors.period}
          />
        ) : null}
        <NumField label="Max slippage %" value={slip} onChange={setSlip} error={errors.slip} />
        <NumField
          label="Cooldown (minutes)"
          value={cooldownMin}
          onChange={setCooldownMin}
          error={errors.cooldown}
        />
        <div className="flex items-end justify-between gap-2 pb-2">
          <Label htmlFor="pkeeper">Allow keeper</Label>
          <Switch id="pkeeper" checked={keeper} onCheckedChange={setKeeper} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {immediateCut
          ? "This is a fee cut only: it applies immediately, without the timelock."
          : `Changes wait for the timelock (${d.timelockSecs ? duration(d.timelockSecs) : "none"}), then anyone can apply them. Fee-only cuts apply immediately.`}
        {followers && weightsChanged
          ? ` ${followers} follower ${followers === 1 ? "index syncs" : "indexes sync"} to the new weights after they apply.`
          : ""}
      </p>

      {replaces ? (
        <Alert>
          <TriangleAlert className="text-warn" />
          <AlertTitle>A scheduled update exists</AlertTitle>
          <AlertDescription>
            This replaces the scheduled update and restarts the timelock.
          </AlertDescription>
        </Alert>
      ) : null}
      {zeroAdded.length ? (
        <span className="text-xs text-warn">
          {zeroAdded.map((r) => r.symbol).join(", ")} at 0% will not be added.
        </span>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !valid || !changed || !w.signer}
          onClick={onPropose}
          data-testid="propose-update"
        >
          {confirming ? "Replace scheduled update" : "Propose update"}
        </Button>
        {confirming ? (
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep the scheduled one
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <DecimalInput
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className="num h-9"
        value={value}
        onCommit={onChange}
      />
      {error ? <span className="text-xs text-warn">{error}</span> : null}
    </div>
  );
}

function Managers({ d }: { d: IndexDetail }) {
  const w = useWallet();
  const { run, busy } = useRun();
  const [addr, setAddr] = useState("");
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<{ wallet: string; handle: string | null; agentName: string | null }[]>("/api/agents"),
  });
  const suggested = (agents.data ?? []).filter(
    (a) => a.wallet !== d.creator && !d.managers.some((m) => m.wallet === a.wallet),
  );
  const error =
    addr === ""
      ? null
      : !isAddress(addr) || addr === DEFAULT_PUBKEY
        ? "Enter a valid Solana address."
        : d.managers.some((m) => m.wallet === addr)
          ? "Already a manager."
          : null;
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
        <ul className="divide-y rounded-2xl border text-sm">
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
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Input
              value={addr}
              onChange={(e) => setAddr(e.target.value.trim())}
              placeholder="Manager wallet address"
              className="num"
              aria-invalid={error ? true : undefined}
              data-testid="manager-input"
            />
            <Button
              disabled={busy || addr === "" || error !== null}
              onClick={() =>
                void set([...d.managers.map((m) => m.wallet), addr]).then((r) => {
                  if (r) setAddr("");
                })
              }
              data-testid="manager-add"
            >
              Add
            </Button>
          </div>
          {error ? <span className="text-xs text-warn">{error}</span> : null}
          {suggested.length ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <span>Registered AI agents:</span>
              {suggested.map((a) => (
                <Button
                  key={a.wallet}
                  variant="outline"
                  size="xs"
                  onClick={() => setAddr(a.wallet)}
                  data-testid="manager-agent-suggest"
                >
                  {a.agentName ?? (a.handle ? `@${a.handle}` : short(a.wallet))}
                </Button>
              ))}
            </div>
          ) : null}
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
      <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
        <RowsSkeleton rows={6} />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
        <ErrorState message="Index not found." onRetry={() => void q.refetch()} />
      </div>
    );
  const d = q.data;
  if (!w.address)
    return (
      <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-3 px-4 py-10 md:px-8">
        <p className="text-sm text-muted-foreground">
          Connect the creator wallet to manage {d.name}.
        </p>
        <Button onClick={openConnect}>Connect wallet</Button>
      </div>
    );
  if (w.address !== d.creator)
    return (
      <div className="mx-auto flex max-w-[1280px] flex-col items-start gap-3 px-4 py-10 md:px-8">
        <p className="text-sm text-muted-foreground">Only the creator can manage this index.</p>
        <Link href={`/i/${d.pubkey}`} className="text-sm underline">
          Back to {d.name}
        </Link>
      </div>
    );
  const owed = Number(d.owed.creator) / 1e6;
  const signer = w.signer as NonNullable<typeof w.signer>;
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1">
        <Link
          href={`/i/${d.pubkey}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {d.name}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Manage</h1>
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

      <Section title="Rebalance">
        <RebalanceNow d={d} signer={signer} />
      </Section>

      <Section title="Scheduled update">
        <Pending d={d} />
      </Section>

      <Section title="Propose an update">
        <Propose
          key={JSON.stringify([
            d.live.map((a) => [a.mint, a.targetWeightBps]),
            d.fees,
            d.strategy,
            d.pending,
          ])}
          d={d}
        />
      </Section>

      <Section title="Managers & AI agents">
        <p className="text-sm text-muted-foreground">
          A manager (a person or an{" "}
          <Link href="/agents" className="underline underline-offset-2">
            AI agent
          </Link>
          ) can rebalance within your mandate and propose weight changes, which wait out the
          timelock. The vault program never lets a manager withdraw funds. Remove it here any time.
        </p>
        <Managers d={d} />
      </Section>

      <Section title="Status">
        <div className="flex items-center justify-between rounded-2xl border p-3">
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
