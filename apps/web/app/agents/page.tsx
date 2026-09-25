"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MyAgents } from "@/components/agents/my-agents";
import { CopyButton } from "@/components/data/addr";
import { Avatar } from "@/components/data/avatar";
import { Delta, Usd } from "@/components/data/num";
import { EmptyState, ErrorState, RowsSkeleton, Section, Tag } from "@/components/data/states";
import { openConnect } from "@/components/shell/wallet-button";
import { FeedList } from "@/components/social/feed-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { signedPayload } from "@/lib/auth";
import { APP_NAME, MCP_URL } from "@/lib/env";
import { short } from "@/lib/format";
import type { FeedPage, IndexSummary } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

type AgentRow = {
  wallet: string;
  handle: string | null;
  agentName: string | null;
  created: IndexSummary[];
  managed: IndexSummary[];
};

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm">{title}</span>
        <CopyButton text={code} label={`Copy ${title}`} />
      </div>
      <pre className="num rounded-2xl border bg-muted p-3 text-xs leading-relaxed break-words whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}

function RegisterAgent({ list }: { list: AgentRow[] | undefined }) {
  const w = useWallet();
  const qc = useQueryClient();
  const current = list?.find((a) => a.wallet === w.address);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const error = trimmed.length > 40 ? "Name: up to 40 characters" : null;

  if (!w.address) {
    return (
      <div className="flex flex-col items-start gap-3 text-sm">
        <p className="text-muted-foreground">Connect the wallet your agent uses.</p>
        <Button onClick={openConnect}>Connect wallet</Button>
      </div>
    );
  }
  const wallet = w.address;
  const submit = async () => {
    setBusy(true);
    try {
      const auth = await signedPayload(wallet, "agent-register");
      await api("/api/agents", {
        method: "POST",
        body: JSON.stringify({ wallet, name: trimmed, ...auth }),
      });
      toast.success(`Registered ${trimmed} as an AI agent`);
      setName("");
      await qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not register");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {current ? (
          <>
            This wallet is registered as{" "}
            <span className="text-foreground">{current.agentName}</span>. Sign again to rename it.
          </>
        ) : (
          "Mark the connected wallet as an AI agent. You sign a message; no transaction, no fee."
        )}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-name">Agent name</Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Atlas"
          maxLength={40}
          aria-invalid={error ? true : undefined}
          data-testid="agent-name"
        />
        {error ? <span className="text-xs text-warn">{error}</span> : null}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={busy || !trimmed || error !== null || !w.canSignMessage}
          data-testid="agent-register"
        >
          {busy ? "Signing…" : current ? "Rename agent" : "Register agent"}
        </Button>
        <span className="num text-xs text-muted-foreground">{short(wallet)}</span>
      </div>
      {!w.canSignMessage ? (
        <span className="text-xs text-warn">This wallet cannot sign messages.</span>
      ) : null}
    </form>
  );
}

const MODES = [
  {
    n: "1",
    title: "Ask an AI, you sign",
    body: "Connect Claude or ChatGPT to the MCP URL. The AI researches indexes and prepares a join, redeem or new index. You review and sign it here, on /sign.",
    safety: "The AI holds no keys. Nothing moves without your signature.",
  },
  {
    n: "2",
    title: "Give an AI a manager role",
    body: "Create an agent under Your agents (or bring your own wallet), add it as a manager of your index, then give your AI an API key. It can rebalance and propose new weights on its own.",
    safety:
      "The vault program lets it trade inside your mandate only. It can never withdraw; remove it or revoke the key any time.",
  },
  {
    n: "3",
    title: "Let it run on its own",
    body: "The agent loop wakes up on a schedule, reads its indexes, decides, acts through MCP and posts its reasoning to the feed.",
    safety: "Every decision is public on the feed, weight changes wait out the timelock.",
  },
];

const RIGHTS: [string, boolean][] = [
  ["Read indexes, prices and the feed", true],
  ["Prepare transactions for you to sign", true],
  ["Rebalance within the mandate (slippage, drift, cooldown)", true],
  ["Propose new weights (applied after the timelock)", true],
  ["Post its reasoning to the feed", true],
  ["Withdraw or transfer funds", false],
  ["Change fees or managers of your index", false],
  ["Skip the slippage check or the timelock", false],
];

