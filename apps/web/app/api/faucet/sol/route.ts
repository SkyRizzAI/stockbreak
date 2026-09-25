import type { Address } from "@solana/kit";
import * as z from "zod";
import { faucetSol } from "@/lib/server/faucet";
import { fail, guard, isAddress } from "@/lib/server/http";

const Body = z.object({ wallet: z.string() });

/** SOL for fees. Localnet: airdrop. Devnet: transfer from admin, rate-limited (D006). */
export async function POST(req: Request) {
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.wallet)) return fail(400, "Invalid wallet");
    return faucetSol(b.data.wallet as Address);
  });
}
