"use client";
import { CAP_T } from "@repo/config";
import { createIndexFlow, nextIndexId, sendTx, setManagersIx, vault, zapIn } from "@repo/sdk";
import type { Address } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, Lock, LockOpen, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AllocationBar, AllocationLegend } from "@/components/data/allocation";
import { IndexGlyph, TickerMono } from "@/components/data/glyph";
import { Price } from "@/components/data/num";
import { SimulatedBadge } from "@/components/data/states";
import { openConnect, useBalances } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, useConfig, usePrices } from "@/lib/api";
import { signedPayload } from "@/lib/auth";
import { bps, duration, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import type { IndexDetail } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

type Mode = "Manual" | "Threshold" | "Periodic";
interface Pick {
  symbol: string;
  mint: string;
  weight: number; // percent, 2 decimals
  locked: boolean;
}

const STEPS = ["Assets", "Weights", "Strategy", "Fees", "Review"] as const;
const PRESETS: {
  id: string;
  label: string;
  hint: string;
  mode: Mode;
  drift: number;
  period: number;
  keeper: boolean;
}[] = [
  {
    id: "hold",
    label: "Hold",
    hint: "Never rebalanced automatically.",
    mode: "Manual",
    drift: 5,
    period: 0,
    keeper: false,
  },
  {
    id: "drift",
    label: "Rebalance on drift",
    hint: "Keeper rebalances when any weight is off by more than the threshold.",
    mode: "Threshold",
    drift: 5,
    period: 0,
    keeper: true,
  },
  {
    id: "periodic",
    label: "Periodic",
    hint: "Keeper rebalances on a fixed schedule.",
    mode: "Periodic",
    drift: 5,
    period: 7,
    keeper: true,
  },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const total = (ps: Pick[]) => round2(ps.reduce((a, p) => a + p.weight, 0));

function normalize(ps: Pick[]): Pick[] {
  const locked = ps.filter((p) => p.locked).reduce((a, p) => a + p.weight, 0);
  const free = ps.filter((p) => !p.locked);
  const freeSum = free.reduce((a, p) => a + p.weight, 0);
  const room = Math.max(0, 100 - locked);
  let out = ps.map((p) =>
    p.locked
      ? p
      : {
          ...p,
          weight: freeSum > 0 ? round2((p.weight / freeSum) * room) : round2(room / free.length),
        },
  );
  const diff = round2(100 - total(out));
  const i = out.findIndex((p) => !p.locked);
  if (diff !== 0 && i >= 0)
    out = out.map((p, j) => (j === i ? { ...p, weight: round2(p.weight + diff) } : p));
  return out;
}

function StepHeader({
  step,
  onStep,
  done,
}: {
  step: number;
  onStep: (n: number) => void;
  done: (n: number) => boolean;
}) {
  return (
    <ol className="flex gap-1 overflow-x-auto" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s}>
          <button
            type="button"
            disabled={i > step && !done(i - 1)}
            onClick={() => onStep(i)}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground disabled:opacity-50",
              i === step && "bg-muted text-foreground",
            )}
          >
            <span className="num flex size-5 items-center justify-center rounded-full border text-[11px]">
              {done(i) && i < step ? <Check className="size-3" /> : i + 1}
            </span>
            {/* Mobile: only the current step is labelled, so all five fit at 375px. */}
            <span className={cn(i !== step && "sr-only sm:not-sr-only")}>{s}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Client-only: the wizard hydrates late inside a Suspense boundary, after other
 * components may already have filled the query cache, so SSR output would not match.
 */
export function CreateWizard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <Skeleton className="h-96" />
      </div>
    );
  return <Wizard />;
}

