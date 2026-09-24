/**
 * bun run deploy:devnet [-- --no-seed]
 *
 * 1. Build programs if needed (anchor build).
 * 2. Deploy or upgrade index_vault + mock_market on devnet with the project keys
 *    (deployer .keys/admin.json, program ids anchor/keys/*.json). Skips a program
 *    whose on-chain bytes already match the local build.
 * 3. Bootstrap devnet (market, mints, feeds, config) → deployments/devnet.json.
 * 4. Fund keeper & agent with SOL from admin.
 * 5. Light seed (3 example indexes) unless --no-seed.
 *
 * Uses DEVNET_RPC_URL and never the global Solana CLI config. Mainnet is refused.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { INDEX_VAULT_PROGRAM_ID, MOCK_MARKET_PROGRAM_ID } from "@repo/config";
import { sendTx } from "@repo/sdk";
import { address, getBase58Decoder, lamports } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { balanceSol, chainCtx, rpcUrlFor } from "./lib/chain";
import { log, run } from "./lib/proc";
import { ANCHOR_DIR, KEYS_DIR, ROOT, SOLANA_CLI_CONFIG } from "./lib/toolchain";

const S = "deploy-devnet";
const noSeed = process.argv.includes("--no-seed");
const { rpcUrl } = rpcUrlFor("devnet");
if (/mainnet/i.test(rpcUrl))
  throw new Error("Refusing to deploy: DEVNET_RPC_URL points at mainnet");
const redacted = rpcUrl.replace(/([?&]api-key=)[^&]+/i, "$1***");

const c = await chainCtx("devnet");
const genesis = await c.rpc.getGenesisHash().send();
// Devnet genesis hash; guards against a misconfigured RPC.
if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
  throw new Error(`RPC ${redacted} is not Solana devnet (genesis ${genesis})`);

const PROGRAMS = [
  { name: "mock_market", id: MOCK_MARKET_PROGRAM_ID },
  { name: "index_vault", id: INDEX_VAULT_PROGRAM_ID },
];

const so = (name: string) => path.join(ANCHOR_DIR, "target/deploy", `${name}.so`);
if (PROGRAMS.some((p) => !existsSync(so(p.name)))) {
  log(S, "building programs (anchor build)");
  await run(["anchor", "build"], { cwd: ANCHOR_DIR });
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** On-chain program bytes (ProgramData account minus its 45-byte header), or null. */
async function deployedBytes(programId: string): Promise<Uint8Array | null> {
  const prog = await c.rpc.getAccountInfo(address(programId), { encoding: "base64" }).send();
  if (!prog.value) return null;
  const pdAddr = Buffer.from(prog.value.data[0], "base64").subarray(4, 36);
  const pd = await c.rpc
    .getAccountInfo(address(getBase58Decoder().decode(pdAddr)), { encoding: "base64" })
    .send();
  if (!pd.value) return null;
  return Buffer.from(pd.value.data[0], "base64").subarray(45);
}

async function rentSol(bytes: number): Promise<number> {
  return Number(await c.rpc.getMinimumBalanceForRentExemption(BigInt(bytes)).send()) / 1e9;
}

// Budget check: program data + a temporary buffer of the same size, per program.
let need = 0;
const todo: typeof PROGRAMS = [];
for (const p of PROGRAMS) {
  const local = new Uint8Array(readFileSync(so(p.name)));
  const onchain = await deployedBytes(p.id);
  if (
    onchain &&
    sha(onchain.subarray(0, local.length)) === sha(local) &&
    onchain.subarray(local.length).every((b) => b === 0)
  ) {
    log(S, `${p.name} ${p.id} already up to date`);
    continue;
  }
  todo.push(p);
  need += (onchain ? 0 : await rentSol(local.length + 45)) + (await rentSol(local.length + 37));
}
const bal = await balanceSol(c, c.admin.address);
log(S, `admin ${c.admin.address}: ${bal.toFixed(3)} SOL on devnet (${redacted})`);
if (todo.length && bal < need + 0.5) {
  console.error(
    `BLOCKED(eksternal): deploying ${todo.map((p) => p.name).join(", ")} needs ~${(need + 0.5).toFixed(2)} SOL, admin has ${bal.toFixed(3)} SOL. Fund ${c.admin.address} on devnet and re-run.`,
  );
  process.exit(2);
}

for (const p of todo) {
  // A persistent buffer keypair lets a failed upload resume: the CLI only rewrites
  // chunks that differ on chain. Removed after a successful deploy.
  const buffer = path.join(KEYS_DIR, `deploy-buffer-${p.name}.json`);
  if (!existsSync(buffer))
    await run(["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "--outfile", buffer], {
      capture: true,
    });
  let ok = false;
  for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
    log(S, `deploying ${p.name} → ${p.id} (attempt ${attempt})`);
    const r = await run(
      [
        "solana",
        "program",
        "deploy",
        so(p.name),
        "--program-id",
        path.join(ANCHOR_DIR, "keys", `${p.name}-keypair.json`),
        "--buffer",
        buffer,
        "--config",
        SOLANA_CLI_CONFIG,
        "--url",
        rpcUrl,
        "--keypair",
        path.join(KEYS_DIR, "admin.json"),
        // Odd attempts go through the RPC, even ones through TPU (QUIC).
        ...(attempt % 2 === 1 ? ["--use-rpc"] : []),
        "--with-compute-unit-price",
        "10000",
        "--max-sign-attempts",
        "100",
      ],
      { capture: true, allowFail: true },
    );
    ok = r.code === 0;
    if (!ok)
      log(
        S,
        `attempt ${attempt} failed: ${(r.stderr || r.stdout).split("\n").find((l) => /error/i.test(l)) ?? "unknown error"}`,
      );
  }
  if (!ok)
    throw new Error(`deploying ${p.name} failed after 4 attempts; re-run to resume the upload`);
  rmSync(buffer, { force: true });
  log(S, `${p.name} deployed`);
}

log(S, "bootstrap (market, mints, feeds, config)");
await run(["bun", "scripts/bootstrap.ts", "--cluster", "devnet"], { cwd: ROOT });

for (const w of [c.keeper, c.agent]) {
  const have = await balanceSol(c, w.address);
  if (have >= 0.3) continue;
  await sendTx(c, c.admin, [
    getTransferSolInstruction({
      source: c.admin,
      destination: w.address,
      amount: lamports(BigInt(Math.round((0.5 - have) * 1e9))),
    }),
  ]);
  log(S, `funded ${w.address} to 0.5 SOL`);
}

if (!noSeed) {
  log(S, "light seed (3 example indexes)");
  await run(["bun", "scripts/seed.ts", "--cluster", "devnet", "--light"], { cwd: ROOT });
}
log(
  S,
  `done. Admin balance ${(await balanceSol(c, c.admin.address)).toFixed(3)} SOL. Next: bun run dev:devnet`,
);
process.exit(0);
