import { faucetSince, recordFaucet } from "@repo/db";
import { ensureSol, sendTx, solBalance } from "@repo/sdk";
import { type Address, lamports } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import * as z from "zod";
import { admin, chain, db, serverEnv } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";

const Body = z.object({ wallet: z.string() });
const DAY = 86_400_000;

/** SOL for fees. Localnet: airdrop. Devnet: transfer from admin, rate-limited (D006). */
export async function POST(req: Request) {
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.wallet)) return fail(400, "Invalid wallet");
    const e = serverEnv();
    const c = chain();
    const wallet = b.data.wallet as Address;
    const amount = BigInt(Math.round(e.FAUCET_SOL_PER_REQUEST * 1e9));
    if (e.CLUSTER === "localnet") {
      await ensureSol(c, wallet, (await solBalance(c, wallet)) + 2);
      await recordFaucet(db(), { wallet, kind: "SOL", amount: 2_000_000_000n, cluster: e.CLUSTER });
      return { ok: true, sol: 2 };
    }
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
  });
}

let queue: Promise<void> = Promise.resolve();

async function payout(wallet: Address, amount: bigint) {
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
