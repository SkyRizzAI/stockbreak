"use client";
/** Settings (D053): App UI layout (dashboard / navbar) and theme (system / light / dark). */
import { cn } from "cn";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type ThemeChoice, useTheme } from "@/lib/theme";
import { type AppLayout, useAppLayout } from "@/lib/ui-prefs";

/** Tiny wireframe of each layout so the choice is obvious at a glance. */
function Preview({ layout }: { layout: AppLayout }) {
  return (
    <div className="flex h-24 w-full overflow-hidden rounded-[8px] border bg-frame" aria-hidden>
      {layout === "dashboard" ? (
        <>
          <div className="flex w-1/4 flex-col gap-1.5 p-2">
            <span className="h-2 w-3/4 rounded-sm bg-foreground/70" />
            <span className="h-1.5 w-full rounded-sm bg-muted-foreground/30" />
            <span className="h-1.5 w-5/6 rounded-sm bg-muted-foreground/30" />
            <span className="h-1.5 w-4/6 rounded-sm bg-muted-foreground/30" />
          </div>
          <div className="m-1.5 ml-0 flex flex-1 flex-col gap-1.5 rounded-[6px] border bg-panel p-2">
            <span className="h-1.5 w-1/3 rounded-sm bg-muted-foreground/40" />
            <span className="h-full rounded-sm bg-surface" />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b p-2">
            <span className="h-2 w-8 rounded-sm bg-foreground/70" />
            <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/30" />
            <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/30" />
            <span className="h-1.5 w-6 rounded-sm bg-muted-foreground/30" />
          </div>
          <div className="flex-1 p-2">
            <span className="block h-full rounded-sm bg-surface" />
          </div>
        </div>
      )}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border bg-surface p-4 text-left transition-colors hover:bg-raised",
        active && "border-foreground/40 ring-2 ring-foreground/10",
      )}
    >
      {active ? (
        <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      ) : null}
      {children}
    </button>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function SettingsView() {
  const { layout, setLayout } = useAppLayout();
  const { theme, setTheme } = useTheme();
  // The stored theme is only known after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 px-4 py-8 md:px-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Stored in this browser.</p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">App UI</h2>
          <p className="text-sm text-muted-foreground">Where the main menu lives.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["dashboard", "Dashboard", "Menu, watchlist and search in a sidebar. Default."],
              ["navbar", "Navbar", "Every menu item along the top bar."],
            ] as const
          ).map(([value, label, hint]) => (
            <Choice
              key={value}
              active={layout === value}
              onClick={() => setLayout(value)}
              testId={`layout-${value}`}
            >
              <Preview layout={value} />
              <span className="flex flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </span>
            </Choice>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Theme</h2>
          <p className="text-sm text-muted-foreground">System follows your device.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <Choice
              key={t.value}
              active={mounted && theme === t.value}
              onClick={() => setTheme(t.value)}
              testId={`theme-${t.value}`}
            >
              <t.icon className="size-5" />
              <span className="font-medium">{t.label}</span>
            </Choice>
          ))}
        </div>
      </section>
    </div>
  );
}
