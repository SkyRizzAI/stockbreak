# R4 — Sumber harga real (read-only, gratis) untuk price feeder

Diverifikasi 2026-09-23 18:26 UTC (Rabu, 14:26 ET, pasar AS buka) dengan curl tanpa API key.

## TL;DR
- **Pyth Hermes TIDAK lagi bisa dipakai tanpa key.** Sejak Pyth Core upgrade **26 Agustus 2026**, semua endpoint harga Hermes
  (`/v2/updates/price/latest`, `/api/latest_price_feeds`, juga `hermes-beta` dan `benchmarks.pyth.network/v1/updates/...`) → `HTTP 401 unauthorized`.
  Hanya endpoint metadata `/v2/price_feeds` yang masih tanpa key. Key didapat dari Pyth Terminal (free *trial*, lalu berbayar) → tidak memenuhi syarat "zero cost" untuk jangka panjang.
- **Jupiter Price API v3 berfungsi tanpa key** (keyless tier: 0.5 req/s = 30 req/menit) dan memberi harga semua 8 xStocks
  **plus** PreStocks untuk OpenAI, Anthropic, Anduril, SpaceX — sekaligus dalam 1 request (≤50 ids).
- Rekomendasi: Jupiter v3 (primer) → cache terakhir + random walk → fixture statis. Pyth hanya opsional bila user punya key.

## 1. Pyth Hermes

| Hal | Status |
|---|---|
| `GET https://hermes.pyth.network/v2/price_feeds?query=AAPL&asset_type=equity` | 200, tanpa key (metadata saja) |
| `GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=<id>&parsed=true` | **401 `unauthorized`** |
| Base URL baru | `https://pyth.dourolabs.app/hermes` (drop-in), header `Authorization: Bearer $PYTH_API_KEY` — tanpa key juga 401 |
| Key | Daftar di Pyth Terminal (`https://pythdata.app/signup`): "a free trial is included, paid plans cover ongoing use" |
| Rate limit | Tidak didokumentasikan di halaman upgrade |
| On-chain push feeds | Tidak butuh key (FAQ: "The API key is only required for Hermes (REST/SSE) requests"), tapi daftar sponsored push feed Solana (~61 feed) yang terlihat hanya memuat sedikit equity (GLXY, MSTU, TEMT, HDFC, RELIANCE); AAPL dkk. **tidak terkonfirmasi** ada di sana. |

Sumber: https://docs.pyth.network/price-feeds/core/upgrade/preparing ,
https://docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes ,
https://docs.pyth.network/price-feeds/core/push-feeds/solana ,
https://docs.pyth.network/price-feeds/pro/pyth-terminal ,
PR DefiLlama "Pyth Hermes now requires an API key": https://github.com/DefiLlama/dimension-adapters/pull/9218

### Feed ID (diverifikasi via `/v2/price_feeds?query=<T>&asset_type=equity`)

| Ticker | `Equity.US.<T>/USD` (jam pasar reguler) | `Equity.Index.<T>/USD` ("PYTH PRICE IN USD FOR <T> 24/7") |
|---|---|---|
| AAPL | `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` | `aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36` |
| NVDA | `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` | `a470c4ac46f44b547b2cba52338f311fb642b79375ce5f0cfd5cb5b99227b852` |
| TSLA | `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` | `e6da44bff5b8b06897a3739dd331b440d6662595bb862e37046892c568ae3fc0` |
| MSFT | `d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1` | `d9144b30a3a162a2748d384dc53387571f3ec77b9edfe31739349396ed67a63a` |
| GOOGL | `5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6` | `ad519718d387de4f0d7d29ea16a3730ce42e49c59fef6fba6fc9bac477645f6f` |
| AMZN | `b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a` | `329635cf9e705e01ed2d842fafbb6c426d7e5630e75847740d89957222fd68b8` |
| META | `78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe` | `2cc0c022f7f37920485a5947f3cea8633783b6cb7fff6d94ee52f48687b7783d` |
| SPY | `19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5` | (tidak ada) |

