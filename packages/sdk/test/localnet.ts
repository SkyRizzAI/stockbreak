/**
 * Integration test harness (A12): isolated Surfpool on 18899/18900, programs
 * deployed with the project admin key, market bootstrapped via the SDK.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ASSETS } from "@repo/config";
import { type Address, generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import { type BootstrapResult, bootstrapMarket, ensureSol, setPrices } from "../src/bootstrap";
import { faucetIxs } from "../src/instructions";
import { loadSigner } from "../src/node";
import { createCtx, type SolanaCtx } from "../src/rpc";
import { sendTx } from "../src/tx";

const ROOT = path.resolve(import.meta.dir, "../../..");
const RPC = process.env.TEST_RPC_URL || "http://127.0.0.1:18899";
const WS = process.env.TEST_WS_URL || "ws://127.0.0.1:18900";
const SOLANA_BIN = path.join(
  homedir(),
  ".local/share/solana/install/releases/4.2.2/solana-release/bin",
);
const ENV = {
  ...process.env,
  PATH: existsSync(SOLANA_BIN) ? `${SOLANA_BIN}:${process.env.PATH}` : (process.env.PATH ?? ""),
};

export interface TestEnv {
  ctx: SolanaCtx;
  admin: KeyPairSigner;
  boot: BootstrapResult;
  usdc: Address;
  mint: (symbol: string) => Address;
  refreshPrices: (overrides?: Record<string, number>) => Promise<void>;
  newUser: (usdc?: bigint) => Promise<KeyPairSigner>;
  prices: Record<string, number>;
}

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}',
    });
    return ((await r.json()) as { result?: string }).result === "ok";
  } catch {
    return false;
  }
}

async function run(cmd: string[], cwd = ROOT): Promise<void> {
  const p = Bun.spawn(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code !== 0)
    throw new Error(`${cmd.join(" ")} failed: ${await new Response(p.stderr).text()}`);
}

async function start(): Promise<TestEnv> {
  if (!(await healthy())) {
    mkdirSync(path.join(ROOT, ".surfpool"), { recursive: true });
    const port = new URL(RPC).port;
    const wsPort = new URL(WS).port;
    const proc = Bun.spawn(
      [
        "surfpool",
        "start",
        "--offline",
        "--no-deploy",
        "--no-tui",
        "--no-studio",
        "--port",
        port,
        "--ws-port",
        wsPort,
      ],
      { cwd: path.join(ROOT, ".surfpool"), env: ENV, stdout: "ignore", stderr: "ignore" },
    );
    spawned = proc;
    process.on("exit", () => proc.kill("SIGKILL"));
    for (let i = 0; i < 120 && !(await healthy()); i++) await Bun.sleep(500);
    if (!(await healthy())) throw new Error("test validator did not start");
  }
  const ctx = createCtx("localnet", RPC, WS);
  const admin = await loadSigner(".keys/admin.json");
  await ensureSol(ctx, admin.address, 50);
  const deployed = await ctx.rpc
    .getAccountInfo("4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me" as Address)
    .send();
  if (!deployed.value) {
    for (const p of ["mock_market", "index_vault"]) {
      await run(
        [
          "anchor",
          "program",
          "deploy",
          "-p",
          p,
          "--provider.cluster",
          RPC,
          "--provider.wallet",
          path.join(ROOT, ".keys/admin.json"),
          "--program-keypair",
          path.join(ROOT, `anchor/keys/${p}-keypair.json`),
        ],
        path.join(ROOT, "anchor"),
      );
    }
  }
  const prices: Record<string, number> = Object.fromEntries(
    ASSETS.map((a) => [a.symbol, a.fixturePrice]),
  );
  const boot = await bootstrapMarket(ctx, admin, { cluster: "localnet" });
  const usdc = boot.mints.USDC as Address;
  const env: TestEnv = {
    ctx,
    admin,
    boot,
    usdc,
    prices,
    mint: (s) => {
      const m = boot.mints[s];
      if (!m) throw new Error(`no mint ${s}`);
      return m;
    },
    refreshPrices: async (overrides = {}) => {
      Object.assign(prices, overrides);
      await setPrices(
        ctx,
        admin,
        Object.entries(boot.feeds).map(([symbol, feed]) => ({ feed, usd: prices[symbol] ?? 1 })),
      );
    },
    newUser: async (amount = 0n) => {
      const u = await generateKeyPairSigner();
      await ensureSol(ctx, u.address, 5);
      if (amount > 0n) await sendTx(ctx, u, await faucetIxs(u, usdc, amount));
      return u;
    },
  };
  return env;
}

let spawned: ReturnType<typeof Bun.spawn> | null = null;

/** Stop the validator this harness started (a pre-existing one is left alone). */
export async function stopTestValidator(): Promise<void> {
  if (!spawned) return;
  spawned.kill("SIGTERM");
  await Promise.race([spawned.exited, Bun.sleep(5_000)]);
  if (spawned.exitCode === null) spawned.kill("SIGKILL");
  spawned = null;
}

const g = globalThis as unknown as { __sdkTestEnv?: Promise<TestEnv> };

export function testEnv(): Promise<TestEnv> {
  g.__sdkTestEnv ??= start();
  return g.__sdkTestEnv;
}
