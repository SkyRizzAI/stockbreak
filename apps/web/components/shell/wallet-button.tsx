"use client";
import {
  ata,
  faucetIxs,
  fetchTokenBalances,
  humanizeError,
  sendTx,
  TOKEN_PROGRAM,
} from "@repo/sdk";
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
import { ApiError, api, useConfig } from "@/lib/api";
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

/** Human message for a failed faucet / wallet step (API errors carry their own text). */
function reason(e: unknown): string {
  return e instanceof ApiError ? e.message : humanizeError(e);
}

/**
 * Fund a dev wallet that has no SOL: SOL for fees first, then simulated USDC
 * (only when the wallet holds none). Returns false when nothing was needed.
 */
export async function fundDevWallet(
  address: Address,
  usdcMint: Address,
  signer: Parameters<typeof faucetIxs>[0],
  usdcAmount = 10_000,
): Promise<boolean> {
  const c = chain();
  const lamports = async () =>
    (await c.rpc.getBalance(address, { commitment: "confirmed" }).send()).value;
  if ((await lamports()) > 0n) return false;
  await api("/api/faucet/sol", { method: "POST", body: JSON.stringify({ wallet: address }) });
  // The faucet confirms at "confirmed"; the default ("finalized") lags ~13 s on devnet.
  let arrived = false;
  for (let i = 0; i < 60 && !arrived; i++) {
    arrived = (await lamports()) > 0n;
    if (!arrived) await new Promise((r) => setTimeout(r, 500));
  }
  if (!arrived) throw new Error("SOL from the faucet did not arrive. Try the faucet page.");
  const usdcAta = await ata(address, usdcMint, TOKEN_PROGRAM);
  if (((await fetchTokenBalances(c, [usdcAta])).get(usdcAta) ?? 0n) === 0n)
    await sendTx(c, signer, await faucetIxs(signer, usdcMint, BigInt(usdcAmount) * 1_000_000n));
  return true;
}

const PHANTOM_HINT =
  "In Phantom, open Settings → Developer Settings, turn on Testnet Mode and pick Solana Devnet.";

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
  const connectOther = async (w: (typeof wallets)[number]) => {
    try {
      await connect(w);
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error(`Could not connect ${w.name}. ${reason(e)}`, {
        description: CLUSTER === "devnet" ? PHANTOM_HINT : undefined,
        duration: 12_000,
        closeButton: true,
      });
    }
  };
  const connectDev = async () => {
    if (!dev) return;
    let account: { address: string } | undefined;
    try {
      account = (await connect(dev))?.[0];
    } catch (e) {
      console.error(e);
      toast.error(`Could not connect the dev wallet. ${reason(e)}`, {
        duration: 12_000,
        closeButton: true,
      });
      return;
    }
    onOpenChange(false);
    const usdc = cfg.data?.assets.find((a) => a.symbol === "USDC")?.mint;
    const signer = walletClient.wallet.getState().connected?.signer;
    if (!account || !usdc || !signer) return;
    const id = toast.loading("Checking your dev wallet…");
    try {
      const funded = await fundDevWallet(account.address as Address, usdc as Address, signer);
      toast.success(
        funded
          ? "Dev wallet funded with SOL and simulated USDC"
          : "Dev wallet funded (existing balance)",
        { id },
      );
      await qc.invalidateQueries();
    } catch (e) {
      console.error(e);
      toast.error(`Could not fund the dev wallet: ${reason(e)}`, {
        id,
        duration: 12_000,
        closeButton: true,
      });
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
              onClick={() => void connectOther(w)}
            >
              {/* biome-ignore lint/performance/noImgElement: wallet icons are data URIs */}
              <img src={w.icon} alt="" className="size-5 rounded" />
              {w.name}
            </Button>
          ))}
          {others.length > 0 && CLUSTER === "devnet" ? (
            <p className="text-xs text-muted-foreground">{PHANTOM_HINT}</p>
          ) : null}
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
        <Button
          size="lg"
          variant="outline"
          className="h-10 gap-2 px-3"
          onClick={() => setOpen(true)}
          data-testid="connect-wallet"
        >
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
        render={
          <Button
            variant="outline"
            size="lg"
            className="h-10 gap-2 px-3"
            data-testid="wallet-menu"
          />
        }
      >
        <span className="mono text-[13px]">{short(address)}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span className="mono text-xs">{short(address, 6)}</span>
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
      <Button size="lg" variant="outline" className="h-10 px-3" disabled>
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
