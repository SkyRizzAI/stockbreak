"use client";
/**
 * Index assets sitting in the wallet outside any index (e.g. a join that
 * stopped after its swaps, or a redeem whose swap back did not finish).
 */
import { swapToUsdc, walletAssetBalances } from "@repo/sdk";
import type { Address } from "@solana/kit";
import { useQuery } from "@tanstack/react-query";
import { Section } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { useSignerRef } from "@/components/wallet/recovery";
import { useConfig, usePrices } from "@/lib/api";
import { num, usd } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";

export function LooseAssets({ address }: { address: string }) {
  const cfg = useConfig();
  const prices = usePrices();
  const signer = useSignerRef();
  const { run, busy } = useRun();
  const usdcMint = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint as Address | undefined;
  const mints = (cfg.data?.assets ?? [])
    .filter((a) => a.mint !== usdcMint)
    .map((a) => a.mint as Address);
  const q = useQuery({
    queryKey: ["loose-assets", address, mints.length],
    enabled: !!usdcMint && mints.length > 0,
    refetchInterval: 15_000,
    queryFn: () => walletAssetBalances(chain(), address as Address, mints),
  });
  const rows = (q.data ?? []).map((a) => {
    const meta = cfg.data?.assets.find((x) => x.mint === a.mint);
    const amount = (Number(a.amount) / 10 ** a.decimals) * a.multiplier;
    const price = prices.data?.find((p) => p.mint === a.mint)?.price;
    return {
      ...a,
      symbol: meta?.symbol ?? a.mint.slice(0, 4),
      amount,
      value: price ? amount * price : null,
    };
  });
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const swapAll = () =>
    run(
      "Swap to USDC",
      (onProgress) =>
        signer.current && usdcMint
          ? swapToUsdc(
              chain(),
              signer.current,
              usdcMint,
              rows.map((r) => ({ mint: r.mint })),
              { onProgress },
            )
          : Promise.reject(new Error("Wallet not connected")),
      () => "Swapped the assets to USDC",
    );
  return (
    <Section
      title="Loose assets"
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !signer.current}
          onClick={() => void swapAll()}
          data-testid="swap-to-usdc"
        >
          {busy ? "Confirm in wallet…" : "Swap all to USDC"}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 rounded-2xl border p-3" data-testid="loose-assets">
        <p className="text-xs text-muted-foreground">
          Assets in your wallet that are not in any index, worth about{" "}
          <span className="num text-foreground">{usd(total)}</span>. Swap them back to USDC or use
          them to finish a join.
        </p>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.mint} className="flex items-center justify-between py-2">
              <span className="mono">{r.symbol}</span>
              <span className="num text-muted-foreground">
                {num(r.amount, 4)}
                {r.value !== null ? ` · ${usd(r.value)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
