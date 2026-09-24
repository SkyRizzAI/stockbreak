# P01 — Scaffold monorepo

## Tujuan
Monorepo Bun + Turborepo dengan semua app/paket kosong, workspace Anchor, Biome, Playwright, Postgres, dan script root.

## Referensi
PLAN §3, §4.2, §7.9, §10 P1, §12 · A01 · A02.

## Scope
Masuk: struktur, konfigurasi, script `setup` nyata, stub script lain. Tidak masuk: kode fitur.

## Desain singkat
- Generator (di tmp, tanpa git): `create-turbo` (template default `basic` — `with-biome` gagal karena rate limit GitHub API, D021), `create-next-app`, `shadcn init/add`, `bun init` (config, sdk, db, worker, mcp, scripts), `anchor init/new`, `bun create playwright`, `bunx biome init`.
- Nama paket `@repo/*`; TS 5.9.3 di root; Biome satu config root; ESLint/Prettier template dihapus.
- `docker-compose.yml` ditulis tangan (tidak ada generator resmi untuk compose Postgres; D022).

## Tugas
- [x] Turborepo root + `packages/typescript-config`
- [x] `apps/web` (Next 16, Tailwind 4, shadcn base-nova + 39 komponen), `next.config.ts` memuat `.env` root, `agentRules: false`
- [x] `apps/{worker,mcp}`, `packages/{config,sdk,db}`, `scripts` via `bun init`
- [x] `anchor/` (index_vault, mock_market), keys di `anchor/keys`, rust 1.98.1, LiteSVM 0.16
- [x] `e2e/` Playwright (lockfile npm dihapus, D017)
- [x] Biome, turbo.json (env pass-through), `.env.example`, `.gitignore`, `docker-compose.yml`
- [x] `scripts/setup.ts` + stub script lain

## Gate / kriteria selesai
- [x] `bun run setup` · [x] `bun run lint` · [x] `bun run typecheck` · [x] `bun run build` · [x] `anchor build` + `cargo test`

## Risiko & fallback
Rate limit GitHub API untuk generator yang mengunduh contoh → template default.

## Catatan untuk fase berikutnya
- Bun memakai linker isolated: setiap paket harus mendeklarasikan dependensinya sendiri.
- drizzle-kit dipasang di P2; `setup` otomatis menjalankan migrasi bila `packages/db/drizzle` ada.
