import { cn } from "cn";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/link-button";

export const GITHUB_URL = "https://github.com/viandwi24/stocklana";
export const APP_HREF = "/home";

/** Page gutter: 16px on phones, 80px at 1440. */
export const WRAP = "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-20";
export const H2 = "text-[32px] leading-[1.05] font-extrabold tracking-[-0.04em] md:text-[44px]";
export const EYEBROW = "text-sm font-semibold text-muted-foreground";
export const LEAD = "text-base leading-[1.65] text-muted-foreground";
/** Stripe order matches the index mark (§8.3). */
export const MARK_BG = ["bg-mark-1", "bg-mark-2", "bg-mark-3", "bg-mark-4"] as const;

/** The logo mark: three rising bars on mint. Bars bounce on hover (or always with `live`). */
export function LogoMark({ size = 28, live = false }: { size?: number; live?: boolean }) {
  const bar = size / 9.3;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-end justify-center rounded-[8px] bg-primary",
        live ? "lp-eq" : "lp-eq-hover",
      )}
      style={{ width: size, height: size, gap: bar, paddingBottom: size / 4 }}
    >
      {[5, 9, 13].map((h, i) => (
        <span
          key={h}
          className="rounded-[1px] bg-primary-foreground"
          style={
            {
              width: bar,
              height: (h / 28) * size,
              "--i": i,
              "--s": [1.6, 0.55, 0.75][i],
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

export function PrimaryCta({
  href = APP_HREF,
  children = "Launch app",
  size = "lg",
  className,
}: {
  href?: string;
  children?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <LinkButton
      href={href}
      size="lg"
      className={cn(
        "lp-shine font-bold",
        size === "lg" ? "h-[52px] px-7 text-base" : "h-[38px] px-[18px] text-sm",
        className,
      )}
    >
      {children}
      {size === "lg" ? <ArrowRight className="lp-arrow size-4" aria-hidden /> : null}
    </LinkButton>
  );
}

/** Underlined text link with a sweeping rule and a nudging arrow. */
export function TextLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const external = href.startsWith("http");
  const cls = cn(
    "inline-flex items-center gap-1.5 self-start text-[15px] font-bold transition-colors hover:text-foreground",
    className,
  );
  const inner = (
    <>
      <span className="lp-link">{children}</span>
      <ArrowRight className="lp-arrow size-3.5 text-muted-foreground" aria-hidden />
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[6px] border px-[7px] py-px text-xs whitespace-nowrap text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Four-stripe allocation bar in the mark greens. */
export function AllocBar({
  weights,
  className,
  grow = false,
  now = false,
  delay = 0,
}: {
  weights: number[];
  className?: string;
  /** Grow each stripe from the left when the enclosing block is revealed. */
  grow?: boolean;
  /** Grow on mount instead of on reveal. */
  now?: boolean;
  delay?: number;
}) {
  return (
    <span className={cn("flex h-2.5 gap-0.5", className)}>
      {weights.map((w, i) => (
        <span
          key={MARK_BG[i % 4]}
          className={cn(
            "rounded-[2px] transition-[width] duration-700 lp-ease",
            MARK_BG[i % 4],
            grow && (now ? "lp-grow-x-now" : "lp-grow-x"),
          )}
          style={{ width: `${w}%`, "--i": i, "--d": `${delay}ms` } as React.CSSProperties}
        />
      ))}
    </span>
  );
}

/** Small stacked index mark (the design's 4-stripe tile). */
export function MarkTile({ size = 48 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 flex-col gap-0.5 rounded-[8px] bg-raised"
      style={{ width: size, height: size, padding: size / 12 }}
    >
      {[4, 3, 2, 1].map((g, i) => (
        <span key={g} className={cn("rounded-[2px]", MARK_BG[i])} style={{ flexGrow: g }} />
      ))}
    </span>
  );
}

export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("mono", className)}>{children}</span>
);
