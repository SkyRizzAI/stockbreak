import Link from "next/link";
import { CLUSTER_LABEL } from "@/lib/env";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { DesktopNav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

/** Network badge (tactile, like the refs); links to the faucet for test funds. */
export function ClusterButton() {
  return (
    <Link
      href="/faucet"
      title={`${CLUSTER_LABEL}: simulated assets. Get test funds.`}
      className="btn-tactile hidden h-[38px] items-center rounded-[9px] border px-3.5 text-[13px] font-medium sm:inline-flex"
    >
      {CLUSTER_LABEL}
    </Link>
  );
}

/** Navbar layout: every menu item in the top bar (App UI "navbar", D053). */
export function TopBar() {
  return (
    <header className="glass-bar sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-8 px-4 md:h-[75px] md:px-10 xl:px-14">
        <Logo />
        <DesktopNav />
        <div className="ml-auto flex items-center gap-2.5">
          <CommandPalette />
          <ThemeToggle />
          <ClusterButton />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
