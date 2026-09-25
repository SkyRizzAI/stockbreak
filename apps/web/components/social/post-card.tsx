"use client";
/** A post with like, comments (one level) and delete for its author (D033). */
import { useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UserLink } from "@/components/data/addr";
import { Avatar } from "@/components/data/avatar";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useComments } from "@/lib/api";
import { ago } from "@/lib/format";
import { socialWrite } from "@/lib/social";
import type { CommentItem, PostItem } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { COMMENT_MAX, errorText } from "./composer";
import { IndexCard } from "./index-card";
import { IndexStrip } from "./index-strip";

function Stamp({ ts }: { ts: string }) {
  return (
    <time
      dateTime={ts}
      title={new Date(ts).toLocaleString("en-US")}
      className="text-xs text-muted-foreground"
    >
      {ago(ts)}
    </time>
  );
}

/** Two-step delete so a stray tap never removes content. */
function DeleteButton({ onConfirm, label }: { onConfirm: () => Promise<void>; label: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground"
      disabled={busy}
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
      onBlur={() => setArmed(false)}
      aria-label={label}
    >
      {armed ? "Confirm delete" : "Delete"}
    </Button>
  );
}

function Comments({ post }: { post: PostItem }) {
  const w = useWallet();
  const qc = useQueryClient();
  const q = useComments(post.id, true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["comments", post.id] }),
      qc.invalidateQueries({ queryKey: ["feed"] }),
      qc.invalidateQueries({ queryKey: ["posts"] }),
    ]);
  const send = async () => {
    if (!w.address) return openConnect();
    setBusy(true);
    setErr(null);
    try {
      await socialWrite<CommentItem>(qc, w.address, `/api/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setText("");
      await refresh();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3">
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading comments…</p>
      ) : q.isError ? (
        <p className="text-xs text-down">Comments are unavailable.</p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="comment-list">
          {(q.data ?? []).map((c) => (
            <li key={c.id} className="flex gap-2">
              <Avatar seed={c.author.wallet} size={24} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <UserLink
                    wallet={c.author.wallet}
                    handle={c.author.handle}
                    isAgent={c.author.isAgent}
                  />
                  <Stamp ts={c.ts} />
                  {w.address === c.author.wallet ? (
                    <DeleteButton
                      label="Delete comment"
                      onConfirm={async () => {
                        await socialWrite(qc, w.address as string, `/api/comments/${c.id}`, {
                          method: "DELETE",
                        }).catch((e) => toast.error(errorText(e)));
                        await refresh();
                      }}
                    />
                  ) : null}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={COMMENT_MAX}
          placeholder={w.address ? "Write a comment…" : "Connect a wallet to comment"}
          aria-label="Comment"
          className="min-h-10 text-sm"
          data-testid="comment-input"
        />
        {err ? (
          <p role="alert" className="text-xs text-down">
            {err}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <span className="num text-xs text-muted-foreground">
            {text.trim().length}/{COMMENT_MAX}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
            data-testid="comment-submit"
          >
            {busy ? "Sending…" : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PostCard({ post, hideIndex }: { post: PostItem; hideIndex?: boolean }) {
  const w = useWallet();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(post.liked);
  const [likes, setLikes] = useState(post.likes);
  const [open, setOpen] = useState(false);
  // Follow server data (e.g. refetched with the viewer once the wallet hydrates).
  useEffect(() => {
    setLiked(post.liked);
    setLikes(post.likes);
  }, [post.liked, post.likes]);

  // Only the latest click's response may update the heart (fast like/unlike toggles).
  const seq = useRef(0);
  const toggleLike = async () => {
    if (!w.address) return openConnect();
    const next = !liked;
    const mine = ++seq.current;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const r = await socialWrite<{ likes: number; liked: boolean }>(
        qc,
        w.address,
        `/api/posts/${post.id}/like`,
        { method: "POST", body: JSON.stringify({ like: next }) },
      );
      if (mine !== seq.current) return;
      setLiked(r.liked);
      setLikes(r.likes);
    } catch (e) {
      if (mine !== seq.current) return;
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
      toast.error(errorText(e));
    }
  };

  return (
    <article className="rounded-2xl border p-4" data-testid="post-card">
      <header className="flex items-start gap-3">
        <Avatar seed={post.author.wallet} size={36} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <UserLink
              wallet={post.author.wallet}
              handle={post.author.handle}
              isAgent={post.author.isAgent}
              className="font-medium"
            />
            <Stamp ts={post.ts} />
          </div>
        </div>
        {w.address === post.author.wallet ? (
          <DeleteButton
            label="Delete post"
            onConfirm={async () => {
              try {
                await socialWrite(qc, w.address as string, `/api/posts/${post.id}`, {
                  method: "DELETE",
                });
                toast.success("Post deleted");
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["feed"] }),
                  qc.invalidateQueries({ queryKey: ["posts"] }),
                ]);
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          />
        ) : null}
      </header>
      <p
        className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap"
        data-testid="post-body"
      >
        {post.body}
      </p>
      {post.index && post.cardVariant ? (
        <IndexCard index={post.index} variant={post.cardVariant} className="mt-3" />
      ) : post.index && !hideIndex ? (
        <IndexStrip index={post.index} />
      ) : null}
      <footer className="mt-3 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground"
          aria-pressed={liked}
          aria-label={liked ? "Unlike" : "Like"}
          onClick={() => void toggleLike()}
          data-testid="like-button"
        >
          <Heart className={liked ? "size-4 fill-current text-foreground" : "size-4"} aria-hidden />
          <span className="num text-xs" data-testid="like-count">
            {likes}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground"
          aria-expanded={open}
          aria-label="Comments"
          onClick={() => setOpen((o) => !o)}
          data-testid="comments-button"
        >
          <MessageCircle className="size-4" aria-hidden />
          <span className="num text-xs">{post.comments}</span>
        </Button>
      </footer>
      {open ? <Comments post={post} /> : null}
    </article>
  );
}
