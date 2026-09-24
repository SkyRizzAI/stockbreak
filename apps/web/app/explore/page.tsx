import type { Metadata } from "next";
import { Suspense } from "react";
import { RowsSkeleton } from "@/components/data/states";
import { ExploreView } from "./view";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
          <RowsSkeleton rows={8} />
        </div>
      }
    >
      <ExploreView />
    </Suspense>
  );
}
