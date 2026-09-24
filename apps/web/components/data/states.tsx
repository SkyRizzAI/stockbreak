"use client";
import { cn } from "cn";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function RowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
      <p>{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border px-4 py-6 text-sm"
    >
      <p className="text-down">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function SimulatedBadge({
  className,
  label = "Simulated",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded border px-1.5 text-[11px] text-muted-foreground",
        className,
      )}
      title="All assets and prices are simulated (localnet/devnet)."
    >
      {label}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded border px-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Key–value row list (settings-style, value right-aligned). */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y rounded-lg border">
      {rows.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static rows
        <div key={i} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A missing page/object: say what happened and offer the next step. */
export function NotFoundState({
  title,
  detail,
  href = "/explore",
  cta = "Explore indexes",
}: {
  title: string;
  detail: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border px-4 py-6">
      <h1 className="text-base font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <LinkButton href={href} variant="outline" size="sm" className="mt-2">
        {cta}
      </LinkButton>
    </div>
  );
}
