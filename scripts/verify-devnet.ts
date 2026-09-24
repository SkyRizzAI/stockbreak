/**
 * bun run verify:devnet — PLAN §11.4 readiness check against devnet.
 *
 * Starts `bun scripts/dev.ts --cluster devnet --ci` (production web build,
 * worker, MCP; all pointed at devnet) unless a devnet stack is already
 * running, then runs the Playwright suites that exercise real transactions
 * with the Dev Wallet: flows (faucet, join, redeem, create, manage, clone,
 * follow), Blinks (tx simulated on devnet RPC) and MCP → /sign.
 * Every transaction is v0 (+ALT when needed) and is simulated by the RPC
 * before sending — the same code path Phantom signs.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { clearFaucetClaimsSince, closeDb, getDb } from "@repo/db";
import { rpcUrlFor } from "./lib/chain";
import { log, run } from "./lib/proc";
import { ROOT, toolchainEnv } from "./lib/toolchain";

const S = "verify-devnet";
const WEB = "http://localhost:3000";
const MCP = `http://127.0.0.1:${process.env.MCP_HTTP_PORT || 3333}/health`;

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}
const cluster = async () => (await json<{ cluster: string }>(`${WEB}/api/config`))?.cluster ?? null;

let dev: ReturnType<typeof Bun.spawn> | null = null;
async function stop(): Promise<void> {
  if (!dev) return;
  dev.kill("SIGTERM");
  await Promise.race([dev.exited, Bun.sleep(20_000)]);
  dev = null;
}
process.on("SIGINT", () => void stop().then(() => process.exit(130)));

let code = 1;
const started = new Date();
try {
  const running = await cluster();
  if (running === "devnet" && (await json(MCP))) {
    log(S, "reusing the running devnet stack");
  } else {
    if (running || (await json(MCP)))
      throw new Error(
        `a ${running ?? "different"} stack is using ports 3000/3333 — stop it first (Ctrl+C in its terminal)`,
      );
    log(S, "starting bun scripts/dev.ts --cluster devnet --ci");
    const dir = path.join(ROOT, "e2e/.stack");
    mkdirSync(dir, { recursive: true });
    const out = Bun.file(path.join(dir, "dev-devnet.log"));
    dev = Bun.spawn(["bun", "scripts/dev.ts", "--cluster", "devnet", "--ci"], {
      cwd: ROOT,
      // Test wallets need only fees + rent; keep admin SOL for manual testing.
      env: toolchainEnv({ FAUCET_SOL_PER_REQUEST: "0.1" }),
      stdout: out,
      stderr: out,
      stdin: "ignore",
    });
    const until = Date.now() + 15 * 60_000;
    while (!((await cluster()) === "devnet" && (await json(MCP)))) {
      if (dev.exitCode !== null)
        throw new Error("devnet stack exited — see e2e/.stack/dev-devnet.log");
      if (Date.now() > until) throw new Error("devnet stack not ready after 15 min");
      await Bun.sleep(3_000);
    }
  }
  const { rpcUrl } = rpcUrlFor("devnet");
  const r = await run(
    [
      "bunx",
      "playwright",
      "test",
      "tests/flows.spec.ts",
      "tests/blinks.spec.ts",
      "tests/agent.spec.ts",
      ...process.argv.slice(2).filter((a) => a !== "--"),
    ],
    {
      cwd: path.join(ROOT, "e2e"),
      env: { E2E_RPC_URL: rpcUrl, E2E_CLUSTER: "devnet" },
      allowFail: true,
    },
  );
  code = r.code;
} catch (e) {
  console.error(`[${S}]`, e instanceof Error ? e.message : e);
} finally {
  await stop();
  // Test wallets must not use up the SOL faucet budget left for manual testing.
  const url = new URL(
    process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5434/app",
  );
  url.pathname = "/app_devnet";
  const n = await clearFaucetClaimsSince(getDb(url.toString()), "devnet", started).catch(() => 0);
  if (n) log(S, `released ${n} test faucet claims from today's budget`);
  await closeDb(url.toString()).catch(() => {});
}
log(S, code === 0 ? "PASS" : "FAIL");
process.exit(code);
