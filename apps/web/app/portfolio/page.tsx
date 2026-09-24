"use client";
import { claimFeesIxs, fetchIndex, sendTx, vault } from "@repo/sdk";
import type { Address } from "@solana/kit";
import Link from "next/link";
import { toneOf, Usd } from "@/components/data/num";
import {
  EmptyState,
  ErrorState,
  RowsSkeleton,
  Section,
  SimulatedBadge,
} from "@/components/data/states";
import { LinkButton } from "@/components/link-button";
import { PositionsTable } from "@/components/pages/positions-table";
import { openConnect, useBalances } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolio } from "@/lib/api";
import { num } from "@/lib/format";
import { chain } from "@/lib/solana";
import { useRun } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

export default function PortfolioPage() {
  const w = useWallet();
  const q = usePortfolio(w.address);
  const bal = useBalances(w.address);
  const { run, busy } = useRun();
  if (!w.address)
    return (
      <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-3 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted-foreground">
          Connect a wallet to see your positions and the fees you earn.
        </p>
        <Button onClick={openConnect}>Connect wallet</Button>
      </div>
    );
  const p = q.data;
  const claim = (index: string, kind: vault.FeeKind, parent?: string) =>
    run(kind === vault.FeeKind.Parent ? "Claim royalty" : "Claim fees", async () => {
      const s = w.signer as NonNullable<typeof w.signer>;
      const st = await fetchIndex(chain(), index as Address);
      return {
        signature: await sendTx(
          chain(),
          s,
          await claimFeesIxs(s, index as Address, st, kind, parent as Address | undefined),
        ),
      };
    });
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
            <SimulatedBadge />
          </div>
          <span className="num text-4xl font-medium tracking-tight" data-testid="portfolio-total">
            <Usd value={p?.totalUsd ?? 0} digits={2} />
          </span>
          {p ? (
            <span className={`num text-sm ${toneOf(p.pnlUsd, 0.005)}`}>
              {Math.abs(p.pnlUsd) < 0.005 ? "" : p.pnlUsd > 0 ? "+" : "−"}
              <Usd value={Math.abs(p.pnlUsd)} digits={2} /> all time
            </span>
          ) : null}
        </div>
        <div className="flex gap-6 text-sm">
          <span className="flex flex-col">
            <span className="text-xs text-muted-foreground">USDC</span>
            <span className="num">{bal.data ? num(bal.data.usdc) : "—"}</span>
          </span>
          <span className="flex flex-col">
            <span className="text-xs text-muted-foreground">SOL</span>
            <span className="num">{bal.data ? num(bal.data.sol, 3) : "—"}</span>
          </span>
        </div>
      </div>
      <Section title="Positions">
        {q.isLoading ? (
          <RowsSkeleton rows={4} />
        ) : q.isError ? (
          <ErrorState message="Could not load your portfolio." onRetry={() => void q.refetch()} />
        ) : !p?.positions.length ? (
          <EmptyState
            title="You have no positions yet."
            action={
              <LinkButton href="/explore" variant="outline" size="sm">
                Explore indexes
              </LinkButton>
            }
          />
        ) : (
          <PositionsTable rows={p.positions} />
        )}
      </Section>
      <Section title="Your indexes">
        {!p?.created.length ? (
          <EmptyState
            title="You have not created an index."
            action={
              <LinkButton href="/create" variant="outline" size="sm">
                Create index
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Index</TableHead>
                <TableHead className="text-right">AUM</TableHead>
                <TableHead className="text-right">Unclaimed fees</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.created.map((c) => (
                <TableRow key={c.pubkey}>
                  <TableCell>
                    <Link href={`/i/${c.pubkey}/manage`} className="hover:underline">
                      {c.name} <span className="num text-xs text-muted-foreground">{c.symbol}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Usd value={c.navUsd} compact />
                  </TableCell>
                  <TableCell className="num text-right">
                    {num(c.owedCreatorShares)} · <Usd value={c.owedCreatorUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void claim(c.pubkey, vault.FeeKind.Creator)}
                      data-testid={`claim-creator-${c.symbol}`}
                    >
                      Claim
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      {p?.parentRoyalties.length ? (
        <Section title="Clone royalties">
          <ul className="divide-y rounded-lg border text-sm">
            {p.parentRoyalties.map((r) => (
              <li key={r.index} className="flex items-center justify-between px-3 py-2">
                <Link href={`/i/${r.index}`} className="num hover:underline">
                  {r.symbol}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="num text-muted-foreground">
                    {num(r.owedShares)} · <Usd value={r.owedUsd} />
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void claim(r.index, vault.FeeKind.Parent, r.parent)}
                    data-testid={`claim-royalty-${r.symbol}`}
                  >
                    Claim
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
