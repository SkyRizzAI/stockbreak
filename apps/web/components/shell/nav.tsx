"use client";
import { cn } from "cn";
import { Compass, Home, LineChart, MessagesSquare, Plus, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/feed", label: "Feed", icon: MessagesSquare },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/portfolio", label: "Portfolio", icon: LineChart },
];

export function DesktopNav() {
  const path = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn(
            "rounded-lg px-3 py-2 text-[15px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            path.startsWith(n.href) && "bg-raised font-semibold text-foreground",
          )}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  // Five slots on phones: Leaderboard stays reachable from Home and the Feed.
  const items = [
    { href: "/", label: "Home", icon: Home },
    ...NAV.filter((n) => n.href !== "/leaderboard"),
  ];
  return (
    <nav
      aria-label="Main"
      className="glass-bar fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((n) => {
        const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
              active && "text-foreground",
            )}
          >
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
