/** simulate_rebalance: suggested swap + whether it passes the mandate, and why. */
import type { McpServer } from "@modelcontextprotocol/server";
import type { Address } from "@solana/kit";
import * as z from "zod";
import type { McpCtx } from "../ctx";
import { assess, describe } from "../rebalance";
import { BASE58, ok, resolveIndex, safe } from "../util";

export function registerSimulateTool(s: McpServer, ctx: () => Promise<McpCtx>): void {
  s.registerTool(
    "simulate_rebalance",
    {
      title: "Simulate rebalance",
      description:
        "Suggest the swap that brings an index closest to its targets (or test a custom swap) and check it against the mandate: pause, cooldown, executor role, keeper trigger, slippage and drift direction. Also simulates the transaction on chain so the program gives the final verdict. Read-only.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        executor: z
          .string()
          .regex(BASE58)
          .optional()
          .describe("Wallet that would rebalance; defaults to the agent wallet"),
        sell: z.string().optional().describe("Custom swap: asset symbol to sell"),
        buy: z.string().optional().describe("Custom swap: asset symbol to buy"),
        amountUsd: z.number().positive().optional().describe("Custom swap: value to move"),
      }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ index, executor, sell, buy, amountUsd }) => {
      const c = await ctx();
      const who = (executor ?? c.agent?.address) as Address | undefined;
      if (!who) throw new Error("Pass an executor address (agent wallet mode is off).");
      const custom =
        sell || buy || amountUsd
          ? { sell: sell ?? "", buy: buy ?? "", amountUsd: amountUsd ?? 0 }
          : undefined;
      if (custom && (!custom.sell || !custom.buy || !(custom.amountUsd > 0)))
        throw new Error("A custom swap needs sell, buy and amountUsd.");
      const ref = await resolveIndex(c, index);
      const a = await assess(c, ref.pubkey as Address, who, custom);
      const failed = a.checks.filter((x) => !x.ok).map((x) => x.detail);
      if (a.simulation?.error && !a.simulation.ok) failed.push(`Program: ${a.simulation.error}`);
      const head = a.allowed
        ? `${ref.symbol}: rebalance allowed for this executor (${a.role}).`
        : `${ref.symbol}: rebalance would be rejected. ${failed.join(" ")}`;
      return ok(head, describe(c, a));
    }),
  );
}
