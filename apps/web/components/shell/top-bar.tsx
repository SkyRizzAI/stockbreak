import Link from "next/link";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";
import { CommandPalette } from "./command-palette";
import { DesktopNav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-[19px] font-bold tracking-tight">
      {/* The logo is one of the three places mint is allowed. */}
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
        <rect width="30" height="30" rx="8" className="fill-primary" />
        <rect x="8" y="16" width="3.5" height="6" rx="1" className="fill-primary-foreground" />
        <rect
          x="13.25"
          y="11.5"
          width="3.5"
          height="10.5"
          rx="1"
          className="fill-primary-foreground"
        />
        <rect x="18.5" y="8" width="3.5" height="14" rx="1" className="fill-primary-foreground" />
      </svg>
      <span>{APP_NAME}</span>
    </Link>
  );
}

export function TopBar() {
  return (
    <header className="glass-bar sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-6 px-4 md:h-[72px] md:px-8">
        <Logo />
        <DesktopNav />
        <div className="ml-auto flex items-center gap-2">
          <span
            className="hidden h-7 items-center rounded-sm border px-2.5 text-[13px] text-muted-foreground sm:inline-flex"
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
