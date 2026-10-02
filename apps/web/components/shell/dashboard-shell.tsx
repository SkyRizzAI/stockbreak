"use client";
/**
 * Dashboard layout (App UI "dashboard", the default; D053): shadcn Sidebar (inset variant)
 * with search, the main menu, the visitor's watchlist and a faucet hint; the page sits in a
 * rounded panel with a breadcrumb bar. On phones the sidebar becomes a sheet.
 */
import { cn } from "cn";
import {
  Bot,
  Briefcase,
  Compass,
  LayoutDashboard,
  MessagesSquare,
  Plus,
  Rocket,
  Settings,
  Trophy,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useIndexes, usePortfolio } from "@/lib/api";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";
import { useWallet } from "@/lib/wallet";
import { CommandPalette } from "./command-palette";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { ClusterButton } from "./top-bar";
import { WalletButton } from "./wallet-button";

export const DASH_NAV = [
  { href: "/home", label: "Dashboard", icon: LayoutDashboard },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/feed", label: "Feed", icon: MessagesSquare },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/agents", label: "AI agents", icon: Bot },
  { href: "/create", label: "Create index", icon: Plus },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Page title for the breadcrumb ("Dashboard / Markets"). */
function crumb(path: string): { parent?: { href: string; label: string }; label: string } {
  if (path.startsWith("/i/"))
    return {
      parent: { href: "/explore", label: "Explore" },
      label: path.endsWith("/manage") ? "Manage" : "Index",
    };
  if (path.startsWith("/u/"))
    return { parent: { href: "/leaderboard", label: "Leaderboard" }, label: "Profile" };
  const labels: Record<string, string> = {
    "/home": "Markets",
    "/explore": "Explore",
    "/feed": "Feed",
    "/leaderboard": "Leaderboard",
    "/agents": "AI",
    "/create": "Create index",
    "/portfolio": "Portfolio",
    "/settings": "Settings",
    "/faucet": "Faucet",
    "/sign": "Sign request",
  };
  const key = Object.keys(labels).find((k) => path.startsWith(k));
  return { label: key ? (labels[key] as string) : APP_NAME };
}

const TILE = ["bg-mark-1", "bg-mark-2", "bg-mark-3", "bg-mark-4"];

/** The wallet's positions, or the top indexes before a wallet is connected. */
function Watchlist() {
  const w = useWallet();
  const pf = usePortfolio(w.address);
  const top = useIndexes("limit=4");
  const own = (pf.data?.positions ?? []).slice(0, 5).map((p) => ({
    href: `/i/${p.index}`,
    symbol: p.symbol,
    price: p.sharePrice,
    ret: p.ret7d,
  }));
  const rows = own.length
    ? own
    : (top.data?.items ?? []).slice(0, 4).map((i) => ({
        href: `/i/${i.pubkey}`,
        symbol: i.symbol,
        price: i.sharePrice,
        ret: i.ret7d,
      }));
  if (!rows.length) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[11px] tracking-[0.12em] uppercase">
        {own.length ? "My watchlist" : "Top indexes"}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {rows.map((r, i) => (
            <SidebarMenuItem key={r.href}>
              <SidebarMenuButton
                render={<Link href={r.href} />}
                className="h-11 gap-3 text-[15px] text-foreground"
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold text-[#0b0b0d]",
                    TILE[i % TILE.length],
                  )}
                  aria-hidden
                >
                  {r.symbol.charAt(0)}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.symbol}</span>
                <span className="mono text-xs text-muted-foreground">{r.price.toFixed(4)}</span>
                {r.ret === null ? null : (
                  <span className={cn("mono text-xs", r.ret >= 0 ? "text-up" : "text-down")}>
                    {r.ret >= 0 ? "+" : ""}
                    {(r.ret * 100).toFixed(2)}%
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

const FAUCET_CARD_KEY = "stocklana:faucet-card-hidden";

/** Dismissible hint to grab test funds (refs: "Get devnet USDC"). */
function FaucetCard() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(FAUCET_CARD_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  return (
    <div className="relative rounded-xl border bg-surface p-4">
      <button
        type="button"
        aria-label="Hide"
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(FAUCET_CARD_KEY, "1");
          } catch {
            // ignore
          }
        }}
      >
        <X className="size-4" />
      </button>
      <span className="btn-tactile mb-3 inline-flex size-9 items-center justify-center rounded-[9px] border">
        <Rocket className="size-4" />
      </span>
      <Link href="/faucet" className="block text-[15px] font-semibold hover:underline">
        Get {CLUSTER_LABEL.toLowerCase()} USDC ↗
      </Link>
      <span className="text-xs text-muted-foreground">Fund your wallet at /faucet</span>
    </div>
  );
}

function AppSidebar() {
  const path = usePathname();
  return (
    <Sidebar variant="inset" className="border-r-0">
      <SidebarHeader className="gap-5 px-3 pt-4">
        <Logo />
        <CommandPalette variant="sidebar" />
      </SidebarHeader>
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {DASH_NAV.map((n) => {
                const active = path.startsWith(n.href);
                return (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton
                      render={<Link href={n.href} />}
                      isActive={active}
                      className={cn(
                        "h-[42px] gap-3.5 rounded-[10px] border border-transparent px-3.5 text-[14.5px]",
                        active && "nav-active text-foreground",
                      )}
                    >
                      <n.icon className="size-4" />
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <Watchlist />
      </SidebarContent>
      <SidebarFooter className="px-3 pb-4">
        <FaucetCard />
      </SidebarFooter>
    </Sidebar>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const c = crumb(path);
  return (
    <SidebarProvider className="bg-frame">
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-panel md:rounded-[14px] md:border">
        <header className="flex h-[70px] shrink-0 items-center gap-3 border-b px-4 md:px-8">
          <SidebarTrigger className="md:hidden" />
          <Breadcrumb>
            <BreadcrumbList className="text-[15px]">
              <BreadcrumbItem className="hidden sm:inline-flex">
                <BreadcrumbLink render={<Link href={c.parent?.href ?? "/home"} />}>
                  {c.parent?.label ?? "Dashboard"}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-medium">{c.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <ClusterButton />
            <WalletButton />
          </div>
        </header>
        <main className="flex-1 pb-10">{children}</main>
        <footer className="border-t px-4 py-4 text-xs text-muted-foreground md:px-8">
          <span
            className="mr-2 inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px]"
            data-testid="cluster-badge"
          >
            {CLUSTER_LABEL}
          </span>
          {APP_NAME} · Assets, prices and history are simulated on localnet/devnet. Not investment
          advice.
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
