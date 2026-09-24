# A08 — Wallet & dev wallet

## Pertanyaan
Setup `@solana/react` + `@solana/kit-plugin-wallet` di Next.js App Router (SSR-safe); Phantom/Solflare/Backpack; dev wallet Wallet Standard; signMessage untuk auth.

## Sumber yang dibaca
`research/R2-client.md` §3–§4, README `@solana/kit-plugin-wallet` 0.20, snippet teruji `research/snippets/{providers,wallet-button,dev-wallet}`.

## Temuan
- Plugin aman dibuat di scope modul file `'use client'` (inert di server). Hooks: `useWallets`, `useConnectedWallet`, `useConnect`, `useDisconnect`, `useSignMessage`, `WalletReadyGate`.
- Plugin memfilter wallet berdasarkan `chain`. Phantom resmi: Devnet/Testnet → di localnet Phantom kemungkinan tidak tampil (D005).
- `connected.signer` adalah `TransactionSigner` (modifying) → langsung dipakai SDK (`sendTx`, `zapIn`, `createIndexFlow`): wallet hanya menandatangani, app mengirim lewat RPC sendiri (benar untuk localnet & devnet).
- Dev wallet: kelas Wallet Standard (seed di localStorage, chain `solana:localnet` & `solana:devnet`) didaftarkan via `registerWallet` hanya bila cluster localnet/devnet.

## Keputusan
- `NEXT_PUBLIC_WALLET_CHAIN` = `solana:${cluster}` (override opsional). Localnet: Dev Wallet (utama) + wallet lain yang mengiklankan localnet. Devnet: Phantom (utama uji manual) + Dev Wallet.
- Auth profil/metadata: `GET /api/auth/nonce?wallet&purpose` → pesan `Stocklana\nAction: <purpose>\nWallet: <wallet>\nNonce: <nonce>` → `signMessage` → server memverifikasi ed25519 (`verifySignature` Kit) + `consumeNonce` (sekali pakai, TTL 5 menit).
- Semua tx v0; aksi in-app dieksekusi di client lewat SDK dengan signer wallet (progress per tx).
