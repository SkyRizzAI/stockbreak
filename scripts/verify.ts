/**
 * bun run verify — PLAN §11.2 gate: lint, typecheck, program tests (LiteSVM),
 * TS tests, build, then e2e (MCP + Playwright) on a localnet stack.
 *   --skip-e2e   everything except the e2e step
 */
import { log, run } from "./lib/proc";

const S = "verify";
const skipE2e = process.argv.includes("--skip-e2e");
const steps: [string, string[]][] = [
  ["lint", ["bun", "run", "lint"]],
  ["typecheck", ["bun", "run", "typecheck"]],
  ["test:program", ["bun", "run", "test:program"]],
  ["test:ts", ["bun", "run", "test:ts"]],
  ["build", ["bun", "run", "build"]],
  ...(skipE2e ? [] : ([["e2e", ["bun", "run", "e2e"]]] as [string, string[]][])),
];

const results: { name: string; ok: boolean; secs: number }[] = [];
for (const [name, cmd] of steps) {
  log(S, `▶ ${name}`);
  const t0 = Date.now();
  const r = await run(cmd, { allowFail: true });
  results.push({ name, ok: r.code === 0, secs: Math.round((Date.now() - t0) / 1000) });
  if (r.code !== 0) break;
}
console.log("");
for (const r of results) log(S, `${r.ok ? "✓" : "✗"} ${r.name} (${r.secs}s)`);
const ok = results.length === steps.length && results.every((r) => r.ok);
log(S, ok ? "ALL GREEN" : "FAILED");
process.exit(ok ? 0 : 1);
