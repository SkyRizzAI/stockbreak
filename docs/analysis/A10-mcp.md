# A10 — MCP

Sumber: README paket `@modelcontextprotocol/server@2.1.0` (terpasang), repo `modelcontextprotocol/typescript-sdk` (docs `servers/tools`, `serving/http`, `serving/stdio`), riset teruji di `research/R3-web-infra.md` §7, docs Claude Code MCP (code.claude.com/docs/en/mcp, dicek 2026-09-24).

## Temuan
- v2 (`@modelcontextprotocol/server` + `client` 2.1.0) = jalur stabil, spec 2026-07-28; klien 2025 tetap dilayani (legacy stateless default).
- `registerTool(name, { title, description, inputSchema: z.object(...), annotations }, cb)`; zod 4.6.5 satu versi di repo.
- stdio: `serveStdio(factory)`; log hanya ke stderr. HTTP: `createMcpHandler(factory)` dibungkus `Bun.serve` + `hostHeaderValidationResponse(localhostAllowedHostnames())` (tanpa ini tidak ada proteksi DNS rebinding).
- Zod 4: default/prefault berlaku walau dibungkus `.optional()` → skema update parsial harus tanpa default (D029).
- Claude Code: `claude mcp add --transport http <name> <url>`; stdio `claude mcp add [--env K=V] --transport stdio <name> -- <cmd> <args>`. Claude Desktop: `claude_desktop_config.json` `mcpServers.<name>.{type:"stdio",command,args}` dengan path absolut.

## Desain
- `apps/mcp/src`: `boot.ts` (REPO_ROOT + `.env` root agar jalan dari cwd mana pun), `ctx.ts` (env zod `mcpEnvSchema`, guard cluster localnet/devnet, DB, signer agent opsional, klien API web), `util.ts` (hasil ringkasan + JSON, `humanize` error program, resolver index simbol/alamat, batas USDC), `spec.ts` (skema create bersama), `rebalance.ts` (penilaian mandate + simulasi RPC), `tools/{read,simulate,intents,agent}.ts`, `guide.ts` (`docs://guide`), `server.ts`, `stdio.ts`, `http.ts` (`/mcp`, `/health`).
- Tool `agent_*` hanya didaftarkan bila `AGENT_KEYPAIR_PATH` diset.
