import { cn } from "cn";
import { price as fmtPrice, pct, usd } from "@/lib/format";

export function Usd({
  value,
  compact,
  className,
  digits,
}: {
  value: number;
  compact?: boolean;
  className?: string;
  digits?: number;
}) {
  return <span className={cn("num", className)}>{usd(value, { compact, digits })}</span>;
}

export function Price({ value, className }: { value: number; className?: string }) {
  return <span className={cn("num", className)}>{fmtPrice(value)}</span>;
}

/** Signed percent, green up / red down (meaning-only color). */
/** Up/down/neutral color; values that round to zero at `eps` are neutral. */
export function toneOf(v: number | null | undefined, eps: number): string {
  if (v === null || v === undefined || Math.abs(v) < eps) return "text-muted-foreground";
  return v > 0 ? "text-up" : "text-down";
}

export function Delta({
  value,
  className,
  digits = 2,
}: {
  value: number | null | undefined;
  className?: string;
  digits?: number;
}) {
  const v = value ?? null;
  // Neutral when the value rounds to zero at the shown precision.
  const tone = toneOf(v, 0.5 * 10 ** -(digits + 2));
  return <span className={cn("num", tone, className)}>{pct(v, digits)}</span>;
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num", className)}>{children}</span>;
}

/** Value with a small, dimmed unit. */
export function WithUnit({
  value,
  unit,
  className,
}: {
  value: React.ReactNode;
  unit: string;
  className?: string;
}) {
  return (
    <span className={cn("num", className)}>
      {value}
      <span className="ml-1 text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}
