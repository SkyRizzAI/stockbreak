"use client";
/**
 * "Your agents": the signed-in wallet's own AI agents (D045). Create an agent (the server
 * makes and keeps its wallet), fund it with SOL for fees, and issue API keys that let an
 * MCP client act as that agent. Keys are shown once, can be revoked, and show last use.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/data/addr";
import { Avatar } from "@/components/data/avatar";
import { EmptyState, RowsSkeleton, Section, Tag } from "@/components/data/states";
import { openConnect, useBalances } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { ago, num, short } from "@/lib/format";
import { ensureSession, socialWrite } from "@/lib/social";
import { useWallet } from "@/lib/wallet";
import { type AgentIndexRef, type Autopilot, AutopilotPanel } from "./autopilot";

export interface MyKey {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
export interface MyAgent {
  wallet: string;
  name: string;
  createdAt: string;
  keys: MyKey[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** null = signed out (no session yet); the list otherwise. */
function useMyAgents(wallet: string | null) {
  return useQuery({
    queryKey: ["me-agents", wallet ?? ""],
    enabled: !!wallet,
    queryFn: async () => {
      try {
        return (await api<{ agents: MyAgent[] }>("/api/me/agents")).agents;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  cta,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  cta: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void onSubmit(trimmed)
              .then(() => setName(""))
              .finally(() => setBusy(false));
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name-input">Name</Label>
            <Input
              id="name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              maxLength={40}
              autoFocus
              data-testid="name-input"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !trimmed} data-testid="name-submit">
              {busy ? "Working…" : cta}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The new key, shown exactly once with ready-to-paste setups. */
function KeyReveal({
  keyValue,
  mcpUrl,
  onClose,
}: {
  keyValue: string | null;
  mcpUrl: string;
  onClose: () => void;
}) {
  const claude = `claude mcp add --transport http stockbreak ${mcpUrl} --header "Authorization: Bearer ${keyValue ?? ""}"`;
  const json = JSON.stringify(
    {
      mcpServers: {
        stockbreak: { url: mcpUrl, headers: { Authorization: `Bearer ${keyValue ?? ""}` } },
      },
    },
    null,
    2,
  );
  const loop = `AGENT_MCP_URL=${mcpUrl} AGENT_MCP_TOKEN=${keyValue ?? ""} bun run agent:loop`;
  return (
    <Dialog open={!!keyValue} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your API key</DialogTitle>
          <DialogDescription>
            Copy it now. It is shown only once; if you lose it, revoke it and create a new one. It
            goes in an Authorization header, so use it in Claude Code, Cursor or a script (Claude.ai
            and ChatGPT connectors cannot send headers).
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code
            className="num min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-xs break-all"
            data-testid="api-key-value"
          >
            {keyValue}
          </code>
          <CopyButton text={keyValue ?? ""} label="Copy API key" />
        </div>
        {[
          ["Claude Code", claude],
          ["Cursor and other clients (mcp.json)", json],
          ["Self-hosted agent loop (repo checkout)", loop],
        ].map(([t, code]) => (
          <div key={t} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span>{t}</span>
              <CopyButton text={code as string} label={`Copy ${t}`} />
            </div>
            <pre className="num rounded-md border bg-muted p-2 text-xs break-words whitespace-pre-wrap">
              {code}
            </pre>
          </div>
        ))}
        <DialogFooter>
          <Button onClick={onClose}>I saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentRow({
  a,
  owner,
  onNewKey,
}: {
  a: MyAgent;
  owner: string;
  onNewKey: (agent: MyAgent) => void;
}) {
  const qc = useQueryClient();
  const bal = useBalances(a.wallet);
  // Shared with AutopilotPanel (same query key): the hint knows whether it is on.
  const pilot = useQuery({
    queryKey: ["autopilot", a.wallet],
    queryFn: () => api<Autopilot>(`/api/me/agents/${a.wallet}/autopilot`),
  });
  const pub = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<{ wallet: string; created: AgentIndexRef[]; managed: AgentIndexRef[] }[]>("/api/agents"),
  });
  const mine = pub.data?.find((x) => x.wallet === a.wallet);
  const indexes = [...(mine?.created ?? []), ...(mine?.managed ?? [])];
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["me-agents"] });
  const fund = async (asset: "SOL" | "USDC") => {
    setBusy(true);
    try {
      const r = await socialWrite<{ sol?: number; usdc?: number }>(
        qc,
        owner,
        `/api/me/agents/${a.wallet}/fund`,
        { method: "POST", body: JSON.stringify({ asset }) },
      );
      toast.success(
        asset === "SOL"
          ? `Sent ${r.sol} SOL to ${a.name} for fees`
          : `Minted ${num(r.usdc ?? 0)} test USDC to ${a.name}`,
      );
      await qc.invalidateQueries({ queryKey: ["balances", a.wallet] });
      void bal.refetch();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (k: MyKey) => {
    try {
      await socialWrite(qc, owner, `/api/me/keys/${k.id}`, { method: "DELETE" });
      toast.success(`Revoked ${k.name}`);
      await refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <li className="flex flex-col gap-4 rounded-2xl border bg-surface p-5" data-testid="my-agent">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar seed={a.wallet} size={36} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-semibold">
            {a.name}
            <Tag>AI</Tag>
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="mono">{short(a.wallet)}</span>
            <CopyButton text={a.wallet} label="Copy agent address" />
            <span>
              · {bal.data ? `${num(bal.data.sol)} SOL · ${num(bal.data.usdc)} USDC` : "…"}
            </span>
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void fund("SOL")}>
            {busy ? "Sending…" : "Fund SOL"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !bal.data || bal.data.sol < 0.002}
            onClick={() => void fund("USDC")}
            title={bal.data && bal.data.sol < 0.002 ? "Fund SOL first" : undefined}
          >
            Get USDC
          </Button>
          <Button size="sm" onClick={() => onNewKey(a)} data-testid="new-key">
            <KeyRound />
            New API key
          </Button>
        </div>
      </div>
      {bal.data ? (
        <p className="text-xs text-muted-foreground" data-testid="agent-next-step">
          {pilot.data?.enabled && indexes.length && bal.data.sol >= 0.01 ? null : (
            <span className="text-foreground">Next: </span>
          )}
          {bal.data.sol < 0.01 ? (
            <span className="text-warn">give it a little SOL for transaction fees (Fund SOL).</span>
          ) : !indexes.length ? (
            <>
              let it manage an index: open your index&apos;s Manage page and add{" "}
              <span className="text-foreground">{a.name}</span> under Managers &amp; AI agents.
            </>
          ) : pilot.data?.enabled ? (
            "Autopilot is on: it runs on schedule and every run is logged below."
          ) : (
            "turn on Autopilot below, or create an API key to drive it from your own AI."
          )}
        </p>
      ) : null}
      {a.keys.length ? (
        <ul className="divide-y rounded-xl border text-sm">
          {a.keys.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              data-testid="api-key-row"
            >
              <span className="flex min-w-0 flex-col">
                <span className={k.revokedAt ? "text-muted-foreground line-through" : ""}>
                  {k.name}
                </span>
                <span className="mono text-xs text-muted-foreground">{k.prefix}…</span>
              </span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {k.revokedAt
                    ? `Revoked ${ago(k.revokedAt)}`
                    : k.lastUsedAt
                      ? `Used ${ago(k.lastUsedAt)}`
                      : "Never used"}
                </span>
                {k.revokedAt ? null : (
                  <Button variant="ghost" size="sm" onClick={() => void revoke(k)}>
                    Revoke
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No API keys yet. You only need one to drive this agent from your own AI client (Claude
          Code, Cursor…). Autopilot works without a key.
        </p>
      )}
      <AutopilotPanel wallet={a.wallet} owner={owner} indexes={indexes} />
    </li>
  );
}

export function MyAgents({ mcpUrl }: { mcpUrl: string }) {
  const w = useWallet();
  const qc = useQueryClient();
  const q = useMyAgents(w.address);
  const [creating, setCreating] = useState(false);
  const [keyFor, setKeyFor] = useState<MyAgent | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  if (!w.address)
    return (
      <Section title="Your agents">
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-5 text-sm">
          <p className="text-muted-foreground">
            Connect a wallet to create your own AI agents and API keys.
          </p>
          <Button variant="outline" onClick={openConnect}>
            Connect wallet
          </Button>
        </div>
      </Section>
    );
  const owner = w.address;
  const createAgent = async (name: string) => {
    try {
      const r = await socialWrite<{ wallet: string; name: string }>(qc, owner, "/api/me/agents", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      toast.success(`Created ${r.name}`);
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["me-agents"] });
      await qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const createKey = async (name: string) => {
    if (!keyFor) return;
    try {
      const r = await socialWrite<{ id: number; key: string; prefix: string }>(
        qc,
        owner,
        `/api/me/agents/${keyFor.wallet}/keys`,
        { method: "POST", body: JSON.stringify({ name }) },
      );
      setKeyFor(null);
      setNewKey(r.key);
      await qc.invalidateQueries({ queryKey: ["me-agents"] });
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Section
      title="Your agents"
      action={
        q.data ? (
          <Button size="sm" onClick={() => setCreating(true)} data-testid="create-agent">
            <Plus />
            Create agent
          </Button>
        ) : null
      }
    >
      {q.isLoading ? (
        <RowsSkeleton rows={1} className="[&>*]:h-32" />
      ) : q.isError ? (
        <p className="text-sm text-down">Your agents could not be loaded.</p>
      ) : q.data === null ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-5 text-sm">
          <p className="text-muted-foreground">
            Sign in with your wallet (one message signature, no fee) to manage your agents.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              void ensureSession(qc, owner)
                .then(() => q.refetch())
                .catch((e) => toast.error(errText(e)))
            }
            data-testid="agents-sign-in"
          >
            Sign in
          </Button>
        </div>
      ) : !q.data?.length ? (
        <EmptyState
          title="No agents yet. Create one: we make its wallet, you give it a name, then an API key."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Create agent
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((a) => (
            <AgentRow key={a.wallet} a={a} owner={owner} onNewKey={setKeyFor} />
          ))}
        </ul>
      )}
      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create an agent"
        description="We create a wallet for it and keep its key encrypted on the server (devnet). It can only act within the rules of the indexes you let it manage."
        placeholder="e.g. Momentum Bot"
        cta="Create agent"
        onSubmit={createAgent}
      />
      <NameDialog
        open={!!keyFor}
        onOpenChange={(o) => (o ? null : setKeyFor(null))}
        title={`New API key for ${keyFor?.name ?? "agent"}`}
        description="Name it after where you will use it, e.g. “Claude Code laptop”."
        placeholder="e.g. Claude Code"
        cta="Create key"
        onSubmit={createKey}
      />
      <KeyReveal keyValue={newKey} mcpUrl={mcpUrl} onClose={() => setNewKey(null)} />
    </Section>
  );
}
