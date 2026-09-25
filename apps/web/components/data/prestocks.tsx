"use client";
import { PRESTOCKS_URL, SPACEX_SWAP_DEADLINE } from "@repo/config";
import { cn } from "cn";
import { TickerMono } from "@/components/data/glyph";
import { Price, Usd } from "@/components/data/num";
import { Section, Tag } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePrestocks } from "@/lib/api";
import { pct } from "@/lib/format";

const TAG_CLASS =
  "inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] text-muted-foreground";

/**
 * Small issuer tag for pre-IPO assets. Links to prestocks.com unless rendered inside
 * another interactive element (`link={false}`), where a nested anchor is invalid.
 */
export function PrestocksTag({
  link = true,
  href = PRESTOCKS_URL,
  className,
}: {
  link?: boolean;
  href?: string;
  className?: string;
}) {
  if (!link) return <Tag className={className}>PreStocks</Tag>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Pre-IPO token issued by PreStocks (prestocks.com)"
      className={cn(TAG_CLASS, "hover:text-foreground", className)}
      data-testid="prestocks-tag"
    >
      PreStocks
    </a>
  );
}

const DEADLINE = new Date(SPACEX_SWAP_DEADLINE).toLocaleString("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** How the real PreStocks IPO conversion works and what the vault does instead. */
export function IpoMigrationNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      At IPO, a PreStocks token converts into the listed tokenized stock (SpaceX → SPCXx). Direct
      holders must swap before the deadline (SpaceX: {DEADLINE} UTC) or the tokens expire. This
      index migrates its holdings automatically, so holders never miss it.
    </p>
  );
}

/**
 * Live PreStocks reference data for the pre-IPO assets an index holds: mark price,
 * implied valuation and the token's premium/discount to mark. Read-only mainnet data.
 */
export function PrestocksPanel({ symbols }: { symbols: string[] }) {
  const q = usePrestocks();
  if (!symbols.length) return null;
  const rows = (q.data?.rows ?? []).filter((r) => symbols.includes(r.symbol));
  const at = q.data?.fetchedAt ? new Date(q.data.fetchedAt) : null;
  // The server keeps serving the last good response while PreStocks is down: say how old it is.
  const stale = !!at && Date.now() - at.getTime() > 10 * 60_000;
  const time = at
    ? at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  return (
    <Section
      title="Pre-IPO · PreStocks"
      action={
        <span
          className={cn("text-xs whitespace-nowrap", stale ? "text-warn" : "text-muted-foreground")}
        >
          {stale ? `Stale · as of ${time}` : time ? `Read-only · ${time}` : "Read-only"}
        </span>
      }
    >
      <div data-testid="prestocks-panel" className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : q.isError || (q.data && !q.data.available) ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              PreStocks cannot be reached right now. The oracle keeps its last price.
            </p>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              Retry
            </Button>
          </div>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">
            PreStocks no longer lists {symbols.join(", ")} (for example after its IPO conversion).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Token</TableHead>
                <TableHead className="text-right">Mark</TableHead>
                <TableHead className="text-right">Premium</TableHead>
                <TableHead className="text-right">Implied val.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <TickerMono symbol={r.symbol} size={22} />
                      <span className="mono text-sm">{r.symbol}</span>
                      <PrestocksTag href={r.url} className="hidden sm:inline-flex" />
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Price value={r.tokenPrice} />
                  </TableCell>
                  <TableCell className="text-right">
                    {r.markPrice === null ? "—" : <Price value={r.markPrice} />}
                  </TableCell>
                  <TableCell
                    className="num text-right"
                    title={
                      r.premium === null
                        ? undefined
                        : r.premium >= 0
                          ? "Token trades above mark"
                          : "Token trades below mark"
                    }
                  >
                    {r.premium === null ? "—" : pct(r.premium, 1)}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.impliedValuation === null ? "—" : <Usd value={r.impliedValuation} compact />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          Token = PreStocks on-chain price (the simulated oracle follows it when live prices are
          on). Mark = PreStocks reference price. Premium = token ÷ mark − 1. Index holdings are
          simulated. Source:{" "}
          <a
            href={PRESTOCKS_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            prestocks.com
          </a>
          .
        </p>
        <IpoMigrationNote />
      </div>
    </Section>
  );
}
