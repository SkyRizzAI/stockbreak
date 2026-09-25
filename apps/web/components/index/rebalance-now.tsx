"use client";
/**
 * Manual rebalance for the creator (A18 F5): Hold indexes, keeper-off indexes and
 * phasing an asset out to 0% need a person to trade. Plans one flash-rebalance
 * pair with the SDK planner (creator rules), previews it, then signs.
 */
import {
  chainClock,
  fetchIndex,
  fits,
  loadAlt,
  market,
  marketPda,
  planRebalance,
  rebalanceIxs,
  sendTx,
  valueIndex,
} from "@repo/sdk";
import type { Address, TransactionSigner } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { KV } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { bps, duration, num } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import type { IndexDetail } from "@/lib/types";

async function plan(pubkey: string) {
  const c = chain();
  const st = await fetchIndex(c, pubkey as Address);
  const [val, now, mk] = await Promise.all([
    valueIndex(c, st),
    chainClock(c),
    market.fetchMarket(c.rpc, await marketPda()),
  ]);
  const p = planRebalance(st, val, { keeper: false, now, spreadBps: mk.data.spreadBps });
  const cooldownLeft = Number(BigInt(st.strategy.cooldownSecs) - (now - st.lastRebalanceTs));
  return { st, val, p, cooldownLeft };
}

export function RebalanceNow({ d, signer }: { d: IndexDetail; signer: TransactionSigner }) {
  const { run, busy } = useRun();
  const q = useQuery({
    queryKey: ["rebalance-plan", d.pubkey, d.live.map((a) => a.weightBps).join(",")],
    queryFn: () => plan(d.pubkey),
    refetchInterval: 15_000,
  });
  const sym = (i: number) => d.live[i]?.symbol ?? `#${i}`;
  const dec = (i: number) => q.data?.st.assets[i]?.decimals ?? 6;

  const status = !q.data
    ? null
    : d.paused
      ? "Unpause the index to rebalance."
      : q.data.st.rebalanceTicket.__option === "Some"
        ? "A rebalance is in progress. Try again in a moment."
        : q.data.cooldownLeft > 0 && !q.data.p
          ? `Cooldown: next rebalance in ${duration(q.data.cooldownLeft)}.`
          : !q.data.p
            ? "Holdings are on target. Nothing to trade."
            : null;

  const submit = () =>
    run("Rebalance", async () => {
      const c = chain();
      // Re-plan at signing time: prices move while the preview is open.
      const fresh = await plan(d.pubkey);
      if (!fresh.p) throw new Error("Nothing to rebalance any more.");
      const ixs = await rebalanceIxs(signer, d.pubkey as Address, fresh.st, fresh.p);
      const alt = d.lookupTable as Address | null;
      const table = alt ? await loadAlt(c, alt) : undefined;
      const lookupTables = !fits(signer.address, ixs) && alt && table ? [alt] : undefined;
      const signature = await sendTx(c, signer, ixs, { lookupTables, computeUnitLimit: 800_000 });
      return { signature };
    });

  return (
    <div className="flex flex-col gap-3" data-testid="rebalance-preview">
      <p className="text-sm text-muted-foreground">
        One atomic trade toward the targets. The vault program checks slippage against the oracle
        and that every weight moves closer to target, or nothing happens.
      </p>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking holdings…</p>
      ) : q.isError ? (
        <p className="text-sm text-down" role="alert">
          Could not read the vault. Prices may be updating; try again in a moment.
        </p>
      ) : status ? (
        <p className="text-sm text-muted-foreground">{status}</p>
      ) : q.data?.p ? (
        <KV
          rows={[
            [
              "Sell",
              `${num(Number(q.data.p.amountOut) / 10 ** dec(q.data.p.assetOut))} ${sym(q.data.p.assetOut)}`,
            ],
            [
              "Buy (min)",
              `${num(Number(q.data.p.minIn) / 10 ** dec(q.data.p.assetIn))} ${sym(q.data.p.assetIn)}`,
            ],
            ["Drift", `${bps(q.data.p.driftBefore)} → ${bps(q.data.p.driftAfter)}`],
          ]}
        />
      ) : null}
      <Button
        variant="outline"
        className="self-start"
        disabled={busy || !q.data?.p || !!status}
        onClick={() => void submit().then(() => void q.refetch())}
        data-testid="rebalance-now"
      >
        {busy ? "Confirm in wallet…" : "Rebalance now"}
      </Button>
    </div>
  );
}
