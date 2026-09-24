# Stocklana

Create, share and join **tokenized stock indexes** on Solana. Creators earn fees, others Join, Clone or Follow, a vault program rebalances automatically, and AI agents plug in over MCP.

> Localnet/devnet only. Every asset and price is **simulated** (prices follow real market data where available). Not investment advice.

## Prerequisites

| Tool | Version |
|---|---|
| [Bun](https://bun.sh) | ≥ 1.4 |
| Rust ([rustup](https://rustup.rs)) | toolchain pinned in `anchor/rust-toolchain.toml` |
| Solana CLI (Agave) | 4.2.x |
| [Anchor](https://www.anchor-lang.com/docs/installation) (via AVM) | 1.2.x |
| [Surfpool](https://docs.surfpool.run) | ≥ 1.6 |
| Docker (Desktop or OrbStack) | Compose v2+ |

`bun run setup` checks all of these and prints install hints for anything missing.

## Run it (localnet)

```bash
git clone <repo-url> stocklana && cd stocklana
bun install
bun run setup        # keys in .keys/, .env, Postgres databases + migrations, Playwright
bun run dev          # Surfpool + programs + bootstrap + worker + MCP + web
bun run seed         # (second terminal) demo wallets, 7 indexes, 30 days of history
```

Open http://localhost:3000, click **Connect → Create dev wallet** (auto-funded with SOL and 10,000 simulated USDC). Browser wallets such as Phantom do not support localnet; use devnet for Phantom (see [docs/DEMO.md](docs/DEMO.md)).

## Commands

| Goal | Command |
|---|---|
| First-time setup | `bun run setup` |
| Run everything (localnet) | `bun run dev` |
| Run against devnet | `bun run dev:devnet` |
| Demo data | `bun run seed` |
| Move a price | `bun run price -- --asset NVDAx --pct +30` |
| Time travel (localnet) | `bun run warp -- --days 30` |
| IPO event | `bun run ipo -- --asset OPENAI-pre` |
| Platform fee claim | `bun run claim:platform` |
| Full verification | `bun run verify` |
| Program tests (LiteSVM) | `bun run test:program` |
| TypeScript tests | `bun run test:ts` |
| E2E (Playwright + MCP) | `bun run e2e` |
| Visual review captures | `bun run e2e:visual` |
| Deploy to devnet | `bun run deploy:devnet` |

Admin scripts accept `--cluster devnet`.

## Ports

| Service | Port |
|---|---|
| Web (Next.js) | 3000 |
| Solana RPC / WS (Surfpool) | 8899 / 8900 |
| MCP (Streamable HTTP `/mcp`, `/health`) | 3333 |
| Postgres | 5434 |
| Test validator (SDK tests) | 18899 / 18900 |

## Layout

```
anchor/            programs: index_vault (product), mock_market (simulated oracle, swap, faucet, IPO)
apps/web           Next.js app, API routes, Blinks, OG images
apps/worker        price feeder, indexer, snapshots, keeper, fees, follow sync, gamification
apps/mcp           MCP server (stdio + HTTP) for AI agents
packages/sdk       @solana/kit client (Codama-generated + flows), math identical to the program
packages/db        Drizzle schema, migrations, queries
packages/config    env schemas, asset registry, deployments
scripts/           setup, dev, seed, price, warp, ipo, verify, e2e, deploy
e2e/               Playwright suites
docs/              plan, architecture, demo guide, decisions, status (Indonesian)
```

## Docs

- [docs/DEMO.md](docs/DEMO.md): step-by-step demo (localnet dev wallet, devnet Phantom) and connecting an AI agent
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit
- [docs/PLAN.md](docs/PLAN.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/STATUS.md](docs/STATUS.md)

Keys and `.env` are gitignored and never leave your machine. The project never uses your global Solana CLI config.
