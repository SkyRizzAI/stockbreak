# A09 — Blinks & OG

## Pertanyaan
Spesifikasi Solana Actions terbaru, membangun tx dengan Kit, `next/og` untuk kartu index.

## Sumber yang dibaca
`research/R2-client.md` §7 (GET/POST, `actions.json`, header CORS `Access-Control-Allow-*`, `X-Action-Version`, `X-Blockchain-Ids`, chaining `links.next`), `@solana/actions-spec` 2.4.2 (tipe), https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image.

## Keputusan
- `GET /api/actions/join/[pubkey]` → ActionGetResponse (icon = OG image, label, links: $100/$500/$1,000 + input custom `amount`).
- `POST /api/actions/join/[pubkey]?amount=` `{account}` → tx 1 = ATA + swap USDC→aset (dipaket), `links.next` = `post` ke `/api/actions/join/[pubkey]/next?amount=&baseline=<b64>`; tx 2 = join dengan delta saldo terhadap baseline. Bila semua muat dalam satu tx (jarang), langsung satu tx.
- `OPTIONS` + header CORS pada semua route actions; `/actions.json` memetakan `/i/*` → `/api/actions/join/*`. `X-Blockchain-Ids` = CAIP-2 cluster (devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).
- Tx dibangun server (fee payer = account, v0, CU limit tetap) via `buildUnsignedTxBase64` (SDK).
- OG: `app/i/[pubkey]/opengraph-image.tsx` (ImageResponse 1200×630): nama, simbol, share price, return 30 hari, bar komposisi — monokrom, label "Simulated".
- Uji: e2e memanggil endpoint, men-decode tx, menandatangani dengan keypair dev, mengirim → sukses (§11.1 #12). dial.to butuh URL publik (dicatat di DEMO).
