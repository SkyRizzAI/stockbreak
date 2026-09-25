import "server-only";
/**
 * SOL for fees (D006): localnet airdrop; devnet transfer from admin, rate-limited per
 * wallet and by a daily cap. Shared by /api/faucet/sol and agent funding (D045).
 * Simulated USDC for agent wallets (D046): see faucetUsdcForAgent.
 */
import { faucetSince, recordFaucet } from "@repo/db";
import { ata, ensureSol, faucetIxs, sendTx, solBalance, TOKEN_PROGRAM } from "@repo/sdk";
import { type Address, type KeyPairSigner, lamports } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import type { NextResponse } from "next/server";
import { admin, adminAvailable, chain, db, requireDeployment, serverEnv } from "./ctx";
import { fail } from "./http";

const DAY = 86_400_000;

export type SolFaucetResult = { ok: true; sol: number; signature?: string } | NextResponse;

export async function faucetSol(wallet: Address): Promise<SolFaucetResult> {
  const e = serverEnv();
  const c = chain();
  const amount = BigInt(Math.round(e.FAUCET_SOL_PER_REQUEST * 1e9));
  if (e.CLUSTER === "localnet") {
    await ensureSol(c, wallet, (await solBalance(c, wallet)) + 2);
    await recordFaucet(db(), { wallet, kind: "SOL", amount: 2_000_000_000n, cluster: e.CLUSTER });
    return { ok: true, sol: 2 };
  }
  if (!adminAvailable())
    return fail(
      503,
      "The SOL faucet is off on this deployment. Get devnet SOL at faucet.solana.com, then come back for USDC.",
    );
  // One devnet payout at a time: check-then-send must not race (limits and daily cap).
  const prev = queue;
  let release = () => {};
  queue = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await payout(wallet, amount);
  } finally {
    release();
  }
}

let queue: Promise<void> = Promise.resolve();

async function payout(wallet: Address, amount: bigint): Promise<SolFaucetResult> {
  const e = serverEnv();
  const c = chain();
  const since = new Date(Date.now() - DAY);
  const mine = await faucetSince(db(), { wallet, kind: "SOL", cluster: e.CLUSTER }, since);
  if (mine >= amount * 2n)
    return fail(429, "Faucet limit reached for this wallet. Try again in 24 hours.");
  const total = await faucetSince(db(), { kind: "SOL", cluster: e.CLUSTER }, since);
  if (total + amount > BigInt(Math.round(e.FAUCET_SOL_DAILY_CAP * 1e9)))
    return fail(429, "The daily SOL faucet budget is used up. Try again tomorrow.");
  if ((await solBalance(c, wallet)) >= 1)
    return fail(400, "This wallet already has enough SOL for fees.");
  const a = await admin();
  const sig = await sendTx(c, a, [
    getTransferSolInstruction({ source: a, destination: wallet, amount: lamports(amount) }),
  ]);
  await recordFaucet(db(), { wallet, kind: "SOL", amount, cluster: e.CLUSTER });
  return { ok: true, sol: e.FAUCET_SOL_PER_REQUEST, signature: sig };
}

/** Per-agent cap on simulated USDC minted through agent funding (D046). */
export const AGENT_USDC_DAILY_CAP = 10_000;
/** SOL the agent needs to pay the faucet fee (+ USDC account rent when it is missing). */
const FEE_SOL = 0.00001;
const ATA_RENT_SOL = 0.0021;

export type UsdcFaucetResult = { ok: true; usdc: number; signature: string } | NextResponse;

/**
 * Simulated USDC for an agent wallet (D046): the agent itself signs the mock market
 * faucet (so it must hold SOL for the fee). Capped per request by the cluster faucet
 * max and per agent by AGENT_USDC_DAILY_CAP, recorded as faucet claims of kind "USDC".
 */
export async function faucetUsdcForAgent(
  agent: KeyPairSigner,
  usdc: number,
): Promise<UsdcFaucetResult> {
  const prev = usdcQueue;
  let release = () => {};
  usdcQueue = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await mintUsdc(agent, usdc);
  } finally {
    release();
  }
}

let usdcQueue: Promise<void> = Promise.resolve();

async function mintUsdc(agent: KeyPairSigner, usdc: number): Promise<UsdcFaucetResult> {
  const e = serverEnv();
  const c = chain();
  const amount = BigInt(Math.round(usdc * 1e6));
  const since = new Date(Date.now() - DAY);
  const used = await faucetSince(
    db(),
    { wallet: agent.address, kind: "USDC", cluster: e.CLUSTER },
    since,
  );
  const cap = BigInt(AGENT_USDC_DAILY_CAP) * 1_000_000n;
  if (used + amount > cap) {
    const left = Number(cap > used ? cap - used : 0n) / 1e6;
    return fail(
      429,
      left > 0
        ? `Daily USDC limit for this agent: ${left.toLocaleString("en-US")} USDC left today.`
        : "Daily USDC limit reached for this agent. Try again in 24 hours.",
    );
  }
  const usdcMint = requireDeployment().mints.USDC as Address | undefined;
  if (!usdcMint) return fail(503, "USDC is not deployed on this cluster");
  const account = await ata(agent.address, usdcMint, TOKEN_PROGRAM);
  const { value: existing } = await c.rpc
    .getAccountInfo(account, { encoding: "base64", commitment: "confirmed" })
    .send();
  if ((await solBalance(c, agent.address)) < FEE_SOL + (existing ? 0 : ATA_RENT_SOL))
    return fail(400, "Fund SOL first: the agent pays the transaction fee");
  const signature = await sendTx(c, agent, await faucetIxs(agent, usdcMint, amount));
  await recordFaucet(db(), { wallet: agent.address, kind: "USDC", amount, cluster: e.CLUSTER });
  return { ok: true, usdc, signature };
}
