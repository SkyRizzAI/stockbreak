"use client";
/** Picks the App UI the visitor chose (D053): dashboard (default) or navbar. */
import type { ReactNode } from "react";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";
import { type AppLayout, LayoutProvider, useAppLayout } from "@/lib/ui-prefs";
import { DashboardShell } from "./dashboard-shell";
import { LayoutPrompt } from "./layout-prompt";
import { MobileNav } from "./nav";
import { TopBar } from "./top-bar";

function NavbarShell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <main className="flex-1 pb-20 md:pb-10">{children}</main>
      <footer className="hidden border-t py-4 text-xs text-muted-foreground md:block">
        <div className="mx-auto flex max-w-[1440px] items-center gap-2 px-4 md:px-14">
          <span
            className="inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px]"
            data-testid="cluster-badge"
          >
            {CLUSTER_LABEL}
          </span>
          <span>
            {APP_NAME} · Assets, prices and history are simulated on localnet/devnet. Not investment
            advice.
          </span>
        </div>
      </footer>
      <MobileNav />
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { layout } = useAppLayout();
  return (
    <div data-app-layout={layout} className="contents">
      {layout === "navbar" ? (
        <NavbarShell>{children}</NavbarShell>
      ) : (
        <DashboardShell>{children}</DashboardShell>
      )}
      <LayoutPrompt />
    </div>
  );
}

export function AppShell({ initial, children }: { initial: AppLayout; children: ReactNode }) {
  return (
    <LayoutProvider initial={initial}>
      <Shell>{children}</Shell>
    </LayoutProvider>
  );
}
