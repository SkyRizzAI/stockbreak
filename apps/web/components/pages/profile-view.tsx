"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Addr } from "@/components/data/addr";
import { Avatar } from "@/components/data/avatar";
import { EmptyState, ErrorState, RowsSkeleton, Section, Tag } from "@/components/data/states";
import { IndexTable } from "@/components/index/index-table";
import { PositionsTable } from "@/components/pages/positions-table";
import { PostThread } from "@/components/social/post-thread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, useProfile } from "@/lib/api";
import { signedPayload } from "@/lib/auth";
import { short } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

export const BADGES: Record<string, { label: string; hint: string }> = {
  first_index: { label: "First index", hint: "Created an index" },
  first_join: { label: "First join", hint: "Joined an index" },
  ten_holders: { label: "10 holders", hint: "An index you made has 10+ holders" },
  cloned: { label: "Cloned", hint: "Someone cloned your index" },
  beat_spy_7d: { label: "Beat SPY 7d", hint: "Your index beat SPYx over 7 days" },
  ai_manager: { label: "AI manager", hint: "Appointed a registered AI agent as manager" },
  ipo_survivor: { label: "IPO survivor", hint: "Your index went through an IPO migration" },
};

function EditProfile({
  wallet,
  handle,
  bio,
  onSaved,
}: {
  wallet: string;
  handle: string | null;
  bio: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(handle ?? "");
  const [b, setB] = useState(bio ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const auth = await signedPayload(wallet, "profile");
      await api(`/api/users/${wallet}`, {
        method: "POST",
        body: JSON.stringify({ handle: h || null, bio: b || null, ...auth }),
      });
      toast.success("Profile saved");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="edit-profile">
        Edit profile
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handle">Handle</Label>
              <Input
                id="handle"
                value={h}
                onChange={(e) =>
                  setH(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, "")
                      .slice(0, 20),
                  )
                }
                placeholder="satoshi"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={b}
                maxLength={160}
                rows={3}
                onChange={(e) => setB(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              You will sign a message to prove you own this wallet. No transaction, no fee.
            </p>
          </div>
          <DialogFooter>
            <Button disabled={saving || (h !== "" && h.length < 3)} onClick={() => void save()}>
              {saving ? "Signing…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProfileView({ wallet }: { wallet: string }) {
  const w = useWallet();
  const q = useProfile(wallet, w.address);
  const [busy, setBusy] = useState(false);
  if (q.isLoading)
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <RowsSkeleton rows={6} />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorState message="Could not load this profile." onRetry={() => void q.refetch()} />
      </div>
    );
  const p = q.data;
  const own = w.address === wallet;
  const prevLevelXp = 50 * p.level ** 2;
  const progress = ((p.xp - prevLevelXp) / Math.max(1, p.nextLevelXp - prevLevelXp)) * 100;
  const follow = async () => {
    if (!w.address) return;
    setBusy(true);
    try {
      const auth = await signedPayload(w.address, "follow");
      await api(`/api/users/${wallet}/follow`, {
        method: "POST",
        body: JSON.stringify({ follower: w.address, follow: !p.isFollowing, ...auth }),
      });
      await q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update follow");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar seed={wallet} size={64} />
          <div className="flex flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {p.handle ? `@${p.handle}` : short(wallet)}
              {p.isAgent ? <Tag>AI agent{p.agentName ? ` · ${p.agentName}` : ""}</Tag> : null}
            </h1>
            <Addr value={wallet} />
            {p.bio ? <p className="max-w-prose text-sm text-muted-foreground">{p.bio}</p> : null}
            <p className="text-xs text-muted-foreground">
              <span className="num text-foreground">{p.followers}</span> followers ·{" "}
              <span className="num text-foreground">{p.following}</span> following
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {own ? (
            <EditProfile
              wallet={wallet}
              handle={p.handle}
              bio={p.bio}
              onSaved={() => void q.refetch()}
            />
          ) : w.address ? (
            <Button
              variant={p.isFollowing ? "outline" : "default"}
              disabled={busy}
              onClick={() => void follow()}
              data-testid="follow"
            >
              {p.isFollowing ? "Following" : "Follow"}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Level</span>
            <span className="num text-2xl" data-testid="level">
              {p.level}
            </span>
          </div>
          <Progress value={progress} />
          <span className="num text-xs text-muted-foreground">
            {p.xp} XP · next level at {p.nextLevelXp}
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border p-4">
          <span className="text-sm text-muted-foreground">Badges</span>
          {p.badges.length ? (
            <ul className="flex flex-wrap gap-2" data-testid="badges">
              {p.badges.map((b) => (
                <li key={b.badge}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className="inline-flex h-7 items-center rounded-md border px-2 text-xs"
                          data-badge={b.badge}
                        />
                      }
                    >
                      {BADGES[b.badge]?.label ?? b.badge}
                    </TooltipTrigger>
                    <TooltipContent>{BADGES[b.badge]?.hint ?? b.badge}</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No badges yet.</p>
          )}
        </div>
      </div>

      <Section title="Indexes created">
        {p.created.length ? (
          <IndexTable rows={p.created} compact />
        ) : (
          <EmptyState title="No indexes yet." />
        )}
      </Section>
      <Section title="Positions">
        {p.positions.length ? (
          <PositionsTable rows={p.positions} />
        ) : (
          <EmptyState title="No public positions." />
        )}
      </Section>
      <PostThread title="Posts" author={p.wallet} />
    </div>
  );
}
