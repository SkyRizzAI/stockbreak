import { readDeployment } from "@repo/config/node";
import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";
import { APP_NAME } from "@/lib/env";

export const metadata: Metadata = {
  title: { absolute: `${APP_NAME} — The index launchpad for tokenized stocks` },
  description:
    "Turn your stock thesis into an index token. Pick tokenized stocks and pre-IPO names, share it as a Blink, and let a Solana vault program enforce the rebalancing. Simulated assets on devnet.",
};

// Fallback when the devnet deployment file is absent (e.g. a fresh localnet checkout).
const DEVNET_PROGRAMS = {
  indexVault: "4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me",
  mockMarket: "9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8",
};

function programIds() {
  try {
    const d = readDeployment("devnet");
    if (d?.indexVaultProgram && d.mockMarketProgram)
      return { indexVault: d.indexVaultProgram, mockMarket: d.mockMarketProgram };
  } catch {
    // Unreadable deployment file: use the published IDs.
  }
  return DEVNET_PROGRAMS;
}

export default function LandingPage() {
  return <Landing programs={programIds()} />;
}
