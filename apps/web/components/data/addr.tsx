"use client";
import { cn } from "cn";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { short } from "@/lib/format";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Wallet/user reference: handle if known, otherwise a shortened address. */
export function UserLink({
  wallet,
  handle,
  isAgent,
  className,
}: {
  wallet: string;
  handle?: string | null;
  isAgent?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/u/${wallet}`}
      className={cn("inline-flex items-center gap-1 hover:underline", className)}
    >
      <span className={handle ? "" : "num"}>{handle ? `@${handle}` : short(wallet)}</span>
      {isAgent ? (
        <span className="rounded border px-1 text-[10px] leading-4 text-muted-foreground">AI</span>
      ) : null}
    </Link>
  );
}

export function Addr({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="num text-xs">{short(value, 6)}</span>
      <CopyButton text={value} label="Copy address" />
    </span>
  );
}
