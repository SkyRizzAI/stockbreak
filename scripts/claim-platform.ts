/**
 * bun run claim:platform -- [--index <ADDRESS>] [--cluster localnet|devnet]
 * Platform treasury (admin) accrues and claims its fee shares on every index
 * (or one index). Prints the claimed share amounts.
 */
import { accrueFeesIx, claimFeesIxs, fetchAllIndexes, fetchIndex, sendTx, vault } from "@repo/sdk";
import type { Address } from "@solana/kit";
import { argValue, chainCtx } from "./lib/chain";

const c = await chainCtx();
const only = argValue("index");
const all = only
  ? [{ address: only as Address, data: await fetchIndex(c, only as Address) }]
  : await fetchAllIndexes(c);

let total = 0n;
for (const { address, data } of all) {
  if (data.rebalanceTicket.__option === "Some") continue;
  await sendTx(c, c.admin, [await accrueFeesIx(address as Address, data)]);
  const st = await fetchIndex(c, address as Address);
  if (st.owedPlatformShares === 0n) continue;
  const sig = await sendTx(
    c,
    c.admin,
    await claimFeesIxs(c.admin, address as Address, st, vault.FeeKind.Platform),
  );
  total += st.owedPlatformShares;
  console.log(
    `[claim] ${st.symbol}: ${(Number(st.owedPlatformShares) / 1e6).toFixed(6)} shares → treasury (${sig})`,
  );
}
console.log(`[claim] done: ${(Number(total) / 1e6).toFixed(6)} shares claimed on ${c.cluster}`);
