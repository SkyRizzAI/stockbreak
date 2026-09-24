"use client";
/**
 * Dark green is the default (refs/Stocklana.html). A manual choice of the light
 * variant is stored and applied as `.light` on <html>; no inline <script>.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const KEY = "stocklana:theme";

function apply(t: "light" | "dark") {
  const el = document.documentElement;
  el.classList.toggle("light", t === "light");
  el.classList.remove("dark");
}

function read(): "light" | "dark" {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => mo.disconnect();
}

/** Apply the stored preference once on mount (mounted in Providers). */
export function useThemeInit() {
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "light") apply("light");
    } catch {
      // storage unavailable
    }
  }, []);
}

export function useTheme() {
  const resolvedTheme = useSyncExternalStore(subscribe, read, () => "dark" as const);
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
