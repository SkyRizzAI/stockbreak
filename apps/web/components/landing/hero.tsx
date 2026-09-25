"use client";
import { cn } from "cn";
import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useInterval, useReducedMotion, useTween } from "./motion";
import { AllocBar, MarkTile, Mono, PrimaryCta, Tag, WRAP } from "./ui";

const HEADLINE = "Turn your stock thesis into an index token.";
const MAG = [96, 92, 94, 86, 88, 80, 82, 74, 70, 72, 62, 58, 60, 50, 44, 46, 38, 34, 30, 32, 24];
const SPY = [96, 95, 97, 93, 94, 91, 92, 90, 89, 90, 86, 85, 86, 84, 82, 83, 81, 80, 79, 80, 78];
const W = 564;
const pts = (ys: number[]) =>
  ys.map((y, i) => `${((i * W) / (ys.length - 1)).toFixed(1)},${y}`).join(" ");

/** Pointer position over the hero visual as -1..1 CSS vars, for layered parallax. */
function useParallax() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || !window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    let tx = 0;
    let ty = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty("--px", tx.toFixed(3));
      el.style.setProperty("--py", ty.toFixed(3));
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      tx = 0;
      ty = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [reduced]);
  return ref;
}

/** Parallax layer: moves `depth` px with the pointer, eased. */
const layer = (depth: number): CSSProperties => ({
  transform: `translate3d(calc(var(--px, 0) * ${depth}px), calc(var(--py, 0) * ${depth}px), 0)`,
  transition: "transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1)",
});

/** A simulated price that drifts every few seconds, flashing on each tick. */
function useLivePrice(start: number) {
  const [state, setState] = useState({ p: start, dir: 0, n: 0 });
  const reduced = useReducedMotion();
  useInterval(
    () =>
      setState((s) => {
        // Random walk pulled back towards the start so it never runs away.
        const step = (Math.random() - 0.5) * 0.0024 + (start - s.p) * 0.2;
        return { p: s.p + step, dir: Math.sign(step), n: s.n + 1 };
      }),
    2800,
    !reduced,
  );
  return state;
}

