# A06 — Sumber harga

## Pertanyaan
Sumber harga nyata gratis untuk saham tokenized & pre-IPO; perilaku di luar jam bursa; fallback.

## Sumber yang dibaca
`research/R4-prices.md` (diuji curl 2026-09-23/24): https://developers.jup.ag/docs/price/v3 · https://docs.pyth.network/price-feeds/core/upgrade/preparing · https://xstocks.fi/us/products · https://finnhub.io/docs/api/quote.

## Temuan
- Jupiter Price v3 `GET https://api.jup.ag/price/v3?ids=<≤50 mint>`: tanpa key 30 rpm, dengan `x-api-key` 60 rpm. Field `usdPrice` (harga token) dan `stockData.price` (harga saham acuan). Semua 8 xStocks + SPCXx + 4 PreStocks tersedia (diverifikasi dengan key user, HTTP 200).
- Pyth Hermes wajib key sejak 2026-08-26 → opsional.
- Finnhub `quote?symbol=AAPL` (key user, HTTP 200) → fallback saham US.
- Di luar jam bursa harga saham diam; xStocks tetap diperdagangkan 24/7 sehingga `usdPrice` bergerak kecil.
- PreStocks tipis likuiditas → harga bisa jauh dari acuan (catatan UI "Simulated").

## Keputusan
Urutan per aset (worker price-feeder, `PRICE_MODE=live`): 1) Jupiter (`stockData.price` → `usdPrice`) satu request untuk semua mint; 2) Finnhub untuk saham US bila key ada; 3) Pyth bila `PYTH_API_KEY`; 4) random walk ±0,3%/tick dari harga terakhir (atau `fixturePrice`). `PRICE_MODE=random` langsung ke 4. Faktor shock `deployments/{cluster}.shocks.json` dikalikan pada hasil akhir (`bun run price`). Harga ditulis ulang setiap interval walau tidak berubah agar oracle tidak basi (localnet 15 dtk, devnet 60 dtk; `oracle_max_age_secs` localnet 120, devnet 600). IPO target tanpa mint mainnet (OPENAIx, ANTHRPx, ANDURLx) mewarisi harga pre-IPO-nya.

## Dampak ke implementasi
`apps/worker/src/loops/price.ts`, tabel `prices` (source: jupiter|finnhub|pyth|random|fixture), backoff 429.