Feed lain yang relevan (tanpa bisa diambil harganya tanpa key):
- SpaceX sudah listing sebagai **SPCX**: `Equity.US.SPCX/USD` `8a593d6edde7a3095213c88116d8840d01e93c2ddeb800bc891772eb8b93bb94`, `Equity.Index.SPCX/USD` `2dbfb1791e75725227a90dbd23c6bdd83b80cc9d13011973c948b6aeacdf17b9`.
- `Equity.Index.OPENAI/USD` `96d4bb23a3db78fdb72b3a03ce80ead686096f324319166534d9a27c0519c483`, `Equity.Index.ANTHROPIC/USD` `5da511a7c68b17a3bc94380cab4756bc83ab87f86307af10ea58467a64b6689d`. Anduril: tidak ada.
- xStock feeds 24/7: mis. `Crypto.AAPLX/USD` `978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675`, dan redemption rate `Crypto.AAPLX/AAPL.RR`.

### Perilaku di luar jam pasar
Metadata `schedule` untuk `Equity.US.*`: `America/New_York;0930-1600 (Sen–Jum),C,C;<libur>` → di luar 09:30–16:00 ET, akhir pekan dan
libur, feed tidak diperbarui sehingga `publish_time` jadi basi (stale). **Tidak ada** feed pre/post-market terpisah di hasil query
(hanya varian `Equity.US` dan `Equity.Index` "24/7"). Kalau butuh harga 24/7: `Equity.Index.*` atau `Crypto.<T>X/USD` (schedule `O` setiap hari).

## 2. Jupiter Price API v3

| Hal | Detail |
|---|---|
| Endpoint | `GET https://api.jup.ag/price/v3?ids=<mint1>,<mint2>,...` (maks **50 ids**). `https://lite-api.jup.ag/price/v3` juga masih 200 (lite-api sudah diumumkan deprecated; tenggat ditunda, jangan diandalkan) |
| Auth | Header `x-api-key` (key gratis dari portal developers.jup.ag). **Keyless tetap berjalan**: tier "Keyless" = 0.5 req/s (30 req/menit); Free (dengan key) = 60 req/menit. Limit berlaku per organisasi. |
| Header rate limit terlihat | `x-ratelimit-remaining: 4`, `x-ratelimit-current: 1`, `x-ratelimit-reset: <unix>` (api.jup.ag keyless) |
| Field | `usdPrice`, `liquidity`, `blockId`, `decimals`, `priceChange24h`, `createdAt`; untuk token saham juga `stockData {id:"xstocks"|"prestocks", price, mcap, updatedAt}` dan untuk mint Token-2022 Scaled UI `scaledUiConfig {multiplier, newMultiplier, newMultiplierEffectiveAt, usdPricePrescaled, ...}` |
| Token tanpa harga reliabel | Dihilangkan dari respons (bukan null) |

Catatan harga: `usdPrice` = harga per unit UI (sudah dikali multiplier). `stockData.price` = harga referensi saham dasar (paling cocok untuk "harga saham"). `usdPricePrescaled` = harga per unit raw sebelum multiplier. Untuk simulasi, pakai `stockData.price` bila ada, fallback `usdPrice`.

Sumber: https://developers.jup.ag/docs/price/v3 , https://developers.jup.ag/docs/portal/rate-limit ,
https://developers.jup.ag/portal/migrate-from-lite-api , https://x.com/JupDevRel/status/1995521411767791886

### Mint xStocks (Solana mainnet, Token-2022)
Diverifikasi di halaman resmi https://xstocks.fi/us/products (alamat muncul bersama simbol/nama) **dan** di Jupiter token search (`isVerified: true`, dev `S7vYFFWH6B…` sama untuk semua).

| Ticker | Mint | usdPrice | stockData.price |
|---|---|---|---|
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 336.76 | 337.375 |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 225.39 | 225.24 |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | 379.57 | 379.975 |
| MSFTx | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` | 499.13 | 499.045 |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | 338.63 | 339.115 |
| AMZNx | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` | 248.64 | 249.415 |
| METAx | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | 747.62 | 748.90 |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | 768.39 | 768.31 |
| SPCXx (SpaceX, sudah IPO) | `Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8` | 148.99 | 149.73 |

Hati-hati: pencarian simbol menghasilkan banyak token palsu (pump.fun, `...pump`, harga ~1e-6). Selalu pin mint di config, jangan cari berdasarkan simbol.