function Wizard() {
  const sp = useSearchParams();
  const cloneOf = sp.get("clone");
  const router = useRouter();
  const cfg = useConfig();
  const prices = usePrices();
  const w = useWallet();
  const bal = useBalances(w.address);
  const { run, busy, progress } = useRun();
  const parent = useQuery({
    queryKey: ["index", cloneOf],
    enabled: !!cloneOf,
    queryFn: () => api<IndexDetail>(`/api/indexes/${cloneOf}`),
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<{ wallet: string; handle: string | null; agentName: string | null }[]>("/api/agents"),
  });

  const [step, setStep] = useState(0);
  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [preset, setPreset] = useState("drift");
  const [mode, setMode] = useState<Mode>("Threshold");
  const [drift, setDrift] = useState(5);
  const [periodDays, setPeriodDays] = useState(7);
  const [slippage, setSlippage] = useState(1);
  const [cooldownMin, setCooldownMin] = useState(1);
  const [keeper, setKeeper] = useState(true);
  const [mgmt, setMgmt] = useState(1);
  const [entry, setEntry] = useState(0);
  const [exit, setExit] = useState(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [thesis, setThesis] = useState("");
  const [manager, setManager] = useState("");
  const [follow, setFollow] = useState(false);
  const [deposit, setDeposit] = useState("1000");

  const assets = useMemo(
    () => (cfg.data?.assets ?? []).filter((a) => a.listed && !a.benchmark),
    [cfg.data],
  );
  const priceOf = (s: string) => prices.data?.find((p) => p.symbol === s)?.price ?? 0;

  // Prefill from a clone source.
  useEffect(() => {
    const p = parent.data;
    if (!p || picks.length) return;
    setPicks(
      p.assets
        .filter((a) => a.targetWeightBps > 0)
        .map((a) => ({
          symbol: a.symbol,
          mint: a.mint,
          weight: a.targetWeightBps / 100,
          locked: false,
        })),
    );
    setMode(p.strategy.mode);
    setPreset(
      p.strategy.mode === "Manual" ? "hold" : p.strategy.mode === "Periodic" ? "periodic" : "drift",
    );
    setDrift(p.strategy.driftThresholdBps / 100 || 5);
    setPeriodDays(Math.max(1, Math.round(p.strategy.periodSecs / 86400)) || 7);
    setSlippage(p.strategy.maxSlippageBps / 100);
    setKeeper(p.strategy.allowKeeper);
    setName(`${p.name} Remix`.slice(0, 32));
    setSymbol(`${p.symbol.slice(0, 7)}R`.toUpperCase());
    setDescription(`Clone of ${p.name}.`);
  }, [parent.data, picks.length]);

  const toggle = (a: { symbol: string; mint: string }) =>
    setPicks((ps) => {
      if (ps.some((p) => p.mint === a.mint))
        return normalize(ps.filter((p) => p.mint !== a.mint).map((p) => ({ ...p, locked: false })));
      if (ps.length >= 10) {
        toast.error("An index can hold at most 10 assets.");
        return ps;
      }
      // A new asset takes an equal share; existing weights shrink proportionally.
      return normalize([
        ...ps.map((p) => ({ ...p, locked: false })),
        { ...a, weight: ps.length ? 100 / ps.length : 100, locked: false },
      ]);
    });
  const setWeight = (mint: string, v: number) =>
    setPicks((ps) =>
      ps.map((p) =>
        p.mint === mint ? { ...p, weight: round2(Math.max(0, Math.min(100, v))) } : p,
      ),
    );
  const equal = () =>
    setPicks((ps) => normalize(ps.map((p) => ({ ...p, locked: false, weight: 1 }))));
  const capLike = () =>
    setPicks((ps) => {
      const caps = ps.map((p) => CAP_T[p.symbol] ?? 0.1);
      const s = caps.reduce((a, b) => a + b, 0);
      return normalize(
        ps.map((p, i) => ({ ...p, locked: false, weight: round2(((caps[i] ?? 0) / s) * 100) })),
      );
    });

  const sum = total(picks);
  const weightsOk =
    picks.length > 0 && Math.abs(sum - 100) < 0.005 && picks.every((p) => p.weight > 0);
  const nameOk = name.trim().length > 0 && name.length <= 32;
  const symbolOk = /^[A-Z0-9]{1,10}$/.test(symbol);
  const managerOk = manager === "" || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(manager);
  const depositNum = Number(deposit || "0");
  const done = (i: number) =>
    i === 0
      ? picks.length > 0
      : i === 1
        ? weightsOk
        : i === 2
          ? true
          : i === 3
            ? true
            : nameOk && symbolOk && managerOk;

  const toBps = (ps: Pick[]) => {
    const out = ps.map((p) => ({ mint: p.mint, weightBps: Math.round(p.weight * 100) }));
    const d = 10_000 - out.reduce((a, x) => a + x.weightBps, 0);
    if (out[0]) out[0].weightBps += d;
    return out;
  };

  const create = async () => {
    if (!w.signer || !w.address || !cfg.data) return;
    const usdc = cfg.data.assets.find((a) => a.symbol === "USDC")?.mint as Address;
    const signer = w.signer;
    const res = await run("Create index", async (onProgress) => {
      const c = chain();
      const r = await createIndexFlow(
        c,
        {
          creator: signer,
          indexId: await nextIndexId(c, signer.address),
          name: name.trim(),
          symbol,
          uri: `${window.location.origin}/api/meta/${symbol}`,
          assets: toBps(picks).map((a) => ({ mint: a.mint as Address, weightBps: a.weightBps })),
          fees: {
            mgmtFeeBps: Math.round(mgmt * 100),
            entryFeeBps: Math.round(entry * 100),
            exitFeeBps: Math.round(exit * 100),
          },
          strategy: {
            mode:
              mode === "Manual"
                ? vault.StrategyMode.Manual
                : mode === "Periodic"
                  ? vault.StrategyMode.Periodic
                  : vault.StrategyMode.Threshold,
            driftThresholdBps: Math.round(drift * 100),
            periodSecs: mode === "Periodic" ? Math.round(periodDays * 86400) : 0,
            maxSlippageBps: Math.round(slippage * 100),
            cooldownSecs: Math.round(cooldownMin * 60),
            allowKeeper: mode === "Manual" ? false : keeper,
          },
          parent: (cloneOf as Address | null) ?? null,
          followsParent: !!cloneOf && follow,
        },
        (p) =>
          onProgress({
            step: p.step,
            done: p.done,
            total: p.total + (depositNum > 0 ? 3 : 0),
            signature: p.signature,
          }),
      );
      if (manager)
        await sendTx(c, signer, [await setManagersIx(signer, r.index, [manager as Address])]);
      if (depositNum >= 1) {
        await zapIn(c, signer, r.index, usdc, BigInt(Math.round(depositNum * 1e6)), {
          lookupTable: r.lookupTable,
          onProgress: (p) =>
            onProgress({
              step: `deposit-${p.step}`,
              done: p.done,
              total: p.total,
              signature: p.signature,
            }),
        });
      }
      return r;
    });
    if (!res) return;
    if (description || thesis) {
      try {
        for (let i = 0; i < 20; i++) {
          const ok = await fetch(`/api/indexes/${res.index}`).then((x) => x.ok);
          if (ok) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        const auth = await signedPayload(w.address, "index-meta");
        await api(`/api/indexes/${res.index}/meta`, {
          method: "POST",
          body: JSON.stringify({
            description: description || null,
            thesis: thesis || null,
            wallet: w.address,
            ...auth,
          }),
        });
      } catch {
        toast.message("Index created. You can add a description later from Manage.");
      }
    }
    router.push(`/i/${res.index}`);
  };

  const filtered = assets.filter((a) =>
    `${a.symbol} ${a.name}`.toLowerCase().includes(q.toLowerCase()),
  );
  const presetDef = PRESETS.find((p) => p.id === preset);
  const revenue = (10_000 * mgmt) / 100;

  const preview = (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <IndexGlyph pubkey={`${name}${symbol}`} weights={picks.map((p) => p.weight)} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{name || "Untitled index"}</span>
          <span className="num text-xs text-muted-foreground">{symbol || "SYMBOL"}</span>
        </div>
        <SimulatedBadge className="ml-auto" />
      </div>
      {picks.length ? (
        <>
          <AllocationBar
            slices={picks.map((p) => ({ label: p.symbol, weightBps: p.weight * 100 }))}
          />
          <AllocationLegend
            slices={picks.map((p) => ({ label: p.symbol, weightBps: p.weight * 100 }))}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Pick assets to see the allocation.</p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <dt className="text-muted-foreground">Strategy</dt>
        <dd className="text-right">
          {mode === "Threshold"
            ? `Drift > ${drift}%`
            : mode === "Periodic"
              ? `Every ${periodDays}d`
              : "Hold"}
        </dd>
        <dt className="text-muted-foreground">Management fee</dt>
        <dd className="num text-right">{mgmt}% / yr</dd>
        <dt className="text-muted-foreground">Entry / exit</dt>
        <dd className="num text-right">
          {entry}% / {exit}%
        </dd>
        {cloneOf ? (
          <>
            <dt className="text-muted-foreground">Parent</dt>
            <dd className="text-right">
              {parent.data?.symbol ?? "…"}
              {follow ? " · follows" : ""}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );

  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-6 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {cloneOf ? `Clone ${parent.data?.name ?? "index"}` : "Create index"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick assets, set weights and rules. The vault program enforces them.
          </p>
        </div>
        <StepHeader step={step} onStep={setStep} done={done} />

        {step === 0 ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search assets"
                aria-label="Search assets"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-10 pl-8"
              />
            </div>
            <ul className="divide-y rounded-lg border" data-testid="asset-list">
              {filtered.map((a) => {
                const on = picks.some((p) => p.mint === a.mint);
                return (
                  <li key={a.mint}>
                    <button
                      type="button"
                      onClick={() => toggle(a)}
                      aria-pressed={on}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50",
                        on && "bg-muted/60",
                      )}
                      data-testid={`asset-${a.symbol}`}
                    >
                      <TickerMono symbol={a.symbol} />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="num text-sm">{a.symbol}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.name}
                          {a.kind === "PreIpo"
                            ? " · pre-IPO"
                            : a.kind === "Stable"
                              ? " · stable"
                              : ""}
                        </span>
                      </span>
                      <Price value={priceOf(a.symbol)} className="text-sm" />
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded border",
                          on && "border-foreground bg-foreground text-background",
                        )}
                      >
                        {on ? <Check className="size-3.5" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={equal}>
                Equal
              </Button>
              <Button variant="outline" size="sm" onClick={capLike}>
                Market-cap-like
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPicks((ps) => normalize(ps))}>
                Normalize
              </Button>
              <span
                className={cn(
                  "num ml-auto text-sm",
                  weightsOk ? "text-muted-foreground" : "text-warn",
                )}
                data-testid="weight-total"
              >
                Total {sum.toFixed(2)}%
              </span>
            </div>
            <ul className="flex flex-col gap-3">
              {picks.map((p) => (
                <li key={p.mint} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <TickerMono symbol={p.symbol} />
                    <span className="num flex-1 text-sm">{p.symbol}</span>
                    <Input
                      aria-label={`${p.symbol} weight`}
                      className="num h-9 w-20 text-right"
                      value={String(p.weight)}
                      onChange={(e) =>
                        setWeight(p.mint, Number(e.target.value.replace(/[^\d.]/g, "")) || 0)
                      }
                      data-testid={`weight-${p.symbol}`}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label={p.locked ? `Unlock ${p.symbol}` : `Lock ${p.symbol}`}
                      onClick={() =>
                        setPicks((ps) =>
                          ps.map((x) => (x.mint === p.mint ? { ...x, locked: !x.locked } : x)),
                        )
                      }
                    >
                      {p.locked ? <Lock /> : <LockOpen />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label={`Remove ${p.symbol}`}
                      onClick={() => toggle(p)}
                    >
                      <X />
                    </Button>
                  </div>
                  <Slider
                    value={[p.weight]}
                    min={0}
                    max={100}
                    step={0.5}
                    onValueChange={(v) => setWeight(p.mint, (v as number[])[0] ?? 0)}
                    aria-label={`${p.symbol} weight slider`}
                  />
                </li>
              ))}
            </ul>
            {!weightsOk ? (
              <p className="text-sm text-warn">
                Weights must add up to 100% and each must be above 0.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPreset(p.id);
                    setMode(p.mode);
                    setDrift(p.drift);
                    if (p.period) setPeriodDays(p.period);
                    setKeeper(p.keeper);
                  }}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-3 text-left",
                    preset === p.id && "border-foreground",
                  )}
                  aria-pressed={preset === p.id}
                >
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.hint}</span>
                </button>
              ))}
            </div>
            <details className="rounded-lg border p-3" open={presetDef?.id !== "hold"}>
              <summary className="cursor-pointer text-sm">Advanced</summary>
              <div className="mt-4 flex flex-col gap-5">
                {mode === "Threshold" ? (
                  <Field label="Drift threshold" value={`${drift}%`}>
                    <Slider
                      value={[drift]}
                      min={1}
                      max={20}
                      step={0.5}
                      onValueChange={(v) => setDrift((v as number[])[0] ?? 5)}
                      aria-label="Drift threshold"
                    />
                  </Field>
                ) : null}
                {mode === "Periodic" ? (
                  <Field label="Period" value={`${periodDays} days`}>
                    <Slider
                      value={[periodDays]}
                      min={1}
                      max={30}
                      step={1}
                      onValueChange={(v) => setPeriodDays((v as number[])[0] ?? 7)}
                      aria-label="Period"
                    />
                  </Field>
                ) : null}
                <Field label="Max slippage" value={`${slippage}%`}>
                  <Slider
                    value={[slippage]}
                    min={0.5}
                    max={5}
                    step={0.1}
                    onValueChange={(v) => setSlippage(round2((v as number[])[0] ?? 1))}
                    aria-label="Max slippage"
                  />
                </Field>
                <Field label="Cooldown" value={duration(cooldownMin * 60)}>
                  <Slider
                    value={[cooldownMin]}
                    min={0}
                    max={1440}
                    step={1}
                    onValueChange={(v) => setCooldownMin((v as number[])[0] ?? 1)}
                    aria-label="Cooldown"
                  />
                </Field>
                {mode !== "Manual" ? (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="keeper">Allow keeper</Label>
                    <Switch id="keeper" checked={keeper} onCheckedChange={setKeeper} />
                  </div>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-5 rounded-lg border p-4">
            <Field label="Management fee (to you)" value={`${mgmt}% / yr`}>
              <Slider
                value={[mgmt]}
                min={0}
                max={5}
                step={0.1}
                onValueChange={(v) => setMgmt(round2((v as number[])[0] ?? 0))}
                aria-label="Management fee"
              />
            </Field>
            <Field label="Entry fee" value={`${entry}%`}>
              <Slider
                value={[entry]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => setEntry(round2((v as number[])[0] ?? 0))}
                aria-label="Entry fee"
              />
            </Field>
            <Field label="Exit fee" value={`${exit}%`}>
              <Slider
                value={[exit]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => setExit(round2((v as number[])[0] ?? 0))}
                aria-label="Exit fee"
              />
            </Field>
            <div className="flex items-baseline justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Estimated income per $10k AUM</span>
              <span className="num">{usd(revenue)} / yr</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Platform fee {bps(cfg.data?.params.platformFeeBps ?? 100)} / yr applies on top.
              {cloneOf
                ? ` ${bps(cfg.data?.params.cloneRoyaltyBps ?? 1000, 0)} of your fee goes to the parent creator.`
                : ""}{" "}
              Fees are paid in index shares.
            </p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Name">
                <Input
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Chip Leaders"
                  data-testid="index-name"
                />
              </Field>
              <Field label="Symbol">
                <Input
                  value={symbol}
                  maxLength={10}
                  onChange={(e) =>
                    setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                  }
                  placeholder="e.g. CHIPS"
                  className="num"
                  data-testid="index-symbol"
                />
              </Field>
            </div>
            <Field label="Description" hint="One line, shown in lists and Blinks.">
              <Input
                value={description}
                maxLength={280}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Thesis" hint="Why this index.">
              <Textarea
                value={thesis}
                maxLength={1000}
                rows={3}
                onChange={(e) => setThesis(e.target.value)}
              />
            </Field>
            <Field
              label="Manager (optional)"
              hint="Can rebalance within your rules. Cannot withdraw or change the index."
            >
              <div className="flex flex-col gap-2">
                <Input
                  value={manager}
                  onChange={(e) => setManager(e.target.value.trim())}
                  placeholder="Wallet address"
                  className="num"
                />
                {agents.data?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {agents.data.map((a) => (
                      <Button
                        key={a.wallet}
                        variant="outline"
                        size="sm"
                        onClick={() => setManager(a.wallet)}
                      >
                        {a.agentName ?? a.handle ?? a.wallet.slice(0, 4)} (AI)
                      </Button>
                    ))}
                  </div>
                ) : null}
                {!managerOk ? (
                  <span className="text-xs text-warn">Enter a valid Solana address.</span>
                ) : null}
              </div>
            </Field>
            {cloneOf ? (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="flex flex-col">
                  <Label htmlFor="follow">Follow parent</Label>
                  <span className="text-xs text-muted-foreground">
                    Weights sync automatically when {parent.data?.symbol ?? "the parent"} changes.
                  </span>
                </span>
                <Switch id="follow" checked={follow} onCheckedChange={setFollow} />
              </div>
            ) : null}
            <Field
              label="First deposit (USDC)"
              hint={
                bal.data
                  ? `Balance ${bal.data.usdc.toLocaleString("en-US")} USDC. Leave empty to deposit later.`
                  : "Leave empty to deposit later."
              }
            >
              <Input
                value={deposit}
                inputMode="decimal"
                onChange={(e) => setDeposit(e.target.value.replace(/[^\d.]/g, ""))}
                className="num"
                data-testid="index-deposit"
              />
            </Field>
            {progress ? (
              <p className="text-sm text-muted-foreground">
                Step {progress.done} of {progress.total}…
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t pt-4">
          <Button
            variant="ghost"
            size="lg"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </Button>
          {step < 4 ? (
            <Button
              size="lg"
              disabled={!done(step)}
              onClick={() => setStep((s) => s + 1)}
              data-testid="wizard-next"
            >
              Continue
            </Button>
          ) : !w.signer ? (
            <Button size="lg" onClick={openConnect}>
              Connect wallet
            </Button>
          ) : (
            <Button
              size="lg"
              disabled={
                !done(4) || !weightsOk || busy || (bal.data ? depositNum > bal.data.usdc : false)
              }
              onClick={() => void create()}
              data-testid="wizard-create"
            >
              {busy
                ? "Confirm in wallet…"
                : depositNum >= 1
                  ? `Create and deposit ${usd(depositNum)}`
                  : "Create index"}
            </Button>
          )}
        </div>
      </div>
      <aside>
        <div className="lg:sticky lg:top-20">{preview}</div>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {value ? <span className="num text-sm">{value}</span> : null}
      </div>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
