"use client";
import Link from "next/link";
import { UserLink } from "@/components/data/addr";
import { IndexGlyph } from "@/components/data/glyph";
import { Delta, Price, Usd } from "@/components/data/num";
import { Sparkline } from "@/components/data/sparkline";
import { Tag } from "@/components/data/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { IndexSummary } from "@/lib/types";

export function IndexTags({ i }: { i: IndexSummary }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {i.creatorIsAgent ? <Tag>AI</Tag> : null}
      {i.hasPreIpo ? <Tag>Pre-IPO</Tag> : null}
      {i.followsParent ? (
        <Tag>Follows {i.parentSymbol ?? "parent"}</Tag>
      ) : i.parent ? (
        <Tag>Clone</Tag>
      ) : null}
      {i.paused ? <Tag className="text-warn">Paused</Tag> : null}
    </span>
  );
}

type RetKey = "ret24h" | "ret7d" | "ret30d" | "retAll";

export function IndexTable({
  rows,
  retKey = "ret7d",
  retLabel = "7d",
  rank,
  compact,
}: {
  rows: IndexSummary[];
  retKey?: RetKey;
  retLabel?: string;
  rank?: boolean;
  compact?: boolean;
}) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {rank ? <TableHead className="w-10">#</TableHead> : null}
              <TableHead>Index</TableHead>
              {compact ? null : <TableHead>Creator</TableHead>}
              <TableHead className="text-right">Share price</TableHead>
              <TableHead className="text-right">{retLabel}</TableHead>
              <TableHead className="text-right">AUM</TableHead>
              {compact ? null : <TableHead className="text-right">Holders</TableHead>}
              {compact ? null : <TableHead className="w-28 text-right">30d</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i, n) => (
              <TableRow key={i.pubkey} className="h-14" data-testid="index-row">
                {rank ? <TableCell className="num text-muted-foreground">{n + 1}</TableCell> : null}
                <TableCell>
                  <Link href={`/i/${i.pubkey}`} className="flex items-center gap-3">
                    <IndexGlyph
                      pubkey={i.pubkey}
                      weights={i.assets.map((a) => a.targetWeightBps)}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="truncate">{i.name}</span>
                        <span className="num text-xs text-muted-foreground">{i.symbol}</span>
                      </span>
                      <IndexTags i={i} />
                    </span>
                  </Link>
                </TableCell>
                {compact ? null : (
                  <TableCell className="text-sm">
                    <UserLink
                      wallet={i.creator}
                      handle={i.creatorHandle}
                      isAgent={i.creatorIsAgent}
                    />
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Price value={i.sharePrice} />
                </TableCell>
                <TableCell className="text-right">
                  <Delta value={i[retKey]} />
                </TableCell>
                <TableCell className="text-right">
                  <Usd value={i.navUsd} compact />
                </TableCell>
                {compact ? null : <TableCell className="num text-right">{i.holders}</TableCell>}
                {compact ? null : (
                  <TableCell className="text-right">
                    <Sparkline data={i.spark} className="ml-auto" />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y rounded-lg border md:hidden">
        {rows.map((i, n) => (
          <li key={i.pubkey}>
            <Link
              href={`/i/${i.pubkey}`}
              className="flex min-h-16 items-center gap-3 px-3 py-2.5"
              data-testid="index-row-mobile"
            >
              {rank ? <span className="num w-5 text-xs text-muted-foreground">{n + 1}</span> : null}
              <IndexGlyph
                pubkey={i.pubkey}
                weights={i.assets.map((a) => a.targetWeightBps)}
                size={28}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{i.name}</span>
                <span className="num text-xs text-muted-foreground">
                  {i.symbol} · <Usd value={i.navUsd} compact className="text-muted-foreground" />
                </span>
              </span>
              <span className="flex flex-col items-end">
                <Price value={i.sharePrice} className="text-sm" />
                <Delta value={i[retKey]} className="text-xs" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
