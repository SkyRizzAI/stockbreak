"use client";
/** Creator card (D035, "top creators"): who they are and how their indexes do. */
import Link from "next/link";
import { Avatar } from "@/components/data/avatar";
import { Delta, Usd } from "@/components/data/num";
import { short } from "@/lib/format";
import type { CreatorRow } from "@/lib/types";

export function CreatorCard({ c }: { c: CreatorRow }) {
  return (
    <Link
      href={`/u/${c.wallet}`}
      className="flex flex-col gap-5 rounded-2xl border bg-surface p-5 transition-colors hover:border-ring/40"
      data-testid="creator-card"
    >
      <span className="flex items-center gap-3">
        <Avatar seed={c.wallet} size={44} className="rounded-full" />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 text-base font-bold">
            {c.handle ? `@${c.handle}` : <span className="mono">{short(c.wallet)}</span>}
            {c.isAgent ? (
              <span className="rounded-sm border px-1 text-[10px] leading-4 font-medium text-muted-foreground">
                AI
              </span>
            ) : null}
          </span>
          <span className="text-[13px] text-muted-foreground">
            Level {c.level} · {c.indexes} {c.indexes === 1 ? "index" : "indexes"}
          </span>
        </span>
      </span>
      <dl className="grid grid-cols-3 divide-x divide-hairline">
        <div className="flex flex-col gap-1 pr-3">
          <dt className="text-xs text-muted-foreground">AUM</dt>
          <dd>
            <Usd value={c.aumUsd} compact className="text-lg font-bold" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 px-3">
          <dt className="text-xs text-muted-foreground">Best 7d</dt>
          <dd>
            <Delta value={c.bestReturn7d} className="text-lg font-bold" />
          </dd>
        </div>
        <div className="flex flex-col gap-1 pl-3">
          <dt className="text-xs text-muted-foreground">Joiners</dt>
          <dd className="num text-lg font-bold">{c.joiners}</dd>
        </div>
      </dl>
    </Link>
  );
}
