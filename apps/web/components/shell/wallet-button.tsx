"use client";
import { ata, faucetIxs, fetchTokenBalances, sendTx, TOKEN_PROGRAM } from "@repo/sdk";
import type { Address } from "@solana/kit";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/data/addr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, useConfig } from "@/lib/api";
import { hasDevWallet } from "@/lib/dev-wallet";
import { CLUSTER, CLUSTER_LABEL } from "@/lib/env";
import { num, short } from "@/lib/format";
import { chain } from "@/lib/solana";
import { walletClient } from "@/lib/wallet";

export function useBalances(address: string | null) {
  const cfg = useConfig();
  const usdc = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint;
  return useQuery({
    queryKey: ["balances", address, usdc],
    enabled: !!address && !!usdc,
    refetchInterval: 10_000,
    queryFn: async () => {
      const c = chain();
      const a = address as Address;
      const { value: lamports } = await c.rpc.getBalance(a).send();
      const usdcAta = await ata(a, usdc as Address, TOKEN_PROGRAM);
      const bal = await fetchTokenBalances(c, [usdcAta]);
      return { sol: Number(lamports) / 1e9, usdc: Number(bal.get(usdcAta) ?? 0n) / 1e6 };
    },
  });
}

/** Fund a fresh dev wallet: SOL for fees + simulated USDC. */
export async function fundDevWallet(
  address: Address,
  usdcMint: Address,
  signer: Parameters<typeof faucetIxs>[0],
  usdcAmount = 10_000,
): Promise<void> {
  await api("/api/faucet/sol", { method: "POST", body: JSON.stringify({ wallet: address }) });
  // The faucet confirms at "confirmed"; the default ("finalized") lags ~13 s on devnet.
  for (let i = 0; i < 60; i++) {
    const { value } = await chain().rpc.getBalance(address, { commitment: "confirmed" }).send();
    if (value > 0n) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await sendTx(chain(), signer, await faucetIxs(signer, usdcMint, BigInt(usdcAmount) * 1_000_000n));
}

function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const wallets = useWallets(walletClient);
  const { isRunning } = useConnect(walletClient);
  const connect = (w: (typeof wallets)[number]) => walletClient.wallet.connect(w);
  const cfg = useConfig();
  const qc = useQueryClient();
  const dev = wallets.find((w) => w.name === "Dev wallet");
  const others = wallets.filter((w) => w.name !== "Dev wallet");
  const connectDev = async () => {
    if (!dev) return;
    const fresh = !hasDevWallet();
    const accounts = await connect(dev);
    onOpenChange(false);
    const account = accounts?.[0];
    const usdc = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint;
    const signer = walletClient.wallet.getState().connected?.signer;
    if (fresh && account && usdc && signer) {
      const id = toast.loading("Funding your dev wallet…");
      try {
        await fundDevWallet(account.address as Address, usdc as Address, signer);
        toast.success("Dev wallet funded with SOL and 10,000 USDC (simulated)", { id });
        await qc.invalidateQueries();
      } catch (e) {
        toast.error(`Could not fund the dev wallet: ${e instanceof Error ? e.message : e}`, { id });
      }
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
          <DialogDescription>{CLUSTER_LABEL} · all assets are simulated</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {others.map((w) => (
            <Button
              key={w.name}
              variant="outline"
              className="h-11 justify-start gap-3"
              disabled={isRunning}
              onClick={() =>
                void connect(w)
                  .then(() => onOpenChange(false))
                  .catch(() => {})
              }
            >
              {/* biome-ignore lint/performance/noImgElement: wallet icons are data URIs */}
              <img src={w.icon} alt="" className="size-5 rounded" />
              {w.name}
            </Button>
          ))}
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {CLUSTER === "devnet"
                ? "No wallet found. Install Phantom and switch it to Devnet (Settings → Developer Settings → Testnet Mode)."
                : "Browser wallets usually do not support localnet. Use the dev wallet below."}
            </p>
          ) : null}
          {dev ? (
            <Button
              variant="outline"
              className="h-11 justify-start gap-3"
              disabled={isRunning}
              onClick={() => void connectDev()}
            >
              {/* biome-ignore lint/performance/noImgElement: wallet icons are data URIs */}
              <img src={dev.icon} alt="" className="size-5 rounded" />
              <span className="flex flex-col items-start leading-tight">
                <span>{hasDevWallet() ? "Dev wallet" : "Create dev wallet"}</span>
                <span className="text-xs text-muted-foreground">
                  For testing — key stored in this browser
                </span>
              </span>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Open the connect dialog from anywhere (e.g. "Connect wallet" buttons). */
export function openConnect() {
  window.dispatchEvent(new Event("stocklana:connect"));
}

function Inner() {
  const connected = useConnectedWallet(walletClient);
  const { dispatch: disconnect } = useDisconnect(walletClient);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("stocklana:connect", h);
    return () => window.removeEventListener("stocklana:connect", h);
  }, []);
  const address = connected?.account.address ?? null;
  const bal = useBalances(address);
  if (!connected || !address) {
    return (
      <>
        <Button size="lg" onClick={() => setOpen(true)} data-testid="connect-wallet">
          <Wallet />
          Connect
        </Button>
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="lg" className="gap-2" data-testid="wallet-menu" />}
      >
        <span className="num text-xs">{short(address)}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span className="num text-xs">{short(address, 6)}</span>
            <CopyButton text={address} label="Copy address" />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="grid grid-cols-2 gap-2 px-2 pb-2 text-xs">
          <div className="rounded-md border px-2 py-1.5">
            <div className="text-muted-foreground">SOL</div>
            <div className="num">{bal.data ? num(bal.data.sol, 3) : "—"}</div>
          </div>
          <div className="rounded-md border px-2 py-1.5">
            <div className="text-muted-foreground">USDC</div>
            <div className="num">{bal.data ? num(bal.data.usdc, 2) : "—"}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem nativeButton={false} render={<Link href="/portfolio" />}>
          Portfolio
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={`/u/${address}`} />}>Profile</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/faucet" />}>Faucet</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void disconnect()}>
          <LogOut />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return (
      <Button size="lg" variant="outline" disabled>
        Wallet
      </Button>
    );
  return (
    <WalletReadyGate
      client={walletClient}
      fallback={
        <Button size="lg" variant="outline" disabled>
          Wallet
        </Button>
      }
    >
      <Inner />
    </WalletReadyGate>
  );
}
