"use client";
/**
 * Light/dark theme without any <script>: the default follows the system via CSS
 * (prefers-color-scheme); a manual choice is stored and applied as `.light`/`.dark`.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const KEY = "stocklana:theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function apply(t: "light" | "dark" | null) {
  const el = document.documentElement;
  el.classList.toggle("dark", t === "dark");
  el.classList.toggle("light", t === "light");
}

function read(): "light" | "dark" {
  const el = document.documentElement;
  if (el.classList.contains("dark")) return "dark";
  if (el.classList.contains("light")) return "light";
  return media().matches ? "dark" : "light";
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const mq = media();
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

/** Apply the stored preference once on mount (mounted in Providers). */
export function useThemeInit() {
  useEffect(() => {
    try {
      const t = localStorage.getItem(KEY);
      if (t === "light" || t === "dark") apply(t);
    } catch {
      // storage unavailable
    }
  }, []);
}

export function useTheme() {
  const resolvedTheme = useSyncExternalStore(subscribe, read, () => "light" as const);
  const setTheme = useCallback((t: "light" | "dark") => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // storage unavailable
    }
    apply(t);
  }, []);
  return { resolvedTheme, theme: resolvedTheme, setTheme };
}
