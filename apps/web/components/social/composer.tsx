"use client";
/** Post composer: one signature per session, then plain-text posts (D033). */
import { humanizeError } from "@repo/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { useState } from "react";
import { toast } from "sonner";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { socialWrite } from "@/lib/social";
import type { CardVariant, IndexRef, IndexSummary, PostItem } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { CardVariantPicker, IndexCard } from "./index-card";

export const POST_MAX = 500;
export const COMMENT_MAX = 280;

export function errorText(e: unknown): string {
  return e instanceof Error && !/Solana error|Transaction failed/.test(e.message)
    ? e.message
    : humanizeError(e);
}

export function Composer({
  index,
  share,
  onShared,
  placeholder = "Share a thesis, a trade idea or an update…",
}: {
  index?: IndexRef | null;
  /** Share an index as a card (D035): picks a card look and shows a preview. */
  share?: IndexSummary | null;
  onShared?: () => void;
  placeholder?: string;
}) {
  const w = useWallet();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [variant, setVariant] = useState<CardVariant>("mark");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!w.address)
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border px-4 py-4 text-sm">
        <p className="text-muted-foreground">Connect a wallet to post and comment.</p>
        <Button size="sm" variant="outline" onClick={openConnect}>
          Connect wallet
        </Button>
      </div>
    );

  const len = text.trim().length;
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await socialWrite<PostItem>(qc, w.address as string, "/api/posts", {
        method: "POST",
        body: JSON.stringify({
          body: text,
          index: share?.pubkey ?? index?.pubkey ?? null,
          cardVariant: share ? variant : null,
        }),
      });
      setText("");
      onShared?.();
      toast.success("Posted");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["feed"] }),
        qc.invalidateQueries({ queryKey: ["posts"] }),
      ]);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border p-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={POST_MAX}
        placeholder={
          share
            ? `Why ${share.symbol}? Share your take…`
            : index
              ? `Post about ${index.symbol}…`
              : placeholder
        }
        aria-label="New post"
        className="min-h-20 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
        data-testid="post-input"
      />
      {share ? (
        <div className="flex flex-col gap-2" data-testid="share-preview">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Card style</span>
            <CardVariantPicker value={variant} onChange={setVariant} />
          </div>
          <IndexCard index={share} variant={variant} />
        </div>
      ) : null}
      {err ? (
        <p role="alert" className="text-xs text-down" data-testid="post-error">
          {err}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t pt-2">
        <span className="text-xs text-muted-foreground">
          Plain text · up to 2 links · needs on-chain activity
        </span>
        <div className="flex items-center gap-3">
          <span
            className={cn("num text-xs text-muted-foreground", len > POST_MAX - 50 && "text-warn")}
          >
            {len}/{POST_MAX}
          </span>
          <Button
            size="sm"
            disabled={busy || len === 0}
            onClick={() => void submit()}
            data-testid="post-submit"
          >
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </div>
  );
}
