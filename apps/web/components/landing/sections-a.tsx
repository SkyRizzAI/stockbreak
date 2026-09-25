"use client";
import { cn } from "cn";
import { Check, X } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { APP_NAME } from "@/lib/env";
import { CountUp, Reveal, rv, useInterval, useInView, useReducedMotion, useTween } from "./motion";
import { AllocBar, EYEBROW, H2, LEAD, MARK_BG, MarkTile, Mono, Tag, WRAP } from "./ui";

const css = (o: Record<string, string | number>) => o as CSSProperties;

/* ─── Market proof strip ─────────────────────────────────────────────── */

const MARKET = [
  { v: 850, suffix: "K+", l: "holders, all-time high" },
  { v: 3.3, dec: 1, prefix: "$", suffix: "B", l: "volume in 30 days" },
  { v: 63, suffix: "%+", l: "of activity outside US market hours" },
  { v: 37.6, dec: 1, suffix: "K", l: "holders of Anthropic pre-IPO tokens" },
];

export function MarketStrip() {
  return (
    <Reveal className={WRAP}>
      <div className="grid grid-cols-2 items-center gap-y-6 border-y py-7 md:grid-cols-[200px_repeat(4,minmax(0,1fr))]">
        <span className="lp-rv col-span-2 text-[13px] leading-[1.4] font-semibold text-muted-foreground md:col-span-1">
          Tokenized stocks on Solana, Sep 2026
        </span>
        {MARKET.map((m, i) => (
          <span
            key={m.l}
            className="lp-rv flex flex-col gap-1 border-l pl-4 md:pl-7"
            style={rv(i + 1)}
          >
            <CountUp
              value={m.v}
              decimals={m.dec ?? 0}
              prefix={m.prefix}
              suffix={m.suffix}
              className="text-[28px] font-extrabold tracking-[-0.03em] md:text-4xl"
            />
            <span className="text-[13px] text-muted-foreground">{m.l}</span>
          </span>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground/75">
        Source: Solana Compass, 20 Sep 2026. Market data, not {APP_NAME} traction.
      </p>
    </Reveal>
  );
}

/* ─── Problem ────────────────────────────────────────────────────────── */

const DEADLINE = Date.UTC(2027, 2, 12, 23, 59);

function Countdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  useInterval(() => setNow(Date.now()), 1000);
  if (now === null) return null;
  const s = Math.max(0, Math.floor((DEADLINE - now) / 1000));
  const parts = [
    [Math.floor(s / 86400), "d"],
    [Math.floor((s % 86400) / 3600), "h"],
    [Math.floor((s % 3600) / 60), "m"],
    [s % 60, "s"],
  ] as const;
  return (
    <span className="num text-xs text-warn/80">
      {parts.map(([v, u]) => `${String(v).padStart(u === "d" ? 1 : 2, "0")}${u}`).join(" ")} left
    </span>
  );
}

const PROBLEMS = [
  {
    t: "Every token is one ticker.",
    b: "If you believe in AI infrastructure plus Anthropic and SpaceX, you're managing ten positions by hand — and rebalancing them yourself, forever.",
  },
  {
    t: "Creators can't ship their thesis.",
    b: "61% of investors aged 18–34 act on finfluencer picks, but packaging a thesis into something people can buy still means starting a fund. Copy apps are off-chain, US-only and run on subscriptions.",
  },
  {
    t: "Pre-IPO tokens come with deadlines.",
    b: "After the SpaceX IPO, SpaceX PreStocks had to be swapped into SPCXx before 12 Mar 2027 — or they expire. Holders who forget lose everything.",
  },
];

export function Problem() {
  return (
    <Reveal className={cn(WRAP, "flex flex-col gap-14 pt-28 md:pt-36")}>
      <h2 className={cn(H2, "lp-rv max-w-[820px] md:text-5xl")}>
        Tokenized stocks are here. Portfolios aren&apos;t.
      </h2>
      <div className="grid gap-10 md:grid-cols-3 md:gap-12">
        {PROBLEMS.map((p, i) => (
          <div key={p.t} className="lp-rv relative flex flex-col gap-3 pt-5" style={rv(i + 1)}>
            <span
              aria-hidden
              className="lp-grow-x absolute inset-x-0 top-0 h-px bg-border"
              style={css({ "--d": "200ms", "--i": i })}
            />
            <Mono className="text-[13px] text-muted-foreground">0{i + 1}</Mono>
            <h3 className="text-[21px] font-bold tracking-[-0.01em]">{p.t}</h3>
            <p className="text-[15px] leading-[1.6] text-muted-foreground">{p.b}</p>
            {i === 2 ? (
              <span className="mt-1 flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-2 rounded-[6px] border border-warn/30 px-2 py-0.5 text-xs font-semibold text-warn">
                  <span className="lp-ping size-1.5 rounded-full bg-warn text-warn" aria-hidden />
                  Deadline · Mar 12, 2027 23:59 UTC
                </span>
                <Countdown />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground/75">
        Sources: FINRA Foundation, 2026; PreStocks announcement on X.
      </p>
    </Reveal>
  );
}

/* ─── How it works ───────────────────────────────────────────────────── */

const STEPS = [
  [
    "Create",
    "Pick up to 10 assets, set weights, choose a strategy (Hold, rebalance on drift, or periodic) and your fees. The wizard previews your index card live.",
  ],
  [
    "Share",
    "Every index gets a link, an OG image, a feed card and a Solana Blink, so it can be joined straight from X or Discord.",
  ],
  [
    "Join",
    `Investors pay in USDC. ${APP_NAME} swaps into every asset at oracle prices and deposits into the vault. They get share tokens and can redeem anytime.`,
  ],
  [
    "Stay balanced",
    "When weights drift past your rule, a permissionless keeper rebalances in one atomic transaction. If it breaks the rules, it reverts.",
  ],
] as const;

const si = (i: number) => css({ "--i": i });

function PanelCreate() {
  return (
    <div className="grid w-full gap-8 lg:grid-cols-[240px_minmax(0,1fr)_320px] lg:items-center lg:gap-10">
      <div className="hidden flex-col gap-3.5 text-[15px] lg:flex">
        {[
          ["Assets", "4 of 10"],
          ["Weights", "100%"],
          ["Strategy", "Drift 5%"],
          ["Fees", "1% / yr"],
        ].map(([k, v], i) => (
          <span key={k} className="lp-swap-item flex justify-between" style={si(i)}>
            <span>{k}</span>
            <span className="text-muted-foreground">{v}</span>
          </span>
        ))}
        <span
          className="lp-swap-item flex justify-between rounded-[10px] bg-raised px-2.5 py-2 font-bold"
          style={si(4)}
        >
          <span>Details &amp; review</span>
          <span className="text-muted-foreground">Step 5</span>
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-muted-foreground">Review</span>
        {[
          ["Name", "Magnificent Four · MAG4"],
          ["Rebalancing", "When drift > 5%"],
          ["Management fee", "1% / yr"],
          ["Initial deposit", "Zap from USDC"],
        ].map(([k, v], i) => (
          <span
            key={k}
            className="lp-swap-item flex justify-between gap-4 border-b border-hairline pb-2.5 text-[15px] last:border-0"
            style={si(i + 1)}
          >
            <span className="text-muted-foreground">{k}</span>
            <span className="text-right">{v}</span>
          </span>
        ))}
      </div>
      <div
        className="lp-swap-item flex flex-col gap-3.5 rounded-2xl border bg-background p-5"
        style={si(3)}
      >
        <span className="text-xs font-semibold text-muted-foreground">Live card preview</span>
        <span className="flex items-center gap-3">
          <MarkTile size={40} />
          <span className="text-[17px] font-bold">Magnificent Four</span>
        </span>
        <AllocBar weights={[40, 30, 20, 10]} className="h-2" grow now delay={450} />
      </div>
    </div>
  );
}

function PanelShare() {
  return (
    <div className="flex w-full flex-col items-center gap-8 md:flex-row md:justify-center md:gap-12">
      <div
        className="lp-swap-item flex w-full max-w-[420px] flex-col gap-4 rounded-2xl border bg-background p-[22px]"
        style={si(0)}
      >
        <span className="flex h-[72px] gap-1">
          {[
            ["AAPLx 40%", 4],
            ["NVDAx 30%", 3],
            ["TSLAx", 2],
            ["", 1],
          ].map(([t, g], i) => (
            <span
              key={g}
              className={cn(
                "lp-grow-x-now mono overflow-hidden rounded-[8px] p-2.5 text-xs text-[#03140c]",
                MARK_BG[i],
              )}
              style={css({ flexGrow: g, "--i": i, "--d": "200ms" })}
            >
              {t}
            </span>
          ))}
        </span>
        <span className="flex items-baseline justify-between">
          <span className="text-lg font-bold">Magnificent Four</span>
          <span className="text-[15px] font-bold text-up">+2.38% 7d</span>
        </span>
        <span className="text-[13px] text-muted-foreground">by @alice · Simulated</span>
      </div>
      <div className="flex flex-col gap-2.5 self-start md:self-auto">
        <span
          className="lp-swap-item text-[13px] font-semibold text-muted-foreground"
          style={si(1)}
        >
          Every index gets
        </span>
        {[
          "A link and an OG image",
          "A feed card in three styles",
          "A Solana Blink for X and Discord",
        ].map((t, i) => (
          <span
            key={t}
            className="lp-swap-item flex items-center gap-2 text-[17px]"
            style={si(i + 2)}
          >
            <Check className="size-4 text-up" aria-hidden />
            {t}
          </span>
        ))}
        <span className="lp-swap-item mt-2 flex gap-2" style={si(5)}>
          {["Copy link", "Copy Blink link"].map((t) => (
            <span
              key={t}
              className="flex h-9 items-center rounded-[10px] border px-3 text-sm font-semibold"
            >
              {t}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function PanelJoin() {
  const pct = useTween(60, { duration: 1600 });
  const C = 2 * Math.PI * 50;
  return (
    <div className="grid w-full max-w-[520px] grid-cols-[88px_minmax(0,1fr)] items-center gap-6 rounded-2xl border bg-background p-5 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-7 sm:p-7">
      <svg
        viewBox="0 0 120 120"
        className="w-full"
        fill="none"
        role="img"
        aria-label="60% complete"
      >
        <circle cx="60" cy="60" r="50" className="stroke-border" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r="50"
          className="stroke-foreground"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          transform="rotate(-90 60 60)"
        />
        <text
          x="60"
          y="67"
          textAnchor="middle"
          className="num fill-foreground text-[20px] font-bold"
        >
          {Math.round(pct)}%
        </text>
      </svg>
      <div className="flex flex-col gap-3 text-[15px]">
        {["Swap USDC → AAPLx", "Swap USDC → NVDAx"].map((t, i) => (
          <span key={t} className="lp-swap-item flex justify-between gap-3" style={si(i * 3)}>
            <span>{t}</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Check className="size-3.5 text-up" aria-hidden />
              Done
            </span>
          </span>
        ))}
        <span className="lp-swap-item flex justify-between gap-3 font-bold" style={si(7)}>
          <span>Deposit to vault</span>
          <span className="flex items-center gap-2 text-right text-warn">
            <span
              className="lp-ping size-1.5 shrink-0 rounded-full bg-warn text-warn"
              aria-hidden
            />
            Approve in your wallet
          </span>
        </span>
      </div>
    </div>
  );
}

function PanelRebalance() {
  const [after, setAfter] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const t = window.setTimeout(() => setAfter(true), reduced ? 0 : 900);
    return () => window.clearTimeout(t);
  }, [reduced]);
  const drift = useTween(after ? 0 : 12, { from: 12, duration: 900 });
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-6">
      <span className="lp-swap-item flex flex-wrap justify-between gap-2 rounded-[10px] border bg-background px-4 py-3.5 text-[15px]">
        <span>
          <Mono className="text-muted-foreground">MAG4</Mono> Rebalanced · drift 12% →{" "}
          <span className={cn("num transition-colors", after && "text-up")}>
            {Math.round(drift)}%
          </span>
        </span>
        <span className="text-muted-foreground">by keeper</span>
      </span>
      <span className="lp-swap-item flex flex-col gap-1.5" style={si(1)}>
        <span className="text-xs text-muted-foreground">Before</span>
        <AllocBar weights={[34, 42, 16, 8]} />
      </span>
      <span className="lp-swap-item flex flex-col gap-1.5" style={si(2)}>
        <span className="text-xs text-muted-foreground">
          {after ? "After — back on target" : "Rebalancing…"}
        </span>
        <AllocBar weights={after ? [40, 30, 20, 10] : [34, 42, 16, 8]} />
      </span>
      <span className="text-xs text-muted-foreground/75">
        Illustrative drift, simulated assets.
      </span>
    </div>
  );
}

const PANELS = [PanelCreate, PanelShare, PanelJoin, PanelRebalance];

export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [hover, setHover] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, threshold: 0.3 });
  const Panel = PANELS[step] ?? PanelCreate;
  const paused = hover || !inView;
  return (
    <Reveal id="how" className={cn(WRAP, "flex scroll-mt-20 flex-col gap-10 pt-32 md:pt-40")}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className={cn(H2, "lp-rv md:text-5xl")}>From thesis to token in four steps.</h2>
        <span className="lp-rv text-base text-muted-foreground" style={rv(1)}>
          No fund, no paperwork. Just a wallet.
        </span>
      </div>
      <div
        ref={ref}
        className={cn("flex flex-col gap-10", paused && "lp-paused")}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <div
          role="tablist"
          aria-label="Steps"
          className="lp-rv grid grid-cols-2 gap-y-4 border-t md:grid-cols-4"
          style={rv(2)}
        >
          {STEPS.map(([title, body], i) => {
            const on = step === i;
            return (
              <button
                key={title}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="how-panel"
                onClick={() => setStep(i)}
                className="group relative -mt-px flex cursor-pointer flex-col gap-2.5 pt-5 pr-4 text-left md:pr-7"
              >
                <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-transparent">
                  {on ? (
                    <span
                      key={`fill-${step}`}
                      className="lp-fill absolute inset-0 bg-foreground"
                      style={css({ "--dur": "6.5s" })}
                      onAnimationEnd={() => setStep((s) => (s + 1) % STEPS.length)}
                    />
                  ) : null}
                </span>
                <Mono
                  className={cn(
                    "text-[13px] transition-colors",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  0{i + 1}
                </Mono>
                <span
                  className={cn(
                    "text-lg font-bold transition-colors md:text-xl",
                    on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {title}
                </span>
                <span className="hidden text-sm leading-[1.6] text-muted-foreground md:block">
                  {body}
                </span>
              </button>
            );
          })}
        </div>
        <p className="-mt-6 text-sm leading-[1.6] text-muted-foreground md:hidden">
          {STEPS[step]?.[1]}
        </p>
        <div
          id="how-panel"
          role="tabpanel"
          className="lp-rv flex min-h-[380px] items-center justify-center overflow-hidden rounded-2xl border bg-surface p-5 sm:p-10"
          style={rv(3)}
        >
          <div key={step} className="lp-swap flex w-full justify-center">
            <Panel />
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/* ─── Index = token ──────────────────────────────────────────────────── */

const ALLOC = [
  ["AAPLx", 40],
  ["NVDAx", 30],
  ["TSLAx", 20],
  ["SPACEX-pre", 10],
] as const;

function FlowDiagram() {
  const box = "stroke-border fill-background";
  const label = "fill-muted-foreground mono text-[13px]";
  return (
    <svg
      viewBox="0 0 700 220"
      className="h-auto w-full"
      fill="none"
      role="img"
      aria-label="Join: USDC is swapped into each asset, deposited to the vault, and share tokens are minted. Redeem runs the other way."
    >
      {/* Connectors: dashes flow left to right while visible. */}
      <g className="stroke-mark-3" strokeWidth="1.2">
        {[
          [111, 100, 180, 33],
          [111, 100, 180, 100],
          [111, 100, 180, 168],
          [311, 33, 380, 80],
          [311, 100, 380, 100],
          [311, 168, 380, 120],
        ].map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} className="lp-flow" />
        ))}
      </g>
      <g className="lp-pop" style={css({ "--d": "0ms" })}>
        <rect x="0.5" y="70.5" width="110" height="60" rx="10" className={box} />
        <text x="55" y="106" textAnchor="middle" className="fill-foreground text-[15px] font-bold">
          USDC
        </text>
      </g>
      {[
        [10.5, 38, "swap → AAPLx"],
        [78.5, 106, "swap → NVDAx"],
        [146.5, 174, "swap × n"],
      ].map(([y, ty, t], i) => (
        <g key={t as string} className="lp-pop" style={css({ "--d": `${150 + i * 90}ms` })}>
          <rect x="180.5" y={y} width="130" height="44" rx="10" className={box} />
          <text x="245" y={ty} textAnchor="middle" className={label}>
            {t}
          </text>
        </g>
      ))}
      <g className="lp-pop" style={css({ "--d": "500ms" })}>
        <rect
          x="380.5"
          y="50.5"
          width="150"
          height="100"
          rx="16"
          className="lp-vault fill-raised stroke-mark-2"
        />
        <text x="455" y="96" textAnchor="middle" className="fill-foreground text-base font-bold">
          Vault
        </text>
        <text x="455" y="118" textAnchor="middle" className="mono fill-muted-foreground text-xs">
          PDA
        </text>
      </g>
      <g className="lp-pop" style={css({ "--d": "650ms" })}>
        <rect x="590.5" y="70.5" width="108" height="60" rx="10" className={box} />
        <text x="644" y="98" textAnchor="middle" className="fill-foreground text-sm font-bold">
          Share
        </text>
        <text x="644" y="116" textAnchor="middle" className="fill-foreground text-sm font-bold">
          tokens
        </text>
      </g>
      <line x1="531" y1="92" x2="590" y2="92" className="lp-flow stroke-foreground" />
      <polyline points="584,88 590,92 584,96" className="stroke-foreground" />
      <line
        x1="531"
        y1="110"
        x2="590"
        y2="110"
        className="lp-flow stroke-muted-foreground [animation-direction:reverse]"
      />
      <polyline points="537,106 531,110 537,114" className="stroke-muted-foreground" />
      <text x="560" y="84" textAnchor="middle" className="fill-muted-foreground text-[11px]">
        mint
      </text>
      <text x="560" y="128" textAnchor="middle" className="fill-muted-foreground text-[11px]">
        burn
      </text>
    </svg>
  );
}

export function IndexToken() {
  return (
    <Reveal
      className={cn(
        WRAP,
        "grid items-start gap-12 pt-32 md:pt-36 lg:grid-cols-[5fr_7fr] lg:gap-20",
      )}
    >
      <div className="flex flex-col gap-5">
        <span className={cn(EYEBROW, "lp-rv")}>Index = token</span>
        <h2 className={cn(H2, "lp-rv")} style={rv(1)}>
          A real index token, not a copied portfolio.
        </h2>
        <p className={cn(LEAD, "lp-rv")} style={rv(2)}>
          Each index is a vault owned by a Solana program plus its own share mint. Joining deposits
          every asset in the vault&apos;s exact ratio and mints shares; redeeming burns shares for
          the underlying — ETF-style, in-kind. After the first deposit no oracle is needed, which
          makes it hard to manipulate. The app zaps USDC in and out for you.
        </p>
        <div className="mt-2 flex flex-col text-[15px]">
          {[
            "Up to 10 assets per index",
            "In-kind mint and redeem, USDC zap",
            "Redeem can never be blocked by the creator",
            "Fully self-custodied — no one holds your funds",
          ].map((t, i) => (
            <span
              key={t}
              className="lp-rv flex items-center gap-2.5 border-t border-hairline py-3 last:border-b"
              style={rv(i + 3)}
            >
              <Check className="size-4 shrink-0 text-mark-2" aria-hidden />
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-7">
        <div className="lp-rv rounded-2xl border bg-surface p-5 sm:p-8" style={rv(1)}>
          <FlowDiagram />
          <p className="mt-4 text-[13px] text-muted-foreground">
            Join runs left to right. Redeem burns shares and returns the underlying, or USDC through
            the same zap.
          </p>
        </div>
        <div className="flex flex-col">
          <div className="grid h-10 grid-cols-[minmax(0,1fr)_72px_72px_56px] items-center border-b text-[13px] font-semibold text-muted-foreground sm:grid-cols-[minmax(0,1fr)_110px_110px_90px]">
            <span>Asset</span>
            <span className="text-right">Weight</span>
            <span className="text-right">Target</span>
            <span className="text-right">Drift</span>
          </div>
          {ALLOC.map(([t, w], i) => (
            <div
              key={t}
              className="lp-rv grid h-12 grid-cols-[minmax(0,1fr)_72px_72px_56px] items-center border-b border-hairline text-[15px] sm:grid-cols-[minmax(0,1fr)_110px_110px_90px]"
              style={rv(i + 2)}
            >
              <span className="flex items-center gap-2.5">
                <span className={cn("size-2.5 rounded-[2px]", MARK_BG[i])} />
                <Mono className="text-[13px]">{t}</Mono>
              </span>
              <CountUp value={w} suffix="%" className="text-right font-bold" />
              <span className="num text-right text-muted-foreground">{w}%</span>
              <span className="num text-right text-muted-foreground">0%</span>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

/* ─── Mandate ────────────────────────────────────────────────────────── */

const GUARDS = [
  ["Rebalancing", "Rebalance when drift > 5%"],
  ["Max slippage", "1%"],
  ["Cooldown", "30s"],
  ["Keeper", "Allowed"],
  ["Update timelock", "120s on devnet"],
];
const TX = ["begin_rebalance", "swap", "return proceeds", "end_rebalance"];
const CYCLE = 8; // 4 steps + outcome held for 4 ticks

/** Plays the 4-instruction sandwich on a loop, alternating commit and revert. */
function AtomicTx() {
  const [ref, inView] = useInView<HTMLDivElement>({ once: false, threshold: 0.4 });
  const reduced = useReducedMotion();
  const [t, setT] = useState(-1);
  useInterval(() => setT((x) => x + 1), 750, inView && !reduced);
  const phase = t < 0 ? -1 : t % CYCLE;
  const outcome = t < 0 || phase < 4 ? null : Math.floor(t / CYCLE) % 2 === 0 ? "commit" : "revert";
  return (
    <div
      ref={ref}
      className="grid gap-6 rounded-2xl border border-dashed p-5 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center sm:p-6"
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted-foreground">1 atomic transaction</span>
        {TX.map((s, i) => {
          const active = phase === i;
          const done = phase > i || outcome !== null;
          const failed = outcome === "revert" && i === 3;
          return (
            <span
              key={s}
              className={cn(
                "mono flex items-center justify-between rounded-[10px] border bg-surface px-3 py-2.5 text-[13px] transition-all duration-300",
                active && "translate-x-1 border-mark-2 bg-raised",
                failed && "border-down/60 text-down",
              )}
            >
              <span>
                {i + 1} · {s}
              </span>
              {failed ? (
                <X className="size-3.5" aria-hidden />
              ) : done ? (
                <Check className="size-3.5 text-mark-2" aria-hidden />
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="flex flex-col gap-3">
        <span
          className={cn(
            "flex flex-col gap-1 rounded-[10px] border p-3.5 transition-all duration-500",
            outcome === "commit" && "scale-[1.03] border-up/70 bg-up/10",
          )}
        >
          <span className={cn("text-[15px] font-bold", outcome === "commit" && "text-up")}>
            Commit
          </span>
          <span className="text-[13px] text-muted-foreground">
            Slippage within limit, every weight closer to target
          </span>
        </span>
        <span
          className={cn(
            "flex flex-col gap-1 rounded-[10px] border border-down/30 p-3.5 transition-all duration-500",
            outcome === "revert" && "scale-[1.03] border-down/70 bg-down/10",
          )}
        >
          <span className="text-[15px] font-bold text-down">Revert</span>
          <span className="text-[13px] text-muted-foreground">
            Any check fails — nothing happened
          </span>
        </span>
      </div>
    </div>
  );
}

export function Mandate() {
  return (
    <Reveal className={cn(WRAP, "flex flex-col gap-12 pt-32 md:pt-36")}>
      <div className="grid items-end gap-6 lg:grid-cols-[5fr_7fr] lg:gap-20">
        <div className="flex flex-col gap-5">
          <span className={cn(EYEBROW, "lp-rv")}>The mandate</span>
          <h2 className={cn(H2, "lp-rv")} style={rv(1)}>
            Rules the program enforces. Not promises.
          </h2>
        </div>
        <p className={cn(LEAD, "lp-rv")} style={rv(2)}>
          Every index carries a mandate: when to rebalance, how much slippage is allowed, how long
          to wait between trades, whether a keeper may act, and a timelock on any change to weights
          or fees — so holders see changes coming and can exit first.
        </p>
      </div>
      <div className="grid items-start gap-12 lg:grid-cols-[5fr_7fr] lg:gap-20">
        <div className="flex flex-col">
          <h3 className="lp-rv mb-2 text-base font-bold">Strategy &amp; guards</h3>
          {GUARDS.map(([k, v], i) => (
            <div
              key={k}
              className="lp-rv flex h-[50px] items-center justify-between gap-4 border-t border-hairline text-[15px]"
              style={rv(i + 1)}
            >
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right font-semibold">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <div className="lp-rv flex flex-col gap-2" style={rv(1)}>
            <h3 className="text-[22px] font-bold tracking-[-0.01em]">
              One transaction. All or nothing.
            </h3>
            <p className="text-[15px] leading-[1.65] text-muted-foreground">
              <Mono className="text-foreground">begin_rebalance</Mono> lends the overweight asset →
              swap → return the proceeds → <Mono className="text-foreground">end_rebalance</Mono>{" "}
              checks slippage against the oracle and that every weight moved closer to target. If
              not, the whole transaction reverts. While a rebalance is open, every other index
              instruction is refused.
            </p>
          </div>
          <div className="lp-rv" style={rv(2)}>
            <AtomicTx />
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/* ─── Pre-IPO ────────────────────────────────────────────────────────── */

export function PreIpo() {
  return (
    <section id="pre-ipo" className="mt-32 scroll-mt-16 border-y bg-surface md:mt-36">
      <div className={cn(WRAP, "flex flex-col gap-14 py-20 md:py-28")}>
        <Reveal className="grid items-end gap-6 lg:grid-cols-[7fr_5fr] lg:gap-20">
          <div className="flex flex-col gap-5">
            <span className={cn(EYEBROW, "lp-rv")}>Pre-IPO · powered by PreStocks data</span>
            <h2
              className="lp-rv text-[36px] leading-[1.02] font-extrabold tracking-[-0.045em] md:text-[56px]"
              style={rv(1)}
            >
              Hold SpaceX before the IPO. Never miss the conversion.
            </h2>
          </div>
          <p className={cn(LEAD, "lp-rv")} style={rv(2)}>
            Add PreStocks pre-IPO names — SpaceX, OpenAI, Anthropic, Anduril — to any index. When
            the company lists, the vault converts the pre-IPO token into the listed stock for every
            holder at once and keeps the weight. It&apos;s the SpaceX → SPCXx conversion PreStocks
            holders had to do by hand before a deadline, done automatically.
          </p>
        </Reveal>

        <Reveal className="flex flex-col gap-2.5">
          <span className="flex items-center gap-2.5">
            <span className="text-base font-bold">Pre-IPO</span>
            <Tag>PreStocks</Tag>
            <Tag>Read-only</Tag>
          </span>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid h-11 grid-cols-[minmax(0,1fr)_repeat(3,130px)_150px] items-center border-b text-[13px] font-semibold text-muted-foreground lg:grid-cols-[minmax(0,1fr)_160px_160px_160px_180px]">
                <span>Asset</span>
                <span className="text-right">Token</span>
                <span className="text-right">Mark</span>
                <span className="text-right">Premium</span>
                <span className="text-right">Implied val.</span>
              </div>
              <div className="grid h-16 grid-cols-[minmax(0,1fr)_repeat(3,130px)_150px] items-center border-b border-hairline text-[17px] lg:grid-cols-[minmax(0,1fr)_160px_160px_160px_180px]">
                <span className="flex items-center gap-3">
                  <Mono className="text-sm">SPACEX-pre</Mono>
                  <span className="text-sm text-muted-foreground">SpaceX</span>
                </span>
                <CountUp value={116.87} decimals={2} prefix="$" className="text-right font-bold" />
                <CountUp value={149.15} decimals={2} prefix="$" className="text-right" />
                <CountUp
                  value={-21.6}
                  decimals={1}
                  suffix="%"
                  className="text-right font-bold text-down"
                />
                <CountUp value={1.5} decimals={1} prefix="$" suffix="T" className="text-right" />
              </div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            Token = PreStocks on-chain price · Mark = PreStocks reference price · Premium = token ÷
            mark − 1
          </span>
        </Reveal>

        <div className="grid items-start gap-12 lg:grid-cols-[7fr_5fr] lg:gap-20">
          <div className="flex flex-col gap-7">
            <Reveal className="relative grid grid-cols-3" threshold={0.5}>
              <span aria-hidden className="absolute top-[7px] right-1/3 left-2 h-px bg-border" />
              <span
                aria-hidden
                className="lp-grow-x absolute top-[7px] right-0 left-1/3 h-px bg-mark-2"
                style={css({ "--d": "500ms" })}
              />
              {[
                [
                  "Pre-IPO",
                  <>
                    <Mono className="text-sm">SPACEX-pre</Mono> 10%
                  </>,
                  false,
                ],
                ["IPO event", "Vault converts", true],
                [
                  "Listed",
                  <>
                    <Mono className="text-sm">SPCXx</Mono> 10%
                  </>,
                  false,
                ],
              ].map(([k, v, solid], i) => (
                <span key={k as string} className="relative flex flex-col gap-2.5 pr-2">
                  <span
                    className={cn(
                      "lp-pop box-border size-[15px] rounded-full",
                      solid ? "lp-ping bg-mark-2 text-mark-2" : "border-2 border-mark-2 bg-surface",
                    )}
                    style={css({ "--d": `${i * 450}ms` })}
                  />
                  <span className="text-[13px] text-muted-foreground">{k}</span>
                  <span className="text-[15px] font-bold sm:text-base">{v}</span>
                </span>
              ))}
            </Reveal>
            <Reveal className="grid gap-4 sm:grid-cols-2">
              <div
                className="lp-rv lp-lift flex flex-col gap-1.5 rounded-[10px] border border-warn/30 p-[18px]"
                style={rv(1)}
              >
                <span className="text-[13px] font-semibold text-warn">Direct holders</span>
                <span className="text-[15px]">Swap before Mar 12, 2027 or tokens expire.</span>
              </div>
              <div
                className="lp-rv lp-lift flex flex-col gap-1.5 rounded-[10px] border bg-background p-[18px]"
                style={rv(2)}
              >
                <span className="text-[13px] font-semibold text-up">{APP_NAME} index</span>
                <span className="text-[15px]">Migrated automatically, weight kept.</span>
              </div>
            </Reveal>
          </div>
          <Reveal className="flex flex-col text-[15px] leading-[1.5]">
            {[
              "Prices, mark price, premium and implied valuation read live from the PreStocks API",
              "IPO migration keeps value continuous — no gap, no manual swap",
              "Followers of the index migrate too",
            ].map((t, i) => (
              <span key={t} className="lp-rv border-t py-3.5 last:border-b" style={rv(i + 1)}>
                {t}
              </span>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
