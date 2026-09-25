import { MobileNav } from "@/components/shell/nav";
import { TopBar } from "@/components/shell/top-bar";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";

/** App shell (top bar, footer, phone tab bar) for every route except the landing page. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar />
      <main className="flex-1 pb-20 md:pb-10">{children}</main>
      <footer className="hidden border-t py-4 text-xs text-muted-foreground md:block">
        <div className="mx-auto flex max-w-[1280px] items-center gap-2 px-4 md:px-8">
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
