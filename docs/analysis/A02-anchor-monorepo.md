# A02 — Anchor di monorepo

## Pertanyaan
Cara menaruh workspace Anchor di `anchor/` via command resmi, keypair program stabil, integrasi turbo (build → codegen → sdk), dan deploy localnet/devnet.

## Sumber yang dibaca
`anchor init/new/keys/program --help` (1.2.0), https://www.anchor-lang.com/docs/references/anchor-toml, `research/R1-program.md` §1.

## Temuan
- `anchor init` menolak berjalan di dalam Cargo workspace → dijalankan di tmp (`anchor init index_vault --package-manager bun --no-git --no-install --test-template litesvm`), dipindah ke `anchor/`, lalu `anchor new mock_market` di dalam tmp sebelum dipindah.
- Keypair program disalin ke `anchor/keys/{index_vault,mock_market}-keypair.json` (di-commit oleh user; satu-satunya keypair yang boleh di-commit). Hook `[hooks] pre-build` menyalinnya ke `target/deploy/` sebelum setiap build → `declare_id!` stabil walau `cargo clean`.
- Program ID: `index_vault` = `4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me`, `mock_market` = `9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8` (sama untuk localnet & devnet).
- `[provider] wallet = "../.keys/admin.json"` (relatif ke Anchor.toml) — tidak pernah memakai `~/.config/solana/id.json`.
- Build pertama `anchor build` hijau (SBPFv3, platform-tools v1.57); `.so` kosong ±125 KB; test LiteSVM 0.16 hijau.
- Turbo tidak menjalankan `anchor build` (Rust di luar graf JS). Pipeline kontrak: `bun run codegen` = `anchor build` → Codama → `packages/sdk/src/generated` (P2). `bun run test:program` = `anchor build` + `cargo test`.

## Keputusan
- Deploy: `anchor program deploy -p <prog> --provider.cluster <url> --provider.wallet ../.keys/admin.json --program-keypair keys/<prog>-keypair.json` (D013). Script memakai PATH Solana 4.2.2 (D012).
- `rust-toolchain.toml` = 1.98.1; dev-deps LiteSVM 0.16 (D014).

## Dampak ke implementasi
- `scripts/dev.ts` (P3) menjalankan Surfpool offline + deploy dengan perintah di atas.
- `scripts/deploy-devnet.ts` (P11) sama, dengan `--provider.cluster $DEVNET_RPC_URL`.
