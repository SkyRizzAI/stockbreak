"use client";
/**
 * First visit: a small card in the corner asks which App UI to use (D053). Closing it keeps
 * the default (dashboard). Shown once; the choice can be changed later in Settings.
 */
import { cn } from "cn";
import { PanelLeft, PanelTop, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type AppLayout, layoutAsked, markLayoutAsked, useAppLayout } from "@/lib/ui-prefs";

const OPTIONS: { value: AppLayout; label: string; hint: string; icon: typeof PanelLeft }[] = [
  { value: "dashboard", label: "Dashboard", hint: "Menu in a sidebar", icon: PanelLeft },
  { value: "navbar", label: "Navbar", hint: "Menu along the top", icon: PanelTop },
];

export function LayoutPrompt() {
  const { layout, setLayout } = useAppLayout();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Automated browsers (tests, demo recordings) get the default without the prompt,
    // unless a test asks for it with `?layout-prompt`.
    const forced = new URLSearchParams(window.location.search).has("layout-prompt");
    setOpen(!layoutAsked() && (forced || !navigator.webdriver));
  }, []);
  if (!open) return null;
  const close = () => {
    markLayoutAsked();
    setOpen(false);
  };
  return (
    <div
      role="dialog"
      aria-labelledby="layout-prompt-title"
      className="fixed right-4 bottom-20 z-50 w-[300px] rounded-xl border bg-popover p-4 shadow-xl animate-in fade-in slide-in-from-bottom-2 md:bottom-4"
      data-testid="layout-prompt"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        data-testid="layout-prompt-close"
      >
        <X className="size-4" />
      </button>
      <p id="layout-prompt-title" className="pr-6 text-sm font-semibold">
        Choose your layout
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        You can change it any time in Settings.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              setLayout(o.value);
              setOpen(false);
            }}
            className={cn(
              "flex flex-col items-start gap-1 rounded-[10px] border p-3 text-left transition-colors hover:bg-raised",
              layout === o.value && "nav-active",
            )}
            data-testid={`layout-choose-${o.value}`}
          >
            <o.icon className="size-4" />
            <span className="text-sm font-medium">{o.label}</span>
            <span className="text-[11px] text-muted-foreground">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
