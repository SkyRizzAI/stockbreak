"use client";
// Minimal Wallet Standard "dev wallet" backed by a keypair seed in localStorage.
// Localnet/devnet only. Registers itself so @solana/kit-plugin-wallet discovers it like Phantom.
import {
  type Address,
  createKeyPairFromPrivateKeyBytes,
  getAddressEncoder,
  getAddressFromPublicKey,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  signBytes,
} from "@solana/kit";
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignAndSendTransactionInput,
  type SolanaSignAndSendTransactionOutput,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  type SolanaSignMessageInput,
  type SolanaSignMessageOutput,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from "@solana/wallet-standard-features";
import type { IdentifierArray, Wallet, WalletAccount, WalletIcon } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsFeature,
  type StandardEventsListeners,
} from "@wallet-standard/features";
import { registerWallet } from "@wallet-standard/wallet";
import { CLUSTER, RPC_URL } from "./env";

const CHAINS = ["solana:localnet", "solana:devnet"] as const satisfies IdentifierArray;
const RPC_BY_CHAIN: Record<string, string> = {
  "solana:localnet": CLUSTER === "localnet" ? RPC_URL : "http://127.0.0.1:8899",
  "solana:devnet": CLUSTER === "devnet" ? RPC_URL : "https://api.devnet.solana.com",
};
export const STORAGE_KEY = "stocklana:dev-wallet-seed";
const ICON: WalletIcon = `data:image/svg+xml;base64,${btoaSafe(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#171717"/><text x="16" y="21" font-family="monospace" font-size="14" fill="#fafafa" text-anchor="middle">D</text></svg>',
)}`;

function btoaSafe(s: string): string {
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64");
}

/** True once a dev wallet seed exists in this browser. */
export function hasDevWallet(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEY);
}

/** Forget the dev wallet (a new one is created on next connect). */
export function resetDevWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function loadOrCreateKeyPair(): Promise<CryptoKeyPair> {
  let hex = localStorage.getItem(STORAGE_KEY);
  if (!hex) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    hex = Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(STORAGE_KEY, hex);
  }
  const seed = Uint8Array.from((hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
  return createKeyPairFromPrivateKeyBytes(seed);
}

class DevWalletAccount implements WalletAccount {
  readonly chains = CHAINS;
  readonly features = [
    SolanaSignAndSendTransaction,
    SolanaSignTransaction,
    SolanaSignMessage,
  ] as const;
  readonly label = "Dev wallet";
  readonly icon = ICON;
  constructor(
    readonly address: Address,
    readonly publicKey: Uint8Array,
  ) {}
}

class DevWallet implements Wallet {
  readonly version = "1.0.0" as const;
  readonly name = "Dev wallet";
  readonly icon = ICON;
  readonly chains = CHAINS;
  #accounts: DevWalletAccount[] = [];
  #keyPair: CryptoKeyPair | null = null;
  #changeListeners: StandardEventsListeners["change"][] = [];

  get accounts() {
    return this.#accounts;
  }

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignTransactionFeature &
    SolanaSignAndSendTransactionFeature &
    SolanaSignMessageFeature {
    return {
      [StandardConnect]: { version: "1.0.0", connect: this.#connect },
      [StandardDisconnect]: { version: "1.0.0", disconnect: this.#disconnect },
      [StandardEvents]: { version: "1.0.0", on: this.#on },
      [SolanaSignTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0, 1],
        signTransaction: this.#signTransaction,
      },
      [SolanaSignAndSendTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0, 1],
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      [SolanaSignMessage]: { version: "1.0.0", signMessage: this.#signMessage },
    };
  }

  #emitChange() {
    for (const l of this.#changeListeners) l({ accounts: this.#accounts });
  }

  // 'change' is the only standard event today.
  #on: StandardEventsFeature[typeof StandardEvents]["on"] = (_event, listener) => {
    this.#changeListeners.push(listener);
    return () => {
      this.#changeListeners = this.#changeListeners.filter((l) => l !== listener);
    };
  };

  #connect: StandardConnectFeature[typeof StandardConnect]["connect"] = async () => {
    if (!this.#keyPair) {
      this.#keyPair = await loadOrCreateKeyPair();
      const addr = await getAddressFromPublicKey(this.#keyPair.publicKey);
      const pk = new Uint8Array(getAddressEncoder().encode(addr));
      this.#accounts = [new DevWalletAccount(addr, pk)];
      this.#emitChange();
    }
    return { accounts: this.#accounts };
  };

  #disconnect = async () => {
    this.#keyPair = null;
    this.#accounts = [];
    this.#emitChange();
  };

  #signOne = async (bytes: Uint8Array): Promise<Uint8Array> => {
    if (!this.#keyPair) throw new Error("Dev wallet not connected");
    const tx = getTransactionDecoder().decode(bytes);
    const signed = await partiallySignTransaction([this.#keyPair], tx);
    return new Uint8Array(getTransactionEncoder().encode(signed));
  };

  #signTransaction = async (
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> =>
    Promise.all(
      inputs.map(async (i) => ({ signedTransaction: await this.#signOne(i.transaction) })),
    );

  #signAndSendTransaction = async (
    ...inputs: readonly SolanaSignAndSendTransactionInput[]
  ): Promise<readonly SolanaSignAndSendTransactionOutput[]> =>
    Promise.all(
      inputs.map(async (i) => {
        const signedBytes = await this.#signOne(i.transaction);
        const tx = getTransactionDecoder().decode(signedBytes);
        const rpcUrl = RPC_BY_CHAIN[i.chain];
        if (!rpcUrl) throw new Error(`Unsupported chain ${i.chain}`);
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [getBase64EncodedWireTransaction(tx), { encoding: "base64" }],
          }),
        });
        const json = (await res.json()) as { result?: string; error?: { message: string } };
        if (!json.result) throw new Error(json.error?.message ?? "sendTransaction failed");
        return { signature: new Uint8Array(getBase58Encoder().encode(json.result)) }; // 64 bytes
      }),
    );

  #signMessage = async (
    ...inputs: readonly SolanaSignMessageInput[]
  ): Promise<readonly SolanaSignMessageOutput[]> => {
    if (!this.#keyPair) throw new Error("Dev wallet not connected");
    const kp = this.#keyPair;
    return Promise.all(
      inputs.map(async (i) => ({
        signedMessage: i.message,
        signature: new Uint8Array(await signBytes(kp.privateKey, i.message)),
      })),
    );
  };
}

let registered = false;
export function registerDevWallet() {
  if (registered || typeof window === "undefined") return;
  registered = true;
  registerWallet(new DevWallet());
}
