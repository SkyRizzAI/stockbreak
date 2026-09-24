"use client";
/** Typed fetch + TanStack Query hooks for the API routes. */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type {
  ActivityItem,
  AssetPrice,
  CommentItem,
  CreatorRow,
  FeedPage,
  Holder,
  IndexDetail,
  IndexSummary,
  Portfolio,
  PostItem,
  Profile,
  SeriesPoint,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ApiError(j.error ?? `Request failed (${r.status})`, r.status);
  return j;
}

export interface ClientConfig {
  cluster: "localnet" | "devnet";
  ready: boolean;
  market: string | null;
  platformTreasury: string | null;
  params: {
    timelockSecs: number;
    faucetMaxUsdc: string;
    spreadBps: number;
    platformFeeBps: number;
    cloneRoyaltyBps: number;
  };
  faucetSolPerRequest: number;
  assets: {
    symbol: string;
    name: string;
    kind: "Stock" | "PreIpo" | "Stable";
    decimals: number;
    token2022: boolean;
    mint: string;
    feed: string;
    benchmark: boolean;
    ipoTarget: string | null;
    listed: boolean;
  }[];
  ipos: Record<string, { newSymbol: string; newMint: string }>;
}

export const useConfig = () =>
  useQuery({
    queryKey: ["config"],
    queryFn: () => api<ClientConfig>("/api/config"),
    staleTime: 60_000,
  });
export const usePrices = () =>
  useQuery({
    queryKey: ["prices"],
    queryFn: () => api<AssetPrice[]>("/api/prices"),
    refetchInterval: 15_000,
  });

export interface IndexList {
  items: IndexSummary[];
  total: number;
  benchmark: {
    ret24h: number | null;
    ret7d: number | null;
    ret30d: number | null;
    retAll: number | null;
  };
}
export const useIndexes = (qs = "") =>
  useQuery({
    queryKey: ["indexes", qs],
    queryFn: () => api<IndexList>(`/api/indexes${qs ? `?${qs}` : ""}`),
    refetchInterval: 30_000,
  });
export const useIndex = (pubkey: string) =>
  useQuery({
    queryKey: ["index", pubkey],
    queryFn: () => api<IndexDetail>(`/api/indexes/${pubkey}`),
    refetchInterval: 15_000,
  });
export const usePerformance = (pubkey: string, range: string) =>
  useQuery({
    queryKey: ["perf", pubkey, range],
    queryFn: () => api<SeriesPoint[]>(`/api/indexes/${pubkey}/performance?range=${range}`),
    refetchInterval: 30_000,
  });
export const useActivity = (pubkey?: string, wallet?: string) =>
  useQuery({
    queryKey: ["activity", pubkey ?? "", wallet ?? ""],
    queryFn: () =>
      api<ActivityItem[]>(
        pubkey
          ? `/api/indexes/${pubkey}/activity`
          : `/api/activity${wallet ? `?wallet=${wallet}` : ""}`,
      ),
    refetchInterval: 15_000,
  });
export const useHolders = (pubkey: string) =>
  useQuery({
    queryKey: ["holders", pubkey],
    queryFn: () => api<Holder[]>(`/api/indexes/${pubkey}/holders`),
  });
export const useProfile = (wallet: string, viewer?: string | null) =>
  useQuery({
    queryKey: ["profile", wallet, viewer ?? ""],
    queryFn: () => api<Profile>(`/api/users/${wallet}${viewer ? `?viewer=${viewer}` : ""}`),
  });
export const usePortfolio = (wallet: string | null) =>
  useQuery({
    queryKey: ["portfolio", wallet],
    queryFn: () => api<Portfolio>(`/api/portfolio/${wallet}`),
    enabled: !!wallet,
    refetchInterval: 20_000,
  });
export const useCreatorsBoard = (type: string) =>
  useQuery({
    queryKey: ["board", "creators", type],
    queryFn: () => api<{ rows: CreatorRow[] }>(`/api/leaderboard?board=creators&type=${type}`),
  });
export const useIndexBoard = (range: string, type: string) =>
  useQuery({
    queryKey: ["board", "indexes", range, type],
    queryFn: () =>
      api<{ rows: IndexSummary[]; benchmark: number | null }>(
        `/api/leaderboard?board=indexes&range=${range}&type=${type}`,
      ),
  });

// ---------------- social feed (D033) ----------------

export const useSession = () =>
  useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ wallet: string | null }>("/api/auth/session"),
    staleTime: 60_000,
  });

export const useFeed = (tab: "all" | "following", viewer: string | null) =>
  useInfiniteQuery({
    queryKey: ["feed", tab, viewer ?? ""],
    enabled: tab === "all" || !!viewer,
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ tab, limit: "30" });
      if (viewer) qs.set("viewer", viewer);
      if (pageParam) qs.set("before", pageParam);
      return api<FeedPage>(`/api/feed?${qs}`);
    },
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 20_000,
  });

export const usePosts = (scope: { index?: string; author?: string }, viewer: string | null) =>
  useQuery({
    queryKey: ["posts", scope.index ?? "", scope.author ?? "", viewer ?? ""],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (scope.index) qs.set("index", scope.index);
      if (scope.author) qs.set("author", scope.author);
      if (viewer) qs.set("viewer", viewer);
      return api<{ items: PostItem[] }>(`/api/posts?${qs}`);
    },
    refetchInterval: 30_000,
  });

export const useComments = (postId: number, enabled: boolean) =>
  useQuery({
    queryKey: ["comments", postId],
    enabled,
    queryFn: () => api<CommentItem[]>(`/api/posts/${postId}/comments`),
  });
