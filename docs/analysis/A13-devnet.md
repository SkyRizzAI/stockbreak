# A13 — Devnet

Sumber: `solana program deploy --help` (Agave 4.2.2 terpasang), RPC devnet (`getMinimumBalanceForRentExemption`, genesis hash), docs Phantom Developer Settings (Testnet Mode), riset `research/R2-client.md`.

## Biaya deploy
| Program | Ukuran `.so` | Rent ProgramData (≈) | Buffer sementara (≈, dikembalikan) |
|---|---|---|---|
| `index_vault` | 500.872 B | 3,49 SOL | 3,49 SOL |
| `mock_market` | 316.720 B | 2,21 SOL | 2,21 SOL |

- Agave 4.2: `--max-len` default = panjang program saat deploy (bukan 2×), dan upgrade melakukan auto-extend → biaya permanen ≈ 5,7 SOL, puncak ≈ 7 SOL saat buffer `index_vault` ada. Saldo admin 15 SOL (didanai user) cukup (D030).
- `cpi_probe` hanya untuk test, tidak di-deploy.
- Biaya berjalan: price feeder mengirim `set_prices` tiap `PRICE_INTERVAL` (disarankan 60 dtk di devnet) ≈ 0,01 SOL/hari; keeper/fees/follow hanya saat perlu. Faucet SOL web mentransfer 0,2 SOL/permintaan dari admin, batas harian 5 SOL.

## Cara deploy (`bun run deploy:devnet`)
1. Guard: RPC harus devnet (cek genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`), URL mainnet ditolak; API key di URL disamarkan di log.
2. Program yang byte on-chain-nya sama dengan build lokal dilewati (idempoten); sisanya deploy/upgrade via `solana program deploy --program-id anchor/keys/<p>-keypair.json --config .keys/solana-cli.yml --keypair .keys/admin.json --use-rpc --with-compute-unit-price 10000`.
3. Cek saldo sebelum deploy; bila kurang → keluar kode 2 dengan pesan `BLOCKED(eksternal)`.
4. `bootstrap --cluster devnet` (market, 13 mint, feed, config, timelock 120 dtk) → `packages/config/deployments/devnet.json`.
5. Keeper & agent didanai 0,5 SOL dari admin (airdrop devnet tidak dipakai: rate-limited).
6. Seed ringan: MAG4, MEGA, ATLS (setoran diskalakan 5%) di DB `app_devnet`.

## Keterbatasan devnet
- `warp` (time travel) hanya Surfpool → akrual fee di devnet tumbuh sesuai waktu nyata (kecil).
- Blink di X/dial.to butuh URL publik (web berjalan di localhost); endpoint Actions tetap bisa diuji lewat `/api/actions/join/<index>`.
- Phantom tidak mendukung localnet; uji Phantom di devnet (Settings → Developer Settings → Testnet Mode → Solana Devnet).
- RPC publik devnet rate-limited → dipakai Helius (`DEVNET_RPC_URL`, key dari `.env.test`).