### Pre-IPO (PreStocks, Token-2022, `isVerified: true`, tag `prestocks`)
Mint diverifikasi via Jupiter token API v2 (`/tokens/v2/search`). Halaman resmi PreStocks tidak dicek.

| Nama | Mint | usdPrice | stockData.price | Likuiditas |
|---|---|---|---|---|
| OpenAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | 1320.98 | 1023.97 | ~$0.9M |
| Anthropic | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | 1031.59 | 1043.44 | ~$0.71M |
| Anduril | `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB` | 149.46 | 151.67 | ~$0.38M |
| SpaceX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | 110.74 | 149.26 | ~$0.11M |

Alternatif SpaceX yang lebih likuid: SPCXx (xStock di atas, ~$1.68M), Backpack `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb`.
Catatan: harga PreStocks bisa jauh dari `stockData.price` (OpenAI +29%) dan config scaled-UI SpaceX PreStocks tidak biasa (multiplier 1 → newMultiplier 5). Likuiditas tipis, jadi harganya berisik. Untuk demo cukup, tetap diberi label "Simulated".

## 3. Rekomendasi prioritas & fallback (gratis)

1. **Jupiter Price v3** `https://api.jup.ag/price/v3?ids=<13 mint>`: 1 request per siklus untuk semua aset. Keyless; kalau
   `JUPITER_API_KEY` ada di env, kirim `x-api-key`. Polling ≥ 5 detik (12 req/menit < 30). Pakai `stockData.price ?? usdPrice`.
   Base URL bisa dikonfigurasi (lite-api sebagai cadangan selama masih ada).
2. **Last-known-good cache + random walk** (per aset, mis. GBM σ kecil, dengan jangkar ke harga real terakhir) ketika Jupiter
   error/429/timeout atau aset hilang dari respons. Backoff eksponensial pada 429 (hormati `x-ratelimit-reset`).
3. **Fixture statis** (harga seed di repo, mis. tabel di atas) saat offline/CI → lalu random walk. Harus deterministik dengan seed untuk test.
4. **Opsional** Pyth Hermes (`https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=...&parsed=true`, `Authorization: Bearer`)
   hanya bila `PYTH_API_KEY` diset. Jangan jadikan default karena butuh key/berbayar. Feed ID sudah ada di atas.
- Di luar jam pasar: harga xStocks/PreStocks di Jupiter tetap bergerak 24/7 (DEX), `stockData.updatedAt` menunjukkan kesegaran; feeder
  sebaiknya mencatat `source` + `updatedAt` dan menandai stale bila > N menit.
- Semua hanya READ mainnet; tidak ada transaksi. Harga dipakai untuk menggerakkan mock_market di localnet/devnet.

## Sampel request yang berhasil

```
$ curl -s "https://api.jup.ag/price/v3?ids=XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp,...,PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh"
HTTP/2 200   x-ratelimit-remaining: 4   x-ratelimit-current: 1
{
 "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp": {
  "createdAt": "2025-06-10T11:06:56Z",
  "liquidity": 665581.2993734218,
  "usdPrice": 336.7591201208416,
  "blockId": 449783736,
  "decimals": 8,
  "priceChange24h": -1.4841687411702909,
  "stockData": {"id": "xstocks", "price": 337.375, "mcap": 4958372655000, "updatedAt": "2026-09-23T18:24:52.58Z"},
  "scaledUiConfig": {"multiplier": 1.0026642075893797, "newMultiplier": 1.0032690125398187,
    "newMultiplierEffectiveAt": "2026-08-08T00:30:00Z", "usdPricePrescaled": 337.85998990741496, ...}
 },
 "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw": {
  "liquidity": 710915.12, "usdPrice": 1031.5902917425183, "decimals": 9, "priceChange24h": -2.49,
  "stockData": {"id": "prestocks", "price": 1043.44019016, "mcap": 1709512204384, "updatedAt": "2026-09-23T18:25:18.047Z"}
 }, ... (13 kunci total)
}
```

Request Pyth yang gagal (bukti):
```
$ curl -s -w '%{http_code}' "https://hermes.pyth.network/v2/updates/price/latest?ids[]=49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688&parsed=true"
unauthorized401
```
