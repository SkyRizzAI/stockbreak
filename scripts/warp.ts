/**
 * bun run warp -- --days <N>
 * Time-travel the local Surfpool validator forward (fee accrual demos). Not
 * available on devnet or solana-test-validator: prints a message and exits 0.
 */
import { chainClock } from "@repo/sdk";
import { argValue, chainCtx } from "./lib/chain";
import { log } from "./lib/proc";

const S = "warp";
const days = Number(argValue("days") ?? "0");
if (!(days > 0)) {
  console.error("usage: bun run warp -- --days <N>");
  process.exit(1);
}
const c = await chainCtx();
if (c.cluster !== "localnet") {
  log(S, "time travel is only available on the local Surfpool validator; nothing to do.");
  process.exit(0);
}
const rpc = async (method: string, params: unknown[]) => {
  const r = await fetch(c.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()) as { result?: unknown; error?: { message: string } };
};
// Base on the Clock sysvar (what programs see); block time lags after earlier warps
// and would move the clock backwards.
const nowMs = Number(await chainClock(c)) * 1000;
const target = nowMs + days * 86_400_000;
const res = await rpc("surfnet_timeTravel", [{ absoluteTimestamp: target }]);
if (res.error) {
  log(S, `time travel not supported by this validator (${res.error.message}); nothing to do.`);
  process.exit(0);
}
log(
  S,
  `validator clock moved forward ${days} day(s). The price feeder refreshes oracles on its next tick.`,
);
process.exit(0);
