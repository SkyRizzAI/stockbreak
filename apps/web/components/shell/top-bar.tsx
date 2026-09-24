import Link from "next/link";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";
import { CommandPalette } from "./command-palette";
import { DesktopNav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="text-foreground">
        <rect
          x="1"
          y="1"
          width="20"
          height="20"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <rect x="5" y="12" width="3" height="5" fill="currentColor" />
        <rect x="9.5" y="8" width="3" height="9" fill="currentColor" />
        <rect x="14" y="5" width="3" height="12" fill="currentColor" />
      </svg>
      <span>{APP_NAME}</span>
    </Link>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-4 px-4">
        <Logo />
        <DesktopNav />
        <div className="ml-auto flex items-center gap-2">
          <span
            className="hidden h-6 items-center rounded-md border px-2 text-xs text-muted-foreground sm:inline-flex"
            data-testid="cluster-badge"
          >
            {CLUSTER_LABEL}
          </span>
          <CommandPalette />
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
