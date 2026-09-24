# VERSIONS

Dicek 2026-09-24 (macOS 26.4.1 arm64). Sumber detail: `docs/analysis/A01-toolchain.md` dan `docs/analysis/research/R1–R4`.
Aturan: pakai versi stabil; RC/beta tidak dipakai. Perubahan versi dicatat di `DECISIONS.md`.

## Toolchain mesin
| Tool | Versi | Catatan |
|---|---|---|
| Solana CLI (Agave) | 4.2.2 | Channel stable Anza. Script project memprioritaskan `~/.local/share/solana/install/releases/4.2.2/solana-release/bin` (D012) |
| cargo-build-sbf | 4.1.0 (bawaan Agave 4.2.2) | Anchor 1.2 memaksa `--tools-version v1.57 --arch v3` → platform-tools **v1.57** di `~/.cache/solana/v1.57` |
| Anchor CLI / AVM | 1.2.0 | `anchor-lang`/`anchor-spl` 1.2.0 (2.0.0-rc.1 tidak dipakai) |
| Surfpool | 1.6.0 | core solana 4.2.1 |
| Rust (host) | 1.98.1 stable | `anchor/rust-toolchain.toml` → `1.98.1` (1.89 gagal compile LiteSVM 0.16) |
| Bun | 1.4.2 | Package manager tunggal |
| Node | 24.14.1 | Runtime Next.js |
| Docker | OrbStack 29.4 · Compose v5.1.2 | |
| PostgreSQL image | `postgres:18.6-alpine` | host port 5434; volume di `/var/lib/postgresql` |

## Crate Rust
| Crate | Versi | Catatan |
|---|---|---|
| anchor-lang | 1.2.0 | fitur `event-cpi` bila `emit_cpi!` dipakai |
| anchor-spl | 1.2.0 | `default-features = false`, fitur `token, token_2022, token_2022_extensions, associated_token` |
| spl-token-2022-interface | 2.1.0 (re-export `anchor_spl::token_2022::spl_token_2022`) | ScaledUiAmount `initialize`/`update_multiplier`/`ScaledUiAmountConfig`. **Jangan** tambah 3.x |
| solana-instructions-sysvar | 3.x | `load_current_index_checked`, `load_instruction_at_checked` (bukan 4.x/5.x) |
| litesvm | 0.16.0 | + `solana-message 4.2.4`, `solana-transaction 4.1.5`, `solana-signer 3.0.1`, `solana-keypair 3.1.2`; `litesvm-token 0.16.0` opsional |

## Paket npm
| Paket | Versi |
|---|---|
| turbo | 2.11.3 |
| @biomejs/biome | 2.5.14 |
| typescript | 5.9.x (dipin satu versi di root; 7.x tidak dipakai, D016) |
| next / @next/env | 16.3.6 |
| react / react-dom | ≥ 19.2.8 (syarat kit-plugin-wallet) |
| tailwindcss | 4.3.x (dari create-next-app) |
| shadcn (CLI + runtime) | 4.21.0 · style `base-nova` (Base UI), base color neutral |
| recharts | 3.8.0 (dipin shadcn chart) |
| @tanstack/react-query | 5.103.2 |
| zod | 4.6.5 (satu versi di seluruh repo; MCP butuh ^4.2) |
| @solana/kit · @solana/react | 8.3.0 |
| @solana/kit-plugin-wallet | 0.20.0 |
| @solana/kit-plugin-rpc · @solana/kit-plugin-signer | 0.19.0 |
| @solana-program/system | 0.15.0 |
| @solana-program/token | 0.17.0 |
| @solana-program/token-2022 | 0.19.0 (ScaledUiAmount didukung) |
| @solana-program/compute-budget | 0.19.0 |
| @solana-program/address-lookup-table | 0.15.0 |
| codama · @codama/nodes-from-anchor · @codama/renderers-js | 1.11.0 · 1.5.6 · 2.5.0 |
| @wallet-standard/wallet · @solana/wallet-standard-features | 1.1.1 · 1.5.0 |
| @solana/actions-spec | 2.4.2 (tipe saja; `@solana/actions` dilarang karena web3.js v1) |
| drizzle-orm · drizzle-kit | 0.45.3 · 0.31.11 (stabil; 1.0-rc tidak dipakai) |
| postgres (postgres.js) | 3.4.9 |
| @modelcontextprotocol/server · @modelcontextprotocol/client | 2.1.0 |
| @modelcontextprotocol/inspector | 2.7.0 |
| @playwright/test | 1.63.0 (Chromium) |
| geist | via `next/font` bawaan create-next-app |

## Layanan eksternal (read-only, gratis)
| Layanan | Endpoint | Catatan |
|---|---|---|
| Jupiter Price v3 | `https://api.jup.ag/price/v3?ids=` | key opsional (`x-api-key`), 60 rpm dengan key |
| Finnhub | `https://finnhub.io/api/v1/quote` | fallback saham US |
| Helius RPC | mainnet (baca harga) & devnet (deploy + dev:devnet) | key dari `.env.test` |
| Pyth Hermes | `https://hermes.pyth.network` | wajib key sejak 2026-08-26; hanya bila `PYTH_API_KEY` diisi |