function HeroCard() {
  const live = useLivePrice(1);
  const d24 = useTween(0.55 + (live.p - 1) * 100, { duration: 900 });
  const d7 = useTween(2.38, { duration: 1600 });
  return (
    <Link
      href="/explore"
      className="flex w-full flex-col gap-[22px] rounded-2xl border bg-surface px-5 pt-5 pb-14 sm:px-7 sm:pt-7 lg:pb-7 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.6)] transition-colors hover:border-mark-3 sm:p-7"
    >
      <span className="flex flex-wrap items-start justify-between gap-3">
        <span className="flex items-center gap-3.5">
          <MarkTile size={48} />
          <span className="flex flex-col gap-1">
            <span className="flex items-baseline gap-2">
              <span className="text-[19px] font-bold">Magnificent Four</span>
              <Mono className="text-xs text-muted-foreground">MAG4</Mono>
            </span>
            <span className="text-[13px] text-muted-foreground">by @alice</span>
          </span>
        </span>
        <span className="flex gap-1.5">
          <Tag className="hidden sm:inline-flex">Pre-IPO · PreStocks</Tag>
          <Tag>Simulated</Tag>
        </span>
      </span>
      <span className="flex items-baseline gap-5">
        <span
          key={live.n}
          className={cn(
            "num text-[40px] font-extrabold tracking-[-0.04em] sm:text-5xl",
            live.dir > 0 && "lp-flash-up",
            live.dir < 0 && "lp-flash-down",
          )}
        >
          ${live.p.toFixed(4)}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">24h</span>
          <span className={cn("num text-base font-bold", d24 >= 0 ? "text-up" : "text-down")}>
            {d24 >= 0 ? "+" : ""}
            {d24.toFixed(2)}%
          </span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">7d</span>
          <span className="num text-base font-bold text-up">+{d7.toFixed(2)}%</span>
        </span>
      </span>
      <span className="flex flex-col gap-2">
        <span className="flex justify-between text-[13px] text-muted-foreground">
          <span className="font-semibold">Is it beating SPYx?</span>
          <span className="flex gap-3.5">
            <span className="flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden>
                <line x1="0" y1="2" x2="14" y2="2" className="stroke-up" strokeWidth="2" />
              </svg>
              MAG4
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="14" height="4" aria-hidden>
                <line
                  x1="0"
                  y1="2"
                  x2="14"
                  y2="2"
                  className="stroke-muted-foreground"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
              </svg>
              SPYx
            </span>
          </span>
        </span>
        <svg
          viewBox={`0 0 ${W} 130`}
          className="h-auto w-full overflow-visible"
          fill="none"
          role="img"
          aria-label="MAG4 against SPYx, simulated"
        >
          <defs>
            <linearGradient id="lp-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--up)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--up)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="1" x2={W} y2="1" className="stroke-hairline" />
          <line x1="0" y1="65" x2={W} y2="65" className="stroke-hairline" />
          <line x1="0" y1="129" x2={W} y2="129" className="stroke-border" />
          <polygon
            points={`0,130 ${pts(MAG)} ${W},130`}
            fill="url(#lp-area)"
            className="lp-enter"
            style={{ "--d": "1500ms" } as CSSProperties}
          />
          <polyline
            points={pts(SPY)}
            className="stroke-muted-foreground lp-enter"
            strokeWidth="1.5"
            strokeDasharray="3 4"
            style={{ "--d": "700ms" } as CSSProperties}
          />
          <polyline
            points={pts(MAG)}
            pathLength={1}
            className="lp-draw-now stroke-up"
            strokeWidth="2"
            strokeLinejoin="round"
            style={{ "--d": "650ms", "--dur": "1500ms" } as CSSProperties}
          />
          <g className="lp-enter" style={{ "--d": "2000ms" } as CSSProperties}>
            <circle cx={W} cy={24} r="4" className="lp-svg-ping fill-up" />
            <circle cx={W} cy={24} r="4" className="fill-up" />
          </g>
        </svg>
      </span>
      <span className="flex flex-col gap-2.5">
        <AllocBar weights={[40, 30, 20, 10]} grow now delay={900} />
        <span className="flex flex-wrap gap-x-[18px] gap-y-1 text-[13px]">
          {[
            ["AAPLx", 40],
            ["NVDAx", 30],
            ["TSLAx", 20],
            ["SPACEX-pre", 10],
          ].map(([t, w]) => (
            <span key={t}>
              <Mono className="text-muted-foreground">{t}</Mono> {w}%
            </span>
          ))}
        </span>
      </span>
    </Link>
  );
}

function JoinCard() {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGo(true), 1300);
    return () => window.clearTimeout(t);
  }, []);
  const amount = useTween(1000, { run: go, duration: 1200 });
  return (
    <div className="flex w-[240px] flex-col gap-3 rounded-2xl border bg-raised p-[18px] shadow-[0_24px_60px_-30px_rgb(0_0_0/0.7)] sm:w-[260px]">
      <span className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">Amount (USDC)</span>
        <span className="num flex h-10 items-center rounded-[10px] border bg-background px-3 text-[17px] font-bold">
          {Math.round(amount).toLocaleString("en-US")}
          <span className="ml-0.5 h-5 w-px animate-pulse bg-foreground/60" aria-hidden />
        </span>
      </span>
      <span className="flex justify-between text-[13px]">
        <span className="text-muted-foreground">Estimated shares</span>
        <span className="num font-bold">{(amount * 0.98209).toFixed(2)}</span>
      </span>
      <Link
        href="/explore"
        className="lp-shine flex h-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
      >
        Join
      </Link>
    </div>
  );
}

