"use client";
import Link from "next/link";
import { Delta, Price, toneOf, Usd } from "@/components/data/num";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { num } from "@/lib/format";
import type { PositionRow } from "@/lib/types";

export function PositionsTable({ rows }: { rows: PositionRow[] }) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Index</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead className="text-right">7d</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.index} data-testid="position-row">
                <TableCell>
                  <Link href={`/i/${p.index}`} className="hover:underline">
                    {p.name} <span className="mono text-xs text-muted-foreground">{p.symbol}</span>
                  </Link>
                </TableCell>
                <TableCell className="num text-right">{num(p.shares)}</TableCell>
                <TableCell className="text-right">
                  <Price value={p.sharePrice} />
                </TableCell>
                <TableCell className="text-right">
                  <Usd value={p.valueUsd} />
                </TableCell>
                <TableCell className="text-right">
                  <span className={`num ${toneOf(p.pnlUsd, 0.005)}`}>
                    {p.pnlUsd >= 0 ? "+" : "−"}
                    <Usd value={Math.abs(p.pnlUsd)} />
                  </span>{" "}
                  <Delta value={p.pnlPct} className="text-xs" />
                </TableCell>
                <TableCell className="text-right">
                  <Delta value={p.ret7d} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y rounded-2xl border md:hidden">
        {rows.map((p) => (
          <li key={p.index}>
            <Link href={`/i/${p.index}`} className="flex items-center justify-between px-3 py-3">
              <span className="flex flex-col">
                <span className="text-sm">{p.name}</span>
                <span className="num text-xs text-muted-foreground">{num(p.shares)} shares</span>
              </span>
              <span className="flex flex-col items-end">
                <Usd value={p.valueUsd} className="text-sm" />
                <Delta value={p.pnlPct} className="text-xs" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
