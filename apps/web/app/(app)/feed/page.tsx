import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedView } from "@/components/social/feed-view";

export const metadata: Metadata = { title: "Feed" };

export default function FeedPage() {
  // useSearchParams (share link) needs a Suspense boundary.
  return (
    <Suspense>
      <FeedView />
    </Suspense>
  );
}
