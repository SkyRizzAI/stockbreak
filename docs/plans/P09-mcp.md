# P09 — MCP

## Tujuan
Server MCP (stdio + Streamable HTTP) dengan tool PLAN §7.6: riset, intent human-in-the-loop, dan mode agent wallet yang dibatasi program.

## Referensi
PLAN §7.6 · A10 · D028 · D029.

## Desain singkat
Lihat A10 §Desain. 18 tool + resource `docs://guide`. `simulate_rebalance` meniru semua pemeriksaan `begin/end_rebalance` (pause, ticket, cooldown, peran, keeper/pre-IPO, trigger, slippage, arah drift) lalu mensimulasikan transaksi di RPC sehingga program memberi putusan akhir. `agent_rebalance` menolak dengan alasan manusiawi bila pemeriksaan/simulasi gagal.

## Gate (dijalankan 2026-09-24)
- [x] `bunx tsc --noEmit` apps/mcp, `bun run lint`, `bun run typecheck` hijau
- [x] `apps/mcp/test/mcp.test.ts` (10 test, stack localnet): daftar tool + guide, tanpa bocor env/secret, riset, intent + status, validasi input & batas nominal, agent register/create+deposit/join, pelanggaran mandate ditolak ("That trade would move the index away from its targets."), propose→apply (timelock 0) → rebalance sukses
- [x] Transport nyata: HTTP 127.0.0.1:3333 (`/health`, Host asing → 403) dan stdio dari cwd `/` dengan env minimal → 18 tool, `get_index` OK
- [x] `e2e/tests/agent.spec.ts`: MCP `build_join` & `build_create_index` → `/sign` dev wallet → intent `executed`, index ter-index
- [x] `docs/DEMO.md` bagian "Connect an AI agent"
