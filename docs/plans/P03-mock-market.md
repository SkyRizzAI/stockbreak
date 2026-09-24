# P03 — mock_market

## Tujuan
Market simulasi teruji; stack localnet bisa dinyalakan satu perintah; harga bisa diubah deterministik.

## Referensi
PLAN §5.4, §7.9 · A03 · A12.

## Scope
Masuk: test LiteSVM semua instruksi mock_market, `scripts/bootstrap.ts`, `scripts/dev.ts` (validator + deploy + bootstrap; app lain otomatis bila entry ada), `bun run price`. Tidak masuk: worker/web/MCP.

## Desain singkat
- `anchor/crates/test_utils`: helper LiteSVM generik (send, ATA, saldo, waktu).
- `dev.ts`: Postgres → Surfpool `--offline --no-deploy --no-tui` → airdrop admin → `anchor program deploy` (payer & keypair program eksplisit) → reset tabel chain di DB + shock → bootstrap → worker/MCP/web. Output berlabel, health check, shutdown bersih, `--ci`, `--chain-only`, `--cluster devnet`.
- `bun run price`: set_prices on-chain + faktor shock di `deployments/{cluster}.shocks.json` agar feeder mempertahankan perubahan.

## Tugas
- [x] 12 test mock_market (sukses + gagal per error; `SameMint` tertangkap lebih dulu oleh `ConstraintDuplicateMutableAccount` Anchor)
- [x] bootstrap idempoten + `deployments/localnet.json`
- [x] dev.ts
- [x] price.ts

## Gate / kriteria selesai
- [x] `cargo test -p mock_market` hijau · [x] `bun run dev -- --chain-only` menyalakan Surfpool + deploy + bootstrap tanpa error · [x] `bun run price -- --asset AAPLx --pct +20` sukses

## Catatan untuk fase berikutnya
- Surfpool state in-memory: setiap start = chain baru; DB tabel chain di-reset otomatis.
