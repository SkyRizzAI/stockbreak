# Stockbreak — the index launchpad for tokenized stocks

**Anyone can turn a stock thesis into an index token on Solana.** Others join with one click (or one Blink), clone it, or follow it. A vault program enforces the rebalance rules, a pre-IPO sleeve (PreStocks) migrates by itself when the company lists, creators earn fees and clone royalties, and AI agents manage indexes over MCP without ever being able to take the money.

> Devnet / localnet. Every asset is **simulated** on-chain; prices follow real market data, read-only (Jupiter, PreStocks). Not investment advice. Why not mainnet yet: [see below](#why-not-mainnet-yet).

| | |
|---|---|
| Live demo (devnet) | _add the public URL here_ (see [docs/DEPLOY.md](docs/DEPLOY.md)) |
| Pitch video (≤3 min) | _add link_ |
| Technical walkthrough (≤5 min) | _add link_ |
| Programs (devnet) | `index_vault` [`4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me`](https://explorer.solana.com/address/4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me?cluster=devnet) · `mock_market` [`9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8`](https://explorer.solana.com/address/9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8?cluster=devnet) |

| Markets | Index page (PreStocks panel, mandate, discussion) | Feed with shareable index cards |
|---|---|---|
| ![Markets](docs/media/dark-1280-home.png) | ![Index](docs/media/dark-1280-index.png) | ![Feed](docs/media/dark-1280-feed.png) |

## The problem

- Tokenized stocks on Solana passed **850,000 holders** and **$3.3B of volume in 30 days**, and most of that activity happens outside US market hours ([Solana Compass, Sep 2026](https://solanacompass.com/news/solana-tokenized-equity-holders-hit-850000-ath-as-33b-flows-in-30-days)). But every token is a single ticker. There is no way to hold "AI infrastructure + Anthropic + SpaceX" as **one self-custodied token** that stays balanced.
- The people who shape retail portfolios cannot package their thesis into an investable product without starting a fund. 61% of investors aged 18–34 act on finfluencer recommendations ([FINRA Foundation, 2026](https://finrafoundation.org/sites/finrafoundation/files/2026-03/FINRA_Foundation_Research_Brief_Social_Media_Finfluencers.pdf)). Copy apps such as Autopilot ($1.3B AUM) and Dub prove the demand, but they are off-chain, US-only and subscription-based.
- Pre-IPO tokens come with deadlines. After the SpaceX IPO, SpaceX PreStocks had to be swapped into SPCXx before **12 Mar 2027** or they expire ([PreStocks](https://x.com/PreStocks/status/2063623768535363940)). Holders who forget lose everything.

## Who it is for

- **Global retail investor** (outside the US, 22–35, already holds USDC in Phantom): wants a theme, not ten tickers, and wants it rebalanced without babysitting.
- **Creator / finfluencer**: publishes an index, shares it as a card or Blink, earns management/entry/exit fees plus a royalty every time someone clones it.
- **AI agent operator**: plugs an agent into Stockbreak over MCP and competes in the **Human vs AI** league with rules the program enforces.

## What makes it different

| | Stockbreak | Copy-portfolio apps (e.g. Glider) | Hackathon basket apps |
|---|---|---|---|
| Index is a real token (in-kind mint/redeem, USDC zap) | ✅ | ❌ copied into each wallet | some |
| Rebalance rules enforced on-chain (drift/periodic, slippage, cooldown, timelock, keeper) | ✅ | off-chain | ❌ |
| Creator fees **+ clone royalties** | ✅ | ❌ | fees only, if any |
| Pre-IPO sleeve that migrates automatically at IPO (PreStocks) | ✅ | ❌ | ❌ |
| AI managers over MCP that cannot withdraw funds | ✅ | ❌ | ❌ |
| Social loop: feed, shareable index cards, Blinks, Human vs AI leaderboard | ✅ | partial | partial |

## How it works

```mermaid
flowchart LR
  U[Browser + Phantom / dev wallet] --> W[apps/web · Next.js]
  X[X / Discord Blink] --> W
  A[Claude, Cursor, any MCP agent] --> M[apps/mcp]
  W --> S[packages/sdk · @solana/kit + Codama]
  M --> S
  K[apps/worker · prices, indexer, keeper, follow] --> S
  S --> IV[index_vault program]
  S --> MM[mock_market program · oracle, swaps, IPO]
  W & M & K --> DB[(Postgres: cache, history, social)]
```

- **Index = vault PDA + share mint.** Join deposits every asset in the vault's ratio and mints shares; redeem burns shares for the underlying. After the first deposit no oracle is needed, so this is hard to manipulate. The web zaps USDC in and out for you.
- **Flash rebalance in one atomic transaction:** `begin_rebalance` lends the overweight asset → swap → return proceeds → `end_rebalance` checks slippage against the oracle **and** that every weight moved closer to target. If not, everything reverts. While a rebalance ticket is open, every other index instruction is refused.
- **Mandate.** Strategy (hold / drift threshold / periodic), max slippage, cooldown, keeper on/off and a timelock on weight and fee changes (holders can see and exit before a change lands). Redeem can never be blocked by the creator: fees are booked as owed shares and claimed separately.
- **Clone & Follow.** A clone is a new index with a `parent`; the parent creator earns a royalty share of its fees. A follower index syncs its targets to the parent automatically.
- **Pre-IPO → IPO migration.** When a listing happens, `migrate_ipo_asset` converts the pre-IPO token held by the vault into the listed stock token via the market program, keeping the weight. This is what PreStocks holders must do by hand before a deadline, done for every holder of the index at once.
- **AI agents (MCP, 18 tools).** Human-in-the-loop: the agent prepares a request and the user signs it at `/sign` (resumable, and signatures are verified on-chain). Agent wallet: the agent is a *manager* that can rebalance or propose changes within the mandate, but it cannot withdraw anything.

### Why Solana

- Fees of about $0.001 per transaction make a 10-asset mint, redeem or rebalance practical. Atomic multi-instruction transactions make the flash-rebalance sandwich and USDC zaps all-or-nothing.
- Solana has the widest set of tokenized-stock issuers (xStocks, Ondo, Backpack) and the **only** pre-IPO issuers (PreStocks), with Jupiter, Raydium and Kamino as the liquidity and collateral layer.
- Token-2022 (Scaled UI Amount, transfer fees) handles corporate actions. Blinks turn every index into a one-click join from X, and Phantom already speaks Wallet Standard.

## PreStocks integration

The pre-IPO sleeve uses **PreStocks** assets only (SpaceX, OpenAI, Anthropic, Anduril). Their real mainnet mints are read-only price sources: PreStocks' public API gives the mark price and implied valuation, with Jupiter as the fallback. On devnet the tokens are mirrored by the mock market. The IPO event (`bun run ipo -- --asset SPACEX-pre`) reproduces the real SpaceX flow: the pre-IPO token becomes SPCXx inside every index that holds it, so no holder misses the conversion deadline.

## Quality

- **Programs:** 38 LiteSVM tests (a success test and a failure test for each error). Checked `u128` math, rounding in favour of the vault, and `transfer_checked` with the right token program. Every CPI program and every `remaining_accounts` entry is validated, and balances are tracked internally rather than read from ATAs.
- **SDK:** 59 tests, including parity between the SDK math and the program math. MCP: 10 tests. Worker: 7, DB client: 5, config: 3.
- **End to end:** 93 Playwright tests, including the complete user story and 19 "what can go wrong" scenarios (keeper mandates, IPO value continuity, phasing an asset out to 0%):
  - an interrupted agent `/sign` flow that resumes without swapping twice;
  - a first deposit that is too small;
  - forged intent status;
  - tampered Blink state;
  - feed pagination.

  See [docs/analysis/A16-qa-scenarios.md](docs/analysis/A16-qa-scenarios.md).
- `bun run verify` runs lint, typecheck, program tests, TS tests, build and e2e on a fresh chain. `bun run verify:devnet` checks the devnet deployment.

## Why not mainnet yet

- Buying real xStocks or PreStocks requires jurisdiction checks (issuers serve non-US users only) and real liquidity routing.
- For the hackathon we kept every transaction on devnet/localnet with a mock market that mirrors the real token mechanics.
- Going live means:
  - replacing the asset list in `packages/config` with real mints;
  - routing swaps through Jupiter/Raydium instead of `mock_market`;
  - handling PreStocks' 1% Token-2022 transfer fee in the zap.

## Try it

**Devnet with Phantom:** Phantom → Settings → Developer Settings → Testnet Mode → Solana Devnet. Open the live demo, connect, and grab SOL and simulated USDC at `/faucet`. Or use the built-in dev wallet, with no install needed.

**Localnet** (full control: move prices, time travel, trigger an IPO):

```bash
git clone <repo-url> stocklana && cd stocklana
bun install
bun run setup        # checks toolchain, creates .keys/ and .env, Postgres + migrations, Playwright
bun run dev          # Surfpool + programs + bootstrap + worker + MCP + web
bun run seed         # second terminal: demo wallets, 7 indexes, 30 days of history, posts
```

Open http://localhost:3000 → **Connect → Dev wallet**. Suggested tour:
1. Explore and open MAG4.
2. Join $100.
3. Create an index, then share it to the feed as a card.
4. `bun run price -- --asset NVDAx --pct +30` and watch the keeper rebalance.
5. `bun run ipo -- --asset SPACEX-pre`.
6. `bun run warp -- --days 30` and check fees and the leaderboard.

The full guide, including connecting Claude as an agent, is in [docs/DEMO.md](docs/DEMO.md).

### Prerequisites

| Tool | Version |
|---|---|
| [Bun](https://bun.sh) | ≥ 1.4 |
| Rust ([rustup](https://rustup.rs)) | pinned in `anchor/rust-toolchain.toml` |
| Solana CLI (Agave) | 4.2.x |
| [Anchor](https://www.anchor-lang.com/docs/installation) (AVM) | 1.2.x |
| [Surfpool](https://docs.surfpool.run) | ≥ 1.6 |
| Docker (Desktop or OrbStack) | Compose v2+ |

`bun run setup` checks all of these and prints install hints.

### Commands

| Goal | Command |
|---|---|
| Run everything (localnet) | `bun run dev` |
| Run against devnet | `bun run dev:devnet` |
| Demo data | `bun run seed` |
| Move a price | `bun run price -- --asset NVDAx --pct +30` |
| Time travel (localnet) | `bun run warp -- --days 30` |
| IPO event | `bun run ipo -- --asset SPACEX-pre` |
| Full verification | `bun run verify` |
| Devnet readiness | `bun run verify:devnet` |
| Deploy programs to devnet | `bun run deploy:devnet` |

Ports: web 3000, MCP 3333 (`/mcp`), RPC 8899/8900, Postgres 5434.

## Repository layout

```
anchor/          index_vault (product) and mock_market (simulated oracle, swaps, faucet, IPO)
apps/web         Next.js app, API routes, Blinks, OG images
apps/worker      price feeder, indexer, snapshots, keeper, fees, follow sync, gamification
apps/mcp         MCP server (stdio + Streamable HTTP) for AI agents
packages/sdk     @solana/kit client (Codama-generated + flows); math identical to the program
packages/db      Drizzle schema, migrations, queries
packages/config  env schemas, asset registry, deployments
scripts/         setup, dev, seed, price, warp, ipo, verify, e2e, deploy
e2e/             Playwright suites
docs/            plan, architecture, demo, deploy, decisions, status (Indonesian)
```

## Built with

Anchor 1.2 · LiteSVM · Surfpool · `@solana/kit` + Codama · `@solana/react` + Wallet Standard · Next.js 16 · Tailwind + shadcn/ui · TanStack Query · PostgreSQL + Drizzle · MCP TypeScript SDK · Solana Actions/Blinks · Playwright · Bun + Turborepo + Biome.

Open-source components are used as dependencies under their licenses. All application code in this repository was written for the hackathon.
