"use client";
/**
 * Theme: System (default), Light or Dark via next-themes (D053). The class `.dark` on
 * <html> switches the tokens in globals.css; the choice is stored under the same key
 * as before, so an earlier "light" choice still applies.
 */
import { ThemeProvider as NextThemes, useTheme as useNextTheme } from "next-themes";
import type { ReactNode } from "react";

export const THEME_KEY = "stocklana:theme";
export type ThemeChoice = "system" | "light" | "dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}

export function useTheme() {
  const { theme, resolvedTheme, setTheme } = useNextTheme();
  return {
    theme: (theme ?? "system") as ThemeChoice,
    resolvedTheme: (resolvedTheme ?? "light") as "light" | "dark",
    setTheme: (t: ThemeChoice) => setTheme(t),
  };
}
