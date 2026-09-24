# P06 — SDK

## Tujuan
Satu SDK untuk web, worker, MCP, dan script: akses chain, math identik program, flow multi-tx.

## Referensi
PLAN §6.6, §7.2 · A05 · A06 · A07.

## Modul (`packages/sdk/src`)
`generated/` (Codama) · `pda` · `rpc` · `tx` (v0 + ALT + CU estimate; signer apa pun) · `pack` (ukuran tx lokal & packing) · `accounts` (decode + valuasi NAV/bobot/drift, multiplier Token-2022) · `math` (port `index_math`) · `instructions` (builder + layout A05) · `zap` (in/out) · `rebalance` (planner + sandwich) · `alt` · `flows` (create index + ALT otomatis bila perlu) · `ipo` · `bootstrap` · `events` · `errors` · `node` (keypair file).

## Gate
- [x] `bun test` di sdk hijau terhadap Surfpool yang dinyalakan sendiri (port 18899): math paritas 45 vektor, errors 2, flows 9 (create+zap $100k, zap B, keeper rebalance, follow sync, IPO semua pemegang, claim fee, index 6 aset dengan ALT, zap out, map error).

## Catatan untuk fase berikutnya
- Web memakai `zapIn/zapOut/createIndexFlow` dengan signer wallet (satu popup per tx).
- Keeper membuat ALT sendiri untuk index ≥ 5 aset bila belum ada (simpan di `indexes.lookup_table`).
- Skenario harga DoD memakai +30% (D026).
