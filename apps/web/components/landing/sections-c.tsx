"use client";
import { explorerAddress } from "@repo/config";
import { cn } from "cn";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, useId, useState } from "react";
import { CopyButton } from "@/components/data/addr";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";
import { CountUp, Reveal, rv } from "./motion";
import {
  APP_HREF,
  GITHUB_URL,
  H2,
  LogoMark,
  MARK_BG,
  Mono,
  PrimaryCta,
  TextLink,
  WRAP,
} from "./ui";

/* ─── Who it's for ───────────────────────────────────────────────────── */

export function WhoFor() {
  const people = [
    {
      h: "Investors",
      s: "You want a theme, not ten tickers.",
      b: "Join an index with USDC from Phantom, hold one token, and let the rules keep it balanced. Redeem anytime.",
      note: "Global retail, outside the US, already holding USDC",
      cta: ["Explore indexes", "/explore"],
    },
    {
      h: "Creators",
      s: "You already have the thesis and the audience.",
      b: "Publish an index, share it as a card or a Blink, and earn fees plus a royalty on every clone.",
      cta: ["Create an index", "/create"],
    },
    {
      h: "AI agent builders",
      s: "You want your agent to trade with guardrails.",
      b: "Plug in over MCP, manage indexes within an on-chain mandate, and compete in the Human vs AI league.",
      cta: ["Connect an agent", "/agents"],
    },
  ];
  return (
    <Reveal className={cn(WRAP, "flex flex-col gap-12 pt-32 md:pt-36")}>
      <h2 className={cn(H2, "lp-rv")}>Built for three kinds of people.</h2>
      <div className="grid gap-10 md:grid-cols-3 md:gap-12">
        {people.map((p, i) => (
          <div key={p.h} className="lp-rv relative flex flex-col gap-3 pt-5" style={rv(i + 1)}>
            <span
              aria-hidden
              className="lp-grow-x absolute inset-x-0 top-0 h-px bg-border"
              style={{ "--i": i, "--d": "200ms" } as CSSProperties}
            />
            <h3 className="text-[22px] font-bold">{p.h}</h3>
            <span className="text-[17px] font-semibold">{p.s}</span>
            <p className="text-[15px] leading-[1.6] text-muted-foreground">{p.b}</p>
            {p.note ? <span className="text-[13px] text-muted-foreground/75">{p.note}</span> : null}
            <TextLink href={p.cta[1] as string} className="mt-1.5">
              {p.cta[0]}
            </TextLink>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

/* ─── Comparison ─────────────────────────────────────────────────────── */

const COMPARE = [
  ["Index is a real token (in-kind mint/redeem)", "Copied into each wallet", "Some"],
  ["Rebalance rules enforced on-chain", "Off-chain", "No"],
  ["Creator fees + clone royalties", "No", "Fees only, if any"],
  ["Pre-IPO sleeve that migrates at IPO", "No", "No"],
  ["AI managers that cannot withdraw", "No", "No"],
  ["Feed, index cards, Blinks, Human vs AI", "Partial", "Partial"],
];

export function Compare() {
  const cols =
    "grid-cols-[minmax(0,1fr)_170px_200px_170px] lg:grid-cols-[minmax(0,1fr)_200px_220px_200px]";
  return (
    <Reveal className={cn(WRAP, "flex flex-col gap-10 pt-32 md:pt-36")}>
      <h2 className={cn(H2, "lp-rv")}>What makes it different.</h2>
      <div className="lp-rv overflow-x-auto" style={rv(1)}>
        <div className="flex min-w-[760px] flex-col">
          <div className={cn("grid h-14 items-center border-b text-sm font-bold", cols)}>
            <span />
            <span className="flex h-full items-center gap-2 rounded-t-[10px] bg-surface px-5">
              <LogoMark size={18} />
              {APP_NAME}
            </span>
            <span className="px-5 text-muted-foreground">Copy-portfolio apps</span>
            <span className="px-5 text-muted-foreground">Basket apps</span>
          </div>
          {COMPARE.map(([f, b, c], i) => (
            <div
              key={f}
              className={cn(
                "grid h-[60px] items-center border-b border-hairline text-[15px]",
                cols,
              )}
            >
              <span className="lp-rv pr-4" style={rv(i + 2)}>
                {f}
              </span>
              <span className="flex h-full items-center gap-2 bg-surface px-5 font-bold">
                <span
                  className="lp-pop flex size-5 items-center justify-center rounded-full bg-up/15 text-up"
                  style={{ "--d": `${300 + i * 110}ms` } as CSSProperties}
                >
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                </span>
                Yes
              </span>
              <span className="lp-rv px-5 text-muted-foreground" style={rv(i + 2)}>
                {b}
              </span>
              <span className="lp-rv px-5 text-muted-foreground" style={rv(i + 2)}>
                {c}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

/* ─── Why Solana ─────────────────────────────────────────────────────── */

const SOLANA = [
  ["~$0.001 per transaction", "A 10-asset join, redeem or rebalance is practical, not a luxury."],
  [
    "Atomic multi-instruction transactions",
    "The flash-rebalance sandwich and USDC zaps are all-or-nothing.",
  ],
  [
    "Where tokenized stocks live",
    "The widest set of stock issuers (xStocks, Ondo, Backpack) and the only pre-IPO issuers, with Jupiter and Raydium as liquidity.",
  ],
  [
    "Token-2022 + Blinks",
    "Corporate actions handled at the token level, and any index becomes a one-click join from X.",
  ],
];

export function WhySolana() {
  return (
    <Reveal
      className={cn(
        WRAP,
        "grid items-start gap-10 pt-32 md:pt-36 lg:grid-cols-[4fr_8fr] lg:gap-20",
      )}
    >
      <h2 className={cn(H2, "lp-rv lg:sticky lg:top-28")}>Why this only works on Solana.</h2>
      <div className="grid gap-x-12 sm:grid-cols-2">
        {SOLANA.map(([k, v], i) => (
          <div key={k} className="lp-rv flex flex-col gap-2 border-t py-6" style={rv(i + 1)}>
            <span className="text-[19px] font-bold">{k}</span>
            <span className="text-[15px] leading-[1.6] text-muted-foreground">{v}</span>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

/* ─── Trust ──────────────────────────────────────────────────────────── */

const TRUST = [
  [
    "Program-owned vaults",
    "Assets sit in accounts owned by a program address. Only a shareholder's redeem moves them out.",
  ],
  ["Redeem can't be blocked", "Creator fees are booked as owed shares and claimed separately."],
  ["Managers can't withdraw", "Agents and managers can only rebalance, within the mandate."],
  [
    "Locked during rebalance",
    "While a rebalance ticket is open, every other index instruction is refused.",
  ],
  [
    "Internal accounting",
    "Balances are tracked by the program, so tokens sent straight to a vault can't skew the math.",
  ],
  [
    "Checked math",
    "128-bit checked arithmetic, rounding always in favour of the vault, every CPI and account validated.",
  ],
];

export type ProgramIds = { indexVault: string; mockMarket: string };

export function Trust({ programs }: { programs: ProgramIds }) {
  return (
    <Reveal className={cn(WRAP, "flex flex-col gap-10 pt-32 md:pt-36")}>
      <h2 className={cn(H2, "lp-rv max-w-[760px]")}>
        Designed so no one can run off with the vault.
      </h2>
      <div className="grid gap-x-16 md:grid-cols-2">
        {TRUST.map(([k, v], i) => (
          <div
            key={k}
            className="lp-rv grid gap-2 border-t border-hairline py-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-5 lg:grid-cols-[220px_minmax(0,1fr)]"
            style={rv(i + 1)}
          >
            <span className="text-base font-bold">{k}</span>
            <span className="text-[15px] leading-[1.6] text-muted-foreground">{v}</span>
          </div>
        ))}
      </div>
      <div className="lp-rv flex flex-col gap-2" style={rv(7)}>
        <span className="text-[13px] font-semibold text-muted-foreground">
          Program IDs · devnet
        </span>
        {[
          ["index_vault", programs.indexVault],
          ["mock_market", programs.mockMarket],
        ].map(([name, id]) => (
          <span key={name} className="flex min-w-0 items-center gap-2 text-[13px]">
            <a
              href={explorerAddress("devnet", id as string)}
              target="_blank"
              rel="noreferrer"
              className="group mono flex min-w-0 items-center gap-2 hover:text-foreground"
            >
              <span className="shrink-0 text-muted-foreground">{name}</span>
              <span className="truncate group-hover:underline">{id}</span>
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            </a>
            <CopyButton text={id as string} label={`Copy ${name} program ID`} />
          </span>
        ))}
      </div>
    </Reveal>
  );
}

/* ─── Tests ──────────────────────────────────────────────────────────── */

const TESTS = [
  [38, "program tests (success + failure per error)"],
  [93, 'end-to-end tests, incl. 19 "what can go wrong" scenarios'],
  [59, "SDK tests, math parity with the program"],
  [20, "MCP tools"],
] as const;

const STACK =
  "Anchor 1.2 · LiteSVM · Surfpool · @solana/kit + Codama · Wallet Standard · Next.js 16 · shadcn/ui · PostgreSQL + Drizzle · MCP TypeScript SDK · Solana Actions/Blinks · Playwright · Bun + Turborepo";

export function Tests() {
  return (
    <section className="mt-32 border-y bg-surface md:mt-36">
      <Reveal className={cn(WRAP, "flex flex-col gap-9 py-16")}>
        <h2 className={cn(H2, "lp-rv")}>Tested like it holds real money.</h2>
        <div className="grid grid-cols-2 gap-y-8 md:grid-cols-4">
          {TESTS.map(([v, l], i) => (
            <span
              key={l}
              className={cn(
                "lp-rv flex flex-col gap-1.5 px-4 md:px-7",
                i % 2 === 1 && "border-l",
                i >= 2 && "md:border-l",
                i === 0 && "pl-0 md:pl-0",
                i === 2 && "pl-0 md:pl-7",
              )}
              style={rv(i + 1)}
            >
              <CountUp
                value={v}
                duration={1600}
                className="text-[44px] leading-none font-extrabold tracking-[-0.04em] md:text-[56px]"
              />
              <span className="text-sm leading-[1.5] text-muted-foreground">{l}</span>
            </span>
          ))}
        </div>
        <p
          className="lp-rv mono border-t pt-6 text-[13px] leading-[1.8] text-muted-foreground"
          style={rv(5)}
        >
          {STACK}
        </p>
        <div className="lp-rv flex flex-wrap gap-8" style={rv(6)}>
          <TextLink href={GITHUB_URL}>Read the code on GitHub</TextLink>
        </div>
      </Reveal>
    </section>
  );
}

/* ─── Try it ─────────────────────────────────────────────────────────── */

const PHANTOM = [
  "Phantom → Settings → Developer Settings → Testnet Mode → Solana Devnet.",
  "Open the app and connect.",
  "Grab SOL and simulated USDC at /faucet.",
  "Join Magnificent Four with $100.",
];
const DEV = [
  "Open the app → Connect → Dev wallet.",
  "It's funded automatically.",
  "Join, create, share — everything works.",
];

export function TryIt() {
  const list = (title: string, steps: string[], offset: number) => (
    <div
      className="lp-rv lp-lift flex flex-col gap-4 rounded-2xl border p-6 sm:p-7"
      style={rv(offset)}
    >
      <h3 className="text-[19px] font-bold">{title}</h3>
      {steps.map((t, i) => (
        <div key={t} className="grid grid-cols-[32px_minmax(0,1fr)] text-[15px] leading-[1.55]">
          <Mono className="text-[13px] text-muted-foreground">0{i + 1}</Mono>
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
  return (
    <Reveal
      id="try"
      className={cn(
        WRAP,
        "grid items-start gap-10 pt-32 md:pt-36 lg:grid-cols-[4fr_8fr] lg:gap-20",
      )}
    >
      <div className="flex flex-col gap-6">
        <h2 className={cn(H2, "lp-rv")}>Try it now. No real money involved.</h2>
        <div className="lp-rv" style={rv(1)}>
          <PrimaryCta />
        </div>
        <span className="lp-rv text-sm leading-[1.6] text-muted-foreground" style={rv(2)}>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="lp-link font-bold text-foreground"
          >
            Run it locally
          </a>{" "}
          — move prices, time-travel 30 days, trigger an IPO.
        </span>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {list("With Phantom (devnet)", PHANTOM, 2)}
        {list("With the built-in dev wallet", DEV, 3)}
      </div>
    </Reveal>
  );
}

/* ─── FAQ ────────────────────────────────────────────────────────────── */

function faq(app: string) {
  return [
    [
      "Is this real money?",
      `No. ${app} runs on Solana devnet. Every asset is a simulated token that mirrors the real one; prices follow real market data (PreStocks API, Jupiter), read-only.`,
    ],
    [
      "Why not mainnet yet?",
      "Buying real tokenized stocks needs jurisdiction checks (issuers serve non-US users only) and real liquidity routing. Going live means swapping in the real mints, routing through Jupiter/Raydium and handling PreStocks' Token-2022 transfer fee.",
    ],
    [
      "Who holds my funds?",
      "You do, until you join. Then a Solana program holds them in the index vault, and only your redeem can take your share out. Not the creator, not an AI manager, not us.",
    ],
    [
      "Can the creator stop me from redeeming?",
      "No. Fees are booked separately, so redeem always works.",
    ],
    [
      "What happens when a pre-IPO company lists?",
      "The vault converts the pre-IPO token into the listed stock token for every holder and keeps the weight. Followers migrate too.",
    ],
    [
      "What's the difference between Join, Clone and Follow?",
      "Join buys into an index as it is. Clone creates your own index from its composition (the original creator earns a royalty). Follow creates your own vault that automatically tracks the parent's weights.",
    ],
    [
      "How does an AI agent connect?",
      `Over MCP. Add the ${app} server to Claude, Cursor or any MCP client. By default the agent only prepares requests that you sign; an agent with its own wallet can rebalance as a manager but can never withdraw.`,
    ],
    [
      "Which assets are available?",
      "Tokenized US stocks (AAPLx, NVDAx, TSLAx, MSFTx, GOOGLx, AMZNx, METAx), SPYx as the benchmark, and PreStocks pre-IPO tokens (SpaceX, OpenAI, Anthropic, Anduril). Up to 10 per index.",
    ],
    ["Is this investment advice?", "No."],
  ];
}

function FaqItem({ q, a, i }: { q: string; a: string; i: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="lp-rv border-b" style={rv(i)}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center justify-between gap-4 py-5 text-left text-[17px] font-bold transition-colors hover:text-foreground/85"
        >
          {q}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-300 lp-ease",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h3>
      <div id={id} className="lp-acc" data-open={open ? "" : undefined}>
        <div>
          <p className="lp-acc-in pb-[22px] text-[15px] leading-[1.65] text-muted-foreground">
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Faq() {
  return (
    <Reveal
      id="faq"
      className={cn(
        WRAP,
        "grid scroll-mt-20 items-start gap-10 pt-32 md:pt-36 lg:grid-cols-[4fr_8fr] lg:gap-20",
      )}
    >
      <h2 className={cn(H2, "lp-rv lg:sticky lg:top-28")}>Questions, answered straight.</h2>
      <div className="flex max-w-[720px] flex-col border-t">
        {faq(APP_NAME).map(([q, a], i) => (
          <FaqItem key={q} q={q as string} a={a as string} i={i} />
        ))}
      </div>
    </Reveal>
  );
}

/* ─── Final CTA + footer ─────────────────────────────────────────────── */

export function FinalCta() {
  return (
    <Reveal className={cn(WRAP, "pt-32 md:pt-36")}>
      <div className="lp-rv relative grid items-center gap-12 overflow-hidden rounded-2xl border bg-surface p-8 md:grid-cols-[minmax(0,1fr)_240px] md:gap-16 md:p-16">
        <div aria-hidden className="lp-glow -top-24 -right-24 h-[360px] w-[420px]" />
        <div className="relative flex flex-col gap-[18px]">
          <h2 className="text-[36px] leading-[1.02] font-extrabold tracking-[-0.045em] md:text-[56px]">
            Your thesis deserves a ticker.
          </h2>
          <p className="text-[17px] text-muted-foreground">
            Create an index in minutes. Share it anywhere. Let the program keep it honest.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-7">
            <PrimaryCta />
            <TextLink href="#how">How it works</TextLink>
            <TextLink href={GITHUB_URL}>Read the code</TextLink>
          </div>
        </div>
        {/* The index mark, breathing like a live allocation. */}
        <div
          aria-hidden
          className="lp-eq-x relative hidden size-60 flex-col gap-1.5 rounded-2xl bg-raised p-4 md:flex"
        >
          {[4, 3, 2, 1].map((g, i) => (
            <span
              key={g}
              className={cn("origin-left rounded-[6px]", MARK_BG[i])}
              style={{ flexGrow: g, "--i": i, "--s": [0.82, 0.64, 0.9, 0.55][i] } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </Reveal>
  );
}

export function LandingFooter() {
  return (
    <footer className={cn(WRAP, "mt-24")}>
      <div className="grid gap-10 border-t pt-10 pb-14 text-[13px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-[4fr_2fr_2fr_3fr]">
        <div className="flex flex-col gap-2.5">
          <span className="flex items-center gap-2.5 text-[17px] font-extrabold text-foreground">
            <LogoMark size={24} />
            {APP_NAME}
          </span>
          <span>The index launchpad for tokenized stocks.</span>
          <span className="mt-2.5 leading-[1.6]">
            Runs on Solana devnet. Every asset and price is simulated on-chain; prices follow real
            market data (PreStocks, Jupiter). Not investment advice.
          </span>
          <span className="self-start rounded-[6px] border px-2 py-0.5 text-xs font-semibold">
            {CLUSTER_LABEL}
          </span>
        </div>
        <nav aria-label="Product" className="flex flex-col gap-2.5">
          <span className="font-bold text-foreground">Product</span>
          {[
            ["Launch app", APP_HREF],
            ["Explore", "/explore"],
            ["Leaderboard", "/leaderboard"],
            ["AI agents", "/agents"],
            ["Faucet", "/faucet"],
          ].map(([l, h]) => (
            <Link key={l} href={h as string} className="transition-colors hover:text-foreground">
              {l}
            </Link>
          ))}
        </nav>
        <nav aria-label="Build" className="flex flex-col gap-2.5">
          <span className="font-bold text-foreground">Build</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <Link href="/agents" className="transition-colors hover:text-foreground">
            MCP docs
          </Link>
        </nav>
        <div className="flex flex-col gap-2.5">
          <span className="font-bold text-foreground">Hackathon</span>
          <span className="leading-[1.6]">Built for Stocklana — Solana Foundation, 2026</span>
          <span>PreStocks track</span>
        </div>
      </div>
    </footer>
  );
}
