"use client";
import { environmentManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { useSessionFollowsWallet } from "@/lib/social";
import { useThemeInit } from "@/lib/theme";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        // Client errors (404 not found, 400 bad input) will not change on retry.
        retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
      },
    },
  });
}
let browserClient: QueryClient | undefined;
function getQueryClient() {
  if (environmentManager.isServer()) return makeClient();
  browserClient ??= makeClient();
  return browserClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const qc = getQueryClient();
  useThemeInit();
  return (
    <QueryClientProvider client={qc}>
      <SessionGuard />
      <TooltipProvider>
        {children}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function SessionGuard() {
  useSessionFollowsWallet();
  return null;
}
