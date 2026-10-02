"use client";
/**
 * App UI layout preference (D053): "dashboard" (sidebar, default) or "navbar" (menu on top).
 * Stored in a cookie so the server renders the chosen shell on the first paint (no flash),
 * mirrored in localStorage. `stocklana:layout-asked` remembers that the first-visit prompt
 * was answered or dismissed.
 */
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { type AppLayout, LAYOUT_COOKIE } from "./layout-pref";

export type { AppLayout } from "./layout-pref";

const LAYOUT_KEY = "stocklana:layout";
const ASKED_KEY = "stocklana:layout-asked";
const YEAR = 365 * 24 * 3600;

function persist(l: AppLayout) {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain first-party preference cookie
  document.cookie = `${LAYOUT_COOKIE}=${l}; path=/; max-age=${YEAR}; samesite=lax`;
  try {
    localStorage.setItem(LAYOUT_KEY, l);
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // storage unavailable: the cookie still carries the choice
  }
}

/** True once the visitor picked a layout or closed the first-visit prompt. */
export function layoutAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1" || document.cookie.includes(`${LAYOUT_COOKIE}=`);
  } catch {
    return true;
  }
}

export function markLayoutAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // ignore
  }
}

const Ctx = createContext<{ layout: AppLayout; setLayout: (l: AppLayout) => void }>({
  layout: "dashboard",
  setLayout: () => {},
});

export function LayoutProvider({ initial, children }: { initial: AppLayout; children: ReactNode }) {
  const [layout, set] = useState<AppLayout>(initial);
  const setLayout = useCallback((l: AppLayout) => {
    persist(l);
    set(l);
  }, []);
  return <Ctx.Provider value={{ layout, setLayout }}>{children}</Ctx.Provider>;
}

export const useAppLayout = () => useContext(Ctx);