export function Hero() {
  const visual = useParallax();
  const words = HEADLINE.split(" ");
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="lp-grid-bg" />
      <div aria-hidden className="lp-glow -top-40 right-[-10%] h-[520px] w-[620px]" />
      <div
        aria-hidden
        className="lp-glow bottom-[-30%] left-[-15%] h-[420px] w-[520px] opacity-60"
        style={{ animationDelay: "-9s" }}
      />
      <div
        className={cn(
          WRAP,
          "relative grid items-center gap-14 pt-16 pb-20 lg:grid-cols-[5fr_7fr] lg:gap-16 lg:pt-[104px] lg:pb-24",
        )}
      >
        <div className="flex flex-col">
          <span className="lp-enter text-sm font-semibold text-muted-foreground">
            The index launchpad for tokenized stocks, on Solana
          </span>
          <h1 className="mt-5 text-[42px] leading-[1.02] font-extrabold tracking-[-0.045em] sm:text-[56px] xl:text-[64px]">
            {words.map((w, i) => (
              <span key={w}>
                <span className="lp-word" style={{ "--i": i } as CSSProperties}>
                  {w}
                </span>{" "}
              </span>
            ))}
          </h1>
          <p
            className="lp-enter mt-6 text-[17px] leading-[1.6] text-muted-foreground sm:text-lg"
            style={{ "--d": "550ms" } as CSSProperties}
          >
            Pick up to 10 tokenized stocks and pre-IPO names, set the weights and the rules. Others
            join with USDC in one click or one Blink. A Solana vault program enforces the
            rebalancing — not us.
          </p>
          <div
            className="lp-enter mt-9 flex flex-wrap items-center gap-3"
            style={{ "--d": "700ms" } as CSSProperties}
          >
            <PrimaryCta />
            <a
              href="#how"
              className="flex h-[52px] items-center rounded-[10px] border px-5 text-[15px] font-semibold transition-colors hover:border-mark-3 hover:bg-surface"
            >
              See how it works
            </a>
          </div>
          <p
            className="lp-enter mt-6 text-[13px] text-muted-foreground"
            style={{ "--d": "850ms" } as CSSProperties}
          >
            Self-custodied · Redeem anytime · Rules enforced on-chain · PreStocks pre-IPO
          </p>
          <p
            className="lp-enter mt-2 flex items-center gap-2 text-xs text-muted-foreground/75"
            style={{ "--d": "950ms" } as CSSProperties}
          >
            <span className="lp-ping size-1.5 rounded-full bg-up text-up" aria-hidden />
            Live on Solana devnet. Assets are simulated; prices follow real market data. Not
            investment advice.
          </p>
        </div>

        <div ref={visual} className="relative lg:h-[560px]">
          {/* Back layer: the treemap tile peeking behind. */}
          <div className="absolute top-0 right-0 hidden lg:block" style={layer(-10)}>
            <div className="lp-enter" style={{ "--d": "250ms" } as CSSProperties}>
              <div
                aria-hidden
                className="lp-float flex h-[120px] w-[560px] max-w-[70vw] gap-1.5 rounded-2xl border bg-surface p-4 opacity-55"
                style={{ "--fd": "-3s" } as CSSProperties}
              >
                {[
                  ["NVDAx", 4],
                  ["MSFTx", 3.5],
                  ["ANTHRP-pre", 2.5],
                ].map(([t, g]) => (
                  <span
                    key={t}
                    className="mono rounded-[8px] bg-raised p-2.5 text-xs text-muted-foreground"
                    style={{ flexGrow: g as number }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {/* Main card. */}
          <div
            className="relative lg:absolute lg:top-10 lg:left-0 lg:w-[92%] xl:w-[620px]"
            style={layer(6)}
          >
            <div className="lp-enter" style={{ "--d": "350ms" } as CSSProperties}>
              <HeroCard />
            </div>
          </div>
          {/* Front layer: the join ticket. */}
          <div
            className="relative -mt-8 ml-auto w-fit lg:absolute lg:right-0 lg:bottom-0 lg:mt-0"
            style={layer(18)}
          >
            <div className="lp-enter-right" style={{ "--d": "900ms" } as CSSProperties}>
              <div className="lp-float" style={{ "--fd": "-1s" } as CSSProperties}>
                <JoinCard />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
