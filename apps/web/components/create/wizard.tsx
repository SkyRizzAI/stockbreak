"use client";
import { CAP_T, PRESTOCKS_URL } from "@repo/config";
import {
  createIndexFlow,
  indexPda,
  joinWithHeld,
  nextIndexId,
  PartialZapError,
  sendTx,
  setManagersIx,
  vault,
  zapIn,
} from "@repo/sdk";
import { type Address, isAddress } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, Lock, LockOpen, Search, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AllocationBar, AllocationLegend } from "@/components/data/allocation";
import { DecimalInput } from "@/components/data/decimal-input";
import { IndexGlyph, TickerMono } from "@/components/data/glyph";
import { Price } from "@/components/data/num";
import { PrestocksTag } from "@/components/data/prestocks";
import { SimulatedBadge } from "@/components/data/states";
import { LinkButton } from "@/components/link-button";
import { openConnect, useBalances } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, useConfig, usePrices } from "@/lib/api";
import { signedPayload } from "@/lib/auth";
import { bps, duration, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { type Progress, useRun } from "@/lib/tx";
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

/** Base UI sends a number for pointer input and an array for keyboard input. */
export function sliderValue(v: number | readonly number[], fallback: number): number {
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/**
 * Set one weight and spread the rest over the other unlocked assets in
 * proportion, so the total stays 100%. Locked assets never move.
 */
export function setWeightKeepTotal(ps: Pick[], mint: string, v: number): Pick[] {
  const me = ps.find((p) => p.mint === mint);
  if (!me) return ps;
  const locked = ps.filter((p) => p.locked && p.mint !== mint).reduce((a, p) => a + p.weight, 0);
  const cap = Math.max(0, 100 - locked);
  const free = ps.filter((p) => !p.locked && p.mint !== mint);
  // Nothing else can absorb the change: this weight is whatever is left.
  const w = free.length ? round2(Math.min(cap, Math.max(0, v))) : round2(cap);
  const rest = cap - w;
  const freeSum = free.reduce((a, p) => a + p.weight, 0);
  let out = ps.map((p) => {
    if (p.mint === mint) return { ...p, weight: w };
    if (p.locked) return p;
    return {
      ...p,
      weight: round2(freeSum > 0 ? (p.weight / freeSum) * rest : rest / free.length),
    };
  });
  const diff = round2(100 - total(out));
  const i = out.findIndex((p) => !p.locked && p.mint !== mint);
  if (diff !== 0 && i >= 0)
    out = out.map((p, j) => (j === i ? { ...p, weight: round2(Math.max(0, p.weight + diff)) } : p));
  return out;
}

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

const utf8Len = (s: string) => new TextEncoder().encode(s).length;

/** Cut a string to at most `max` UTF-8 bytes without splitting a character. */
export function truncateBytes(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (utf8Len(out + ch) > max) break;
    out += ch;
  }
  return out;
}

const MAX_NAME_BYTES = 32;
/** MIN_INITIAL_VALUE is $1 of NAV; the zap keeps a slippage buffer and pays the spread. */
const MIN_FIRST_DEPOSIT = 1.1;
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

type Stage = "create" | "manager" | "deposit";
interface Created {
  index: Address;
  lookupTable: Address | null;
}

function StepHeader({
  step,
  onStep,
  done,
  reachable,
}: {
  step: number;
  onStep: (n: number) => void;
  done: (n: number) => boolean;
  reachable: (n: number) => boolean;
}) {
  return (
    <ol className="flex gap-1 overflow-x-auto" aria-label="Steps">
      {STEPS.map((s, i) => (
        <li key={s}>
          <button
            type="button"
            disabled={!reachable(i)}
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
  const sp = useSearchParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <WizardSkeleton />;
  // A different clone source (or none) starts a fresh wizard.
  return <Wizard key={sp.get("clone") ?? ""} />;
}

function WizardSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
      <Skeleton className="h-96" />
    </div>
  );
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
    // A bad address or missing index will not fix itself; only retry server errors.
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
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
  const [prefilled, setPrefilled] = useState(false);
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
  /** The deposit's swaps landed but its join did not: finish with the assets held. */
  const [heldDeposit, setHeldDeposit] = useState(false);
  const [deposit, setDeposit] = useState("1000");
  // Set once the index exists on chain: the wizard never creates a second one.
  const [created, setCreated] = useState<Created | null>(null);
  const [failed, setFailed] = useState<Stage | null>(null);

  const assets = useMemo(
    () => (cfg.data?.assets ?? []).filter((a) => a.listed && !a.benchmark),
    [cfg.data],
  );
  const priceOf = (s: string) => prices.data?.find((p) => p.symbol === s)?.price ?? 0;

  // The parent's composition, restricted to assets that can still be bought.
  const parentComp = useMemo(() => {
    const p = parent.data;
    if (!p || !cfg.data) return null;
    const listed = new Set(assets.map((a) => a.mint));
    const all = p.assets.filter((a) => a.targetWeightBps > 0);
    const kept = all.filter((a) => listed.has(a.mint));
    return {
      picks: kept.length
        ? normalize(
            kept.map((a) => ({
              symbol: a.symbol,
              mint: a.mint,
              weight: a.targetWeightBps / 100,
              locked: false,
            })),
          )
        : [],
      dropped: all.filter((a) => !listed.has(a.mint)).map((a) => a.symbol),
    };
  }, [parent.data, cfg.data, assets]);

  // Prefill from a clone source, once, before the pickers are shown.
  useEffect(() => {
    const p = parent.data;
    if (!p || !parentComp || prefilled) return;
    setPicks(parentComp.picks);
    setMode(p.strategy.mode);
    setPreset(
      p.strategy.mode === "Manual" ? "hold" : p.strategy.mode === "Periodic" ? "periodic" : "drift",
    );
    setDrift(p.strategy.driftThresholdBps / 100 || 5);
    setPeriodDays(p.strategy.periodSecs > 0 ? p.strategy.periodSecs / 86400 : 7);
    setSlippage(p.strategy.maxSlippageBps / 100);
    setCooldownMin(p.strategy.cooldownSecs / 60);
    setKeeper(p.strategy.allowKeeper);
    setMgmt(p.fees.mgmtFeeBps / 100);
    setEntry(p.fees.entryFeeBps / 100);
    setExit(p.fees.exitFeeBps / 100);
    setName(truncateBytes(`${p.name} Remix`, MAX_NAME_BYTES));
    setSymbol(`${p.symbol.slice(0, 7)}R`.toUpperCase());
    setDescription(`Clone of ${p.name}.`);
    setPrefilled(true);
  }, [parent.data, parentComp, prefilled]);

  // Following: the keeper keeps the weights equal to the parent's, so they are read-only here.
  const following = !!cloneOf && follow;
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
  const setWeight = (mint: string, v: number) => setPicks((ps) => setWeightKeepTotal(ps, mint, v));
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
  const setFollowing = (v: boolean) => {
    setFollow(v);
    if (v && parentComp) setPicks(parentComp.picks);
  };

  const sum = total(picks);
  const weightsOk =
    picks.length > 0 && Math.abs(sum - 100) < 0.005 && picks.every((p) => p.weight > 0);
  const nameBytes = utf8Len(name.trim());
  const nameOk = nameBytes > 0 && nameBytes <= MAX_NAME_BYTES;
  const symbolOk = /^[A-Z0-9]{1,10}$/.test(symbol);
  const managerError =
    manager === ""
      ? null
      : !isAddress(manager) || manager === DEFAULT_PUBKEY
        ? "Enter a valid Solana address."
        : null;
  const depositText = deposit.trim();
  const depositNum = depositText === "" ? 0 : Number(depositText);
  const depositError = !Number.isFinite(depositNum)
    ? "Enter an amount in USDC."
    : depositNum > 0 && depositNum < MIN_FIRST_DEPOSIT
      ? `The first deposit must be at least ${usd(MIN_FIRST_DEPOSIT)}. Leave it empty to deposit later.`
      : bal.data && depositNum > bal.data.usdc
        ? "More than your USDC balance."
        : null;
  const done = (i: number) =>
    i === 0
      ? picks.length > 0
      : i === 1
        ? weightsOk
        : i === 2
          ? true
          : i === 3
            ? true
            : nameOk && symbolOk && managerError === null;
  // A step can be opened only when every step before it is complete.
  const reachable = (i: number) => Array.from({ length: i }, (_, j) => j).every((j) => done(j));

  const toBps = (ps: Pick[]) => {
    const out = ps.map((p) => ({ mint: p.mint, weightBps: Math.round(p.weight * 100) }));
    const d = 10_000 - out.reduce((a, x) => a + x.weightBps, 0);
    if (out[0]) out[0].weightBps += d;
    return out;
  };

  /** One progress counter across create, manager and deposit transactions. */
  const tracker = (onProgress: (p: Progress) => void, plan: Record<Stage, number>) => {
    const order: Stage[] = ["create", "manager", "deposit"];
    return (
      stage: Stage,
      p: { step: string; done: number; total: number; signature?: Progress["signature"] },
    ) => {
      plan[stage] = p.total;
      const offset = order.slice(0, order.indexOf(stage)).reduce((a, k) => a + plan[k], 0);
      onProgress({
        step: p.step,
        done: offset + p.done,
        total: order.reduce((a, k) => a + plan[k], 0),
        signature: p.signature,
      });
    };
  };

  /** Best effort: lookup table + description right after the index exists. */
  const saveExtras = async (c: Created) => {
    if (c.lookupTable)
      await api(`/api/indexes/${c.index}/lookup-table`, {
        method: "POST",
        body: JSON.stringify({ lookupTable: c.lookupTable }),
      }).catch((e: unknown) => console.warn("Lookup table not recorded", e));
    if (!(description || thesis) || !w.address) return;
    try {
      const auth = await signedPayload(w.address, "index-meta");
      for (let i = 0; ; i++) {
        try {
          await api(`/api/indexes/${c.index}/meta`, {
            method: "POST",
            body: JSON.stringify({
              description: description || null,
              thesis: thesis || null,
              wallet: w.address,
              ...auth,
            }),
          });
          break;
        } catch (e) {
          if (i >= 2) throw e;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    } catch (e) {
      console.warn("Description not saved", e);
      toast.message("Index created. You can add a description later from Manage.");
    }
  };

  /** Manager and deposit steps. Records the failed stage so a retry resumes there. */
  const finishStages = async (
    c: Created,
    from: "manager" | "deposit",
    track: ReturnType<typeof tracker>,
  ) => {
    const signer = w.signer as NonNullable<typeof w.signer>;
    const usdc = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint as Address;
    const ctx = chain();
    let stage: Stage = from;
    try {
      if (from === "manager" && manager) {
        const signature = await sendTx(ctx, signer, [
          await setManagersIx(signer, c.index, [manager as Address]),
        ]);
        track("manager", { step: "manager", done: 1, total: 1, signature });
      }
      stage = "deposit";
      const onProgress = (p: Parameters<typeof track>[1]) =>
        track("deposit", { ...p, step: `deposit-${p.step}` });
      if (heldDeposit)
        // The swaps already went through: deposit what the wallet holds, never swap twice.
        await joinWithHeld(ctx, signer, c.index, { lookupTable: c.lookupTable, onProgress });
      else if (depositNum > 0)
        await zapIn(ctx, signer, c.index, usdc, BigInt(Math.round(depositNum * 1e6)), {
          lookupTable: c.lookupTable,
          onProgress,
        });
      setHeldDeposit(false);
    } catch (e) {
      if (e instanceof PartialZapError && e.stage === "join") setHeldDeposit(true);
      setFailed(stage);
      throw e;
    }
  };

  const create = async () => {
    // Never create twice: once the index exists only the remaining steps can be retried.
    if (created || !w.signer || !cfg.data) return;
    const signer = w.signer;
    const res = await run(
      "Create index",
      async (onProgress) => {
        const track = tracker(onProgress, {
          create: picks.length >= 5 ? 3 : 1,
          manager: manager ? 1 : 0,
          deposit: depositNum > 0 ? 2 : 0,
        });
        const c = chain();
        const indexId = await nextIndexId(c, signer.address);
        const indexAddress = await indexPda(signer.address, indexId);
        const r = await createIndexFlow(
          c,
          {
            creator: signer,
            indexId,
            name: name.trim(),
            symbol,
            uri: `${window.location.origin}/api/meta/${indexAddress}`,
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
            followsParent: following,
          },
          (p) => track("create", p),
        );
        const made = { index: r.index, lookupTable: r.lookupTable };
        setCreated(made);
        await saveExtras(made);
        await finishStages(made, "manager", track);
        return r;
      },
      undefined,
      {
        // The whole journey up front, so every wallet prompt has context.
        steps: [
          ...(picks.length >= 5 ? ["lookup-table"] : []),
          "create",
          ...(manager ? ["manager"] : []),
          ...(depositNum > 0 ? ["deposit-swap", "deposit-join"] : []),
        ],
      },
    );
    if (res) router.push(`/i/${res.index}`);
  };

  const retry = async () => {
    if (!created || !failed || failed === "create") return;
    const from = failed;
    const res = await run(
      from === "manager" ? "Finish setup" : "Deposit",
      async (onProgress) => {
        const track = tracker(onProgress, {
          create: 0,
          manager: from === "manager" && manager ? 1 : 0,
          deposit: depositNum > 0 ? 2 : 0,
        });
        await finishStages(created, from, track);
        return { ok: true };
      },
      undefined,
      {
        steps: [
          ...(from === "manager" && manager ? ["manager"] : []),
          ...(heldDeposit
            ? ["deposit-join"]
            : depositNum > 0
              ? ["deposit-swap", "deposit-join"]
              : []),
        ],
      },
    );
    if (res) {
      setFailed(null);
      router.push(`/i/${created.index}`);
    }
  };

  const filtered = assets.filter((a) =>
    `${a.symbol} ${a.name}`.toLowerCase().includes(q.toLowerCase()),
  );
  const presetDef = PRESETS.find((p) => p.id === preset);
  const revenue = (10_000 * mgmt) / 100;
  const parentLabel = parent.data?.symbol ?? "the parent";

  if (cloneOf && parent.isError)
    return (
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-10 md:px-8">
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-2xl border px-4 py-8 md:px-8"
        >
          <h1 className="text-base font-medium">This index could not be loaded</h1>
          <p className="text-sm text-muted-foreground">
            {parent.error instanceof ApiError &&
            parent.error.status !== 404 &&
            parent.error.status !== 400
              ? parent.error.message
              : "There is no index at this address on this network, so it cannot be cloned."}
          </p>
          <div className="mt-2 flex gap-2">
            <LinkButton href="/create" size="sm">
              Create from scratch
            </LinkButton>
            {/* A missing index will not appear on retry; only offer it for server errors. */}
            {parent.error instanceof ApiError &&
            (parent.error.status === 404 || parent.error.status === 400) ? null : (
              <Button variant="outline" size="sm" onClick={() => void parent.refetch()}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  if (cloneOf && !prefilled) return <WizardSkeleton />;

  const depositField = (
    <Field
      label="First deposit (USDC)"
      hint={
        bal.data
          ? `Balance ${bal.data.usdc.toLocaleString("en-US")} USDC. Minimum ${usd(MIN_FIRST_DEPOSIT)}. Leave empty to deposit later.`
          : `Minimum ${usd(MIN_FIRST_DEPOSIT)}. Leave empty to deposit later.`
      }
    >
      <Input
        value={deposit}
        inputMode="decimal"
        onChange={(e) => setDeposit(e.target.value.replace(/[^\d.]/g, ""))}
        className="num"
        aria-invalid={depositError ? true : undefined}
        data-testid="index-deposit"
      />
      {depositError ? (
        <span className="text-xs text-warn">
          {depositError}{" "}
          {bal.data && depositNum > bal.data.usdc ? (
            <Link href="/faucet" className="underline underline-offset-2">
              Get test USDC
            </Link>
          ) : null}
        </span>
      ) : null}
    </Field>
  );
  const progressLine = progress ? (
    <p className="num text-sm text-muted-foreground">
      Step {progress.done} of {progress.total}…
    </p>
  ) : null;

  const preview = (
    <div className="flex flex-col gap-4 rounded-2xl border p-4">
      <div className="flex items-center gap-3">
        <IndexGlyph pubkey={`${name}${symbol}`} weights={picks.map((p) => p.weight)} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{name || "Untitled index"}</span>
          <span className="mono text-xs text-muted-foreground">{symbol || "SYMBOL"}</span>
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
              ? `Every ${duration(periodDays * 86400)}`
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

  if (created && failed && failed !== "create")
    return (
      <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-8 md:px-8 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{name.trim()}</h1>
          <div className="flex flex-col gap-4 rounded-2xl border p-4" data-testid="create-recovery">
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 font-medium">
                <TriangleAlert className="size-4 text-warn" />
                {failed === "manager"
                  ? "Index created. The manager and deposit did not complete."
                  : "Index created. The deposit did not complete."}
              </p>
              <p className="text-sm text-muted-foreground">
                {symbol} exists on chain. Retrying continues from where it stopped and does not
                create another index.
              </p>
            </div>
            {depositField}
            {progressLine}
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                disabled={
                  busy ||
                  (!heldDeposit &&
                    (depositError !== null || (failed === "deposit" && depositNum <= 0)))
                }
                onClick={() => void retry()}
                data-testid="retry-deposit"
              >
                {busy
                  ? "Confirm in wallet…"
                  : failed === "manager"
                    ? depositNum > 0
                      ? "Retry manager and deposit"
                      : "Retry manager"
                    : heldDeposit
                      ? "Finish deposit with swapped assets"
                      : "Retry deposit"}
              </Button>
              <LinkButton href={`/i/${created.index}`} variant="outline" size="lg">
                Open index
              </LinkButton>
            </div>
          </div>
        </div>
        <aside>
          <div className="lg:sticky lg:top-20">{preview}</div>
        </aside>
      </div>
    );

  const followNote = following ? (
    <p className="rounded-2xl border p-3 text-sm text-muted-foreground">
      Following {parentLabel}: assets and weights come from the parent and sync automatically. Turn
      off Follow parent on the Review step to edit them.
    </p>
  ) : null;
  const droppedNote =
    cloneOf && parentComp?.dropped.length ? (
      <p className="text-sm text-warn">
        {parentComp.dropped.join(", ")} {parentComp.dropped.length === 1 ? "is" : "are"} no longer
        listed and {parentComp.dropped.length === 1 ? "was" : "were"} left out. The other weights
        were scaled up.
      </p>
    ) : null;

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-4 py-8 md:px-8 lg:grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            {cloneOf ? `Clone ${parent.data?.name ?? "index"}` : "Create index"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick assets, set weights and rules. The vault program enforces them.
          </p>
        </div>
        <StepHeader
          step={step}
          onStep={(n) => !busy && setStep(n)}
          done={done}
          reachable={(i) => !busy && reachable(i)}
        />

        {step === 0 ? (
          <div className="flex flex-col gap-3">
            {followNote}
            {droppedNote}
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
            <ul className="divide-y rounded-2xl border" data-testid="asset-list">
              {filtered.map((a) => {
                const on = picks.some((p) => p.mint === a.mint);
                return (
                  <li key={a.mint}>
                    <button
                      type="button"
                      onClick={() => toggle(a)}
                      disabled={following}
                      aria-pressed={on}
                      className={cn(
                        "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                        on && "bg-muted/60 disabled:hover:bg-muted/60",
                      )}
                      data-testid={`asset-${a.symbol}`}
                    >
                      <TickerMono symbol={a.symbol} />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="flex items-center gap-1.5">
                          <span className="mono text-sm">{a.symbol}</span>
                          {a.issuer?.name === "PreStocks" ? <PrestocksTag link={false} /> : null}
                        </span>
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
            {filtered.some((a) => a.kind === "PreIpo") ? (
              <p className="text-xs text-muted-foreground">
                Pre-IPO assets mirror{" "}
                <a
                  href={PRESTOCKS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  PreStocks
                </a>{" "}
                tokens, priced from the PreStocks API. At IPO the index migrates them to the listed
                stock automatically. Simulated.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            {followNote}
            {droppedNote}
            <div className="flex flex-wrap items-center gap-2">
              {following ? null : (
                <>
                  <Button variant="outline" size="sm" onClick={equal}>
                    Equal
                  </Button>
                  <Button variant="outline" size="sm" onClick={capLike}>
                    Market-cap-like
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPicks((ps) => normalize(ps))}
                  >
                    Normalize
                  </Button>
                </>
              )}
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
                <li key={p.mint} className="flex flex-col gap-2 rounded-2xl border p-3">
                  <div className="flex items-center gap-3">
                    <TickerMono symbol={p.symbol} />
                    <span className="mono flex-1 text-sm">{p.symbol}</span>
                    <DecimalInput
                      aria-label={`${p.symbol} weight`}
                      className="num h-9 w-20 text-right"
                      value={p.weight}
                      disabled={following}
                      onCommit={(v) => setWeight(p.mint, v)}
                      data-testid={`weight-${p.symbol}`}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                    {following ? null : (
                      <>
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
                      </>
                    )}
                  </div>
                  <Slider
                    value={[p.weight]}
                    min={0}
                    max={100}
                    step={0.5}
                    disabled={following}
                    onValueChange={(v) => setWeight(p.mint, sliderValue(v, p.weight))}
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
                    "flex flex-col gap-1 rounded-2xl border p-3 text-left",
                    preset === p.id && "border-foreground",
                  )}
                  aria-pressed={preset === p.id}
                >
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.hint}</span>
                </button>
              ))}
            </div>
            <details className="rounded-2xl border p-3" open={presetDef?.id !== "hold"}>
              <summary className="cursor-pointer text-sm">Advanced</summary>
              <div className="mt-4 flex flex-col gap-5">
                {mode === "Threshold" ? (
                  <Field label="Drift threshold" value={`${drift}%`}>
                    <Slider
                      value={[drift]}
                      min={1}
                      max={20}
                      step={0.5}
                      onValueChange={(v) => setDrift(sliderValue(v, drift))}
                      aria-label="Drift threshold"
                    />
                  </Field>
                ) : null}
                {mode === "Periodic" ? (
                  <Field label="Period" value={duration(periodDays * 86400)}>
                    <Slider
                      value={[periodDays]}
                      min={1}
                      max={30}
                      step={1}
                      onValueChange={(v) => setPeriodDays(sliderValue(v, periodDays))}
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
                    onValueChange={(v) => setSlippage(round2(sliderValue(v, slippage)))}
                    aria-label="Max slippage"
                  />
                </Field>
                <Field label="Cooldown" value={duration(cooldownMin * 60)}>
                  <Slider
                    value={[cooldownMin]}
                    min={0}
                    max={1440}
                    step={1}
                    onValueChange={(v) => setCooldownMin(sliderValue(v, cooldownMin))}
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
          <div className="flex flex-col gap-5 rounded-2xl border p-4">
            <Field label="Management fee (to you)" value={`${mgmt}% / yr`}>
              <Slider
                value={[mgmt]}
                min={0}
                max={5}
                step={0.1}
                onValueChange={(v) => setMgmt(round2(sliderValue(v, mgmt)))}
                aria-label="Management fee"
              />
            </Field>
            <Field label="Entry fee" value={`${entry}%`}>
              <Slider
                value={[entry]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => setEntry(round2(sliderValue(v, entry)))}
                aria-label="Entry fee"
              />
            </Field>
            <Field label="Exit fee" value={`${exit}%`}>
              <Slider
                value={[exit]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(v) => setExit(round2(sliderValue(v, exit)))}
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
            {!weightsOk ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm"
              >
                <span className="text-warn">
                  {picks.length
                    ? "Weights must add up to 100% and each must be above 0."
                    : "Pick at least one asset."}
                </span>
                <Button variant="outline" size="sm" onClick={() => setStep(picks.length ? 1 : 0)}>
                  {picks.length ? "Edit weights" : "Pick assets"}
                </Button>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Name">
                <Input
                  value={name}
                  maxLength={MAX_NAME_BYTES}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Chip Leaders"
                  aria-invalid={nameBytes > MAX_NAME_BYTES ? true : undefined}
                  data-testid="index-name"
                />
                {nameBytes > MAX_NAME_BYTES ? (
                  <span className="num text-xs text-warn">
                    Too long: {nameBytes} of {MAX_NAME_BYTES} bytes.
                  </span>
                ) : null}
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
                  aria-invalid={managerError ? true : undefined}
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
                {managerError ? <span className="text-xs text-warn">{managerError}</span> : null}
              </div>
            </Field>
            {cloneOf ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border p-3">
                <span className="flex flex-col">
                  <Label htmlFor="follow">Follow parent</Label>
                  <span className="text-xs text-muted-foreground">
                    {follow
                      ? `Uses ${parentLabel}'s weights. The keeper copies every change ${parentLabel} makes.`
                      : `Off: your weights stay as set. On: weights copy ${parentLabel} and sync automatically.`}
                  </span>
                  {follow && (mode === "Manual" || !keeper) ? (
                    <span className="text-xs text-warn">
                      Targets will sync, but with {mode === "Manual" ? "Hold" : "the keeper off"}{" "}
                      your holdings won't move by themselves. Use Manage → Rebalance now, or allow
                      the keeper on the Strategy step.
                    </span>
                  ) : null}
                </span>
                <Switch id="follow" checked={follow} onCheckedChange={setFollowing} />
              </div>
            ) : null}
            {depositField}
            {progressLine}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t pt-4">
          <Button
            variant="ghost"
            size="lg"
            disabled={step === 0 || busy}
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
              disabled={!reachable(5) || depositError !== null || busy || !!created}
              onClick={() => void create()}
              data-testid="wizard-create"
            >
              {busy
                ? "Confirm in wallet…"
                : depositNum > 0
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
