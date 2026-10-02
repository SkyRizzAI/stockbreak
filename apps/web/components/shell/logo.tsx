import { cn } from "cn";
import Link from "next/link";
import { APP_NAME } from "@/lib/env";

/** Mark: a tactile dark tile with three bars (refs Editorial Minimalist). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "btn-tactile-primary dark:btn-tactile inline-flex size-[30px] items-center justify-center rounded-[8px] border",
        className,
      )}
      aria-hidden
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="currentColor"
        className="text-white"
        aria-hidden
      >
        <rect x="1.5" y="7" width="2.4" height="5.5" rx="0.8" />
        <rect x="5.8" y="4" width="2.4" height="8.5" rx="0.8" />
        <rect x="10.1" y="1.5" width="2.4" height="11" rx="0.8" />
      </svg>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/home"
      className={cn(
        "flex items-center gap-2.5 text-[21px] font-semibold tracking-[-0.03em]",
        className,
      )}
    >
      <LogoMark />
      <span>{APP_NAME}</span>
    </Link>
  );
}
