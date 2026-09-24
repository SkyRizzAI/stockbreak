"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CopyButton, UserLink } from "@/components/data/addr";
import { EmptyState, RowsSkeleton, Section, Tag } from "@/components/data/states";
import { api } from "@/lib/api";
import { CLUSTER } from "@/lib/env";
import type { IndexSummary } from "@/lib/types";

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm">{title}</span>
        <CopyButton text={code} label={`Copy ${title}`} />
      </div>
      <pre className="num overflow-x-auto rounded-2xl border bg-muted p-3 text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

export default function AgentsPage() {
  const q = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<
        {
          wallet: string;
          handle: string | null;
          agentName: string | null;
          created: IndexSummary[];
          managed: IndexSummary[];
        }[]
      >("/api/agents"),
  });
  const mcpUrl = "http://127.0.0.1:3333/mcp";
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">AI agents</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Connect Claude or any MCP client. Agents can research indexes, prepare transactions for
          you to sign, or — with their own wallet — create and manage indexes within the rules the
          vault program enforces.
        </p>
      </div>
      <Section title="Connect">
        <div className="grid gap-4 lg:grid-cols-2">
          <Snippet
            title="Claude Code (HTTP)"
            code={`claude mcp add --transport http stocklana ${mcpUrl}`}
          />
          <Snippet
            title="Claude Code (stdio)"
            code={"claude mcp add --transport stdio stocklana -- bun <repo>/apps/mcp/src/stdio.ts"}
          />
          <Snippet
            title="Claude Desktop (claude_desktop_config.json)"
            code={JSON.stringify(
              {
                mcpServers: {
                  stocklana: {
                    type: "stdio",
                    command: "<absolute path to bun>",
                    args: ["<repo>/apps/mcp/src/stdio.ts"],
                  },
                },
              },
              null,
              2,
            )}
          />
          <Snippet
            title="Try it"
            code={`"List the top indexes on ${CLUSTER} and simulate a rebalance for the best one."`}
          />
        </div>
      </Section>
      <Section title="Registered agents">
        {q.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : !q.data?.length ? (
          <EmptyState title="No agents registered yet. Agents register with the agent_register tool." />
        ) : (
          <ul className="divide-y rounded-2xl border">
            {q.data.map((a) => (
              <li
                key={a.wallet}
                className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex items-center gap-2">
                  <UserLink wallet={a.wallet} handle={a.handle} isAgent />
                  {a.agentName ? (
                    <span className="text-sm text-muted-foreground">{a.agentName}</span>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {a.created.map((i) => (
                    <Link key={i.pubkey} href={`/i/${i.pubkey}`}>
                      <Tag>Creator · {i.symbol}</Tag>
                    </Link>
                  ))}
                  {a.managed.map((i) => (
                    <Link key={i.pubkey} href={`/i/${i.pubkey}`}>
                      <Tag>Manager · {i.symbol}</Tag>
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
