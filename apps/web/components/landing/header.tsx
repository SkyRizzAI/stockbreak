"use client";
import { cn } from "cn";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { APP_NAME, CLUSTER_LABEL } from "@/lib/env";
import { GITHUB_URL, LogoMark, PrimaryCta } from "./ui";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "pre-ipo", label: "Pre-IPO" },
  { id: "agents", label: "AI agents" },
  { id: "creators", label: "Creators" },
  { id: "faq", label: "FAQ" },
];

/** Section currently under the middle of the viewport. */
function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id;
          if (e.isIntersecting) setActive(id);
          else setActive((cur) => (cur === id ? null : cur));
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [ids]);
  return active;
}

const IDS = LINKS.map((l) => l.id);

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const bar = useRef<HTMLSpanElement>(null);
  const active = useScrollSpy(IDS);
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [open, setOpen] = useState(false);

  // Scrolled state + reading progress, one rAF per frame at most.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      setScrolled(y > 8);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  // Slide the underline to the active link.
  useLayoutEffect(() => {
    const el = active ? nav.current?.querySelector<HTMLElement>(`[data-id="${active}"]`) : null;
    setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
  }, [active]);

  return (
    <header
      className={cn(
        "lp-enter sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300",
        scrolled ? "glass-bar border-border" : "border-transparent bg-transparent",
      )}
      style={{ "--d": "0ms" } as React.CSSProperties}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-4 sm:px-8 lg:px-20">
        <div className="flex items-center gap-11">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.02em]"
          >
            <LogoMark />
            {APP_NAME}
          </Link>
          <nav
            ref={nav}
            aria-label="Primary"
            className="relative hidden gap-7 text-sm font-semibold lg:flex"
          >
            {LINKS.map((l) => (
              <a
                key={l.id}
                data-id={l.id}
                href={`#${l.id}`}
                className={cn(
                  "py-1 transition-colors hover:text-foreground",
                  active === l.id ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {l.label}
              </a>
            ))}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <span
              aria-hidden
              className="absolute -bottom-[13px] left-0 h-0.5 rounded-full bg-primary transition-all duration-500 lp-ease"
              style={{
                transform: `translateX(${pill?.x ?? 0}px)`,
                width: pill?.w ?? 0,
                opacity: pill ? 1 : 0,
              }}
            />
          </nav>
        </div>
        <div className="flex items-center gap-3.5">
          <span className="hidden rounded-[6px] border px-2 py-[3px] text-xs font-semibold text-muted-foreground sm:inline">
            {CLUSTER_LABEL}
          </span>
          <PrimaryCta size="md" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="inline-flex size-9 items-center justify-center rounded-lg border text-muted-foreground hover:text-foreground lg:hidden"
            >
              <Menu className="size-4" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-6">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <nav
                aria-label="Sections"
                className="mt-8 flex flex-col gap-1 text-base font-semibold"
              >
                {LINKS.map((l) => (
                  <a
                    key={l.id}
                    href={`#${l.id}`}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2.5 text-muted-foreground hover:bg-raised hover:text-foreground"
                  >
                    {l.label}
                  </a>
                ))}
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-3 py-2.5 text-muted-foreground hover:bg-raised hover:text-foreground"
                >
                  GitHub
                </a>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <span
        ref={bar}
        aria-hidden
        className="absolute inset-x-0 -bottom-px h-px origin-left bg-primary/70"
        style={{ transform: "scaleX(0)" }}
      />
    </header>
  );
}