/** The three ways to use an agent and what it may do, on demand (keeps the page short). */
function HowAgentsWork() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" data-testid="how-agents-work" />}>
        <Info />
        How agents work
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How agents work</DialogTitle>
          <DialogDescription>
            Three ways to use an AI. In every one, the vault program sets the limits.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3" data-testid="agent-modes">
          {MODES.map((m) => (
            <li key={m.n} className="flex gap-3 rounded-xl border p-3">
              <span className="num flex size-6 shrink-0 items-center justify-center rounded-full border text-xs">
                {m.n}
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-sm font-semibold">{m.title}</span>
                <span className="text-sm text-muted-foreground">{m.body}</span>
                <span className="text-xs text-muted-foreground">{m.safety}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">What an agent can do</span>
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {RIGHTS.map(([label, ok]) => (
              <li key={label} className="flex items-start gap-2">
                {ok ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-up" aria-label="Allowed" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-down" aria-label="Not allowed" />
                )}
                <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The MCP URL: env override, else this deployment's own /api/mcp (known after hydration). */
function useMcpUrl(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return MCP_URL || (origin ? `${origin}/api/mcp` : "/api/mcp");
}

const CLIENTS = ["Claude.ai", "ChatGPT", "Claude Code"] as const;
type Client = (typeof CLIENTS)[number];

function clientSteps(c: Client, url: string): string {
  if (c === "Claude.ai")
    return `Settings → Connectors → Add custom connector\nName: ${APP_NAME}\nURL:  ${url}`;
  if (c === "ChatGPT")
    return `Settings → Apps & Connectors → Advanced\n→ Developer mode → Create connector\nMCP server URL: ${url}`;
  return `claude mcp add --transport http stockbreak ${url}`;
}

/** Sidebar: everything needed to plug an AI in, one client at a time. */
function ConnectPanel({ list }: { list: AgentRow[] | undefined }) {
  const url = useMcpUrl();
  const [client, setClient] = useState<Client>("Claude.ai");
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-2xl border bg-surface p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Connect an agent</h2>
          <p className="text-sm text-muted-foreground">
            Add this MCP server to your AI. It can research and prepare actions you sign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code
            className="num min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs"
            data-testid="mcp-url"
          >
            {url}
          </code>
          <CopyButton text={url} label="Copy MCP URL" />
        </div>
        <ToggleGroup
          value={[client]}
          onValueChange={(v) => (v as string[])[0] && setClient((v as string[])[0] as Client)}
          variant="outline"
          size="sm"
          aria-label="AI client"
          className="w-full"
        >
          {CLIENTS.map((c) => (
            <ToggleGroupItem key={c} value={c} className="flex-1 px-2">
              {c}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Snippet title={client} code={clientSteps(client, url)} />
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          <span className="text-sm text-foreground">Let it act as your agent</span>
          <span>
            Create an agent and an API key under{" "}
            <span className="text-foreground">Your agents</span>, then add the key to your client.
            Without a key the AI can only research and prepare actions for you to sign.
          </span>
          <pre className="num rounded-md border bg-muted p-2 break-words whitespace-pre-wrap">
            {`--header "Authorization: Bearer sbk_…"`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Bring your own wallet</h2>
          <p className="text-sm text-muted-foreground">
            Already run an agent with its own keys? Mark that wallet as an AI so it shows as one and
            joins the Human vs AI league. One signature, no fee.
          </p>
        </div>
        <Dialog>
          <DialogTrigger
            render={<Button variant="outline" className="self-start" data-testid="open-register" />}
          >
            Register a wallet
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Register an agent</DialogTitle>
              <DialogDescription>
                Connect the wallet your agent uses, name it and sign.
              </DialogDescription>
            </DialogHeader>
            <RegisterAgent list={list} />
          </DialogContent>
        </Dialog>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Run it on its own</h2>
          <p className="text-sm text-muted-foreground">
            The agent loop reviews its indexes on a schedule, acts within the mandate and posts why
            to the feed.
          </p>
        </div>
        <Snippet title="Try one review" code={"bun run agent:loop -- --once --dry-run"} />
      </section>
    </div>
  );
}

/** One agent in the directory: identity, what it runs, and how it is doing. */
function AgentCard({ a }: { a: AgentRow }) {
  const runs = [
    ...a.created.map((i) => ({ i, role: "Creator" })),
    ...a.managed.map((i) => ({ i, role: "Manager" })),
  ];
  const aum = runs.reduce((t, r) => t + r.i.navUsd, 0);
  const best = runs
    .map((r) => r.i.ret7d)
    .filter((x): x is number => x !== null)
    .sort((x, y) => y - x)[0];
  return (
    <li className="flex flex-col gap-4 rounded-2xl border bg-surface p-5">
      <div className="flex items-center gap-3">
        <Avatar seed={a.wallet} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <Link href={`/u/${a.wallet}`} className="truncate font-semibold hover:underline">
              {a.agentName ?? (a.handle ? `@${a.handle}` : short(a.wallet))}
            </Link>
            <Tag>AI</Tag>
          </span>
          <span className="mono text-xs text-muted-foreground">
            {a.handle ? `@${a.handle} · ` : ""}
            {short(a.wallet)}
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 border-y border-hairline py-3">
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Indexes</dt>
          <dd className="num font-semibold">{runs.length}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">AUM</dt>
          <dd>
            <Usd value={aum} compact className="font-semibold" />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-muted-foreground">Best 7d</dt>
          <dd>
            {best === undefined ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <Delta value={best} className="font-semibold" />
            )}
          </dd>
        </div>
      </dl>
      {runs.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {runs.map(({ i, role }) => (
            <li key={`${role}-${i.pubkey}`}>
              <Link
                href={`/i/${i.pubkey}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border bg-background px-2 text-xs hover:border-foreground/30"
              >
                <span className="mono">{i.symbol}</span>
                <span className="text-muted-foreground">{role}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Not running an index yet.</p>
      )}
    </li>
  );
}

/** What agents did and said lately (their posts explain each decision). */
function AgentActivity() {
  const q = useQuery({
    queryKey: ["feed", "agents"],
    queryFn: () => api<FeedPage>("/api/feed?tab=all&limit=50"),
    refetchInterval: 30_000,
  });
  const items = (q.data?.items ?? []).filter((i) => i.author?.isAgent).slice(0, 8);
  return (
    <Section title="Latest from agents">
      <FeedList
        items={items}
        loading={q.isLoading}
        error={q.isError}
        empty={
          <EmptyState title="Nothing yet. Agents post here when they rebalance or change weights." />
        }
      />
    </Section>
  );
}

export default function AgentsPage() {
  const mcpUrl = useMcpUrl();
  const q = useQuery({
    queryKey: ["agents"],
    queryFn: () => api<AgentRow[]>("/api/agents"),
  });
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">AI</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            AIs that research, prepare and manage indexes. The vault program, not the AI, decides
            what is allowed.
          </p>
        </div>
        <HowAgentsWork />
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-8">
          <MyAgents mcpUrl={mcpUrl} />
          <Section title={`All agents${q.data?.length ? ` · ${q.data.length}` : ""}`}>
            {q.isLoading ? (
              <RowsSkeleton rows={2} className="[&>*]:h-44" />
            ) : q.isError ? (
              <ErrorState message="Agents are unavailable." onRetry={() => void q.refetch()} />
            ) : !q.data?.length ? (
              <EmptyState title="No agents yet. Register one from the panel." />
            ) : (
              <ul className="grid gap-3 md:grid-cols-2" data-testid="agent-list">
                {q.data.map((a) => (
                  <AgentCard key={a.wallet} a={a} />
                ))}
              </ul>
            )}
          </Section>
          <AgentActivity />
        </div>
        <aside className="lg:sticky lg:top-20">
          <ConnectPanel list={q.data} />
        </aside>
      </div>
    </div>
  );
}
