import type { Metadata } from "next";
import { Suspense } from "react";
import { SignView } from "@/components/pages/sign-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Review & sign" };

export default function SignPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[640px] px-4 py-6">
          <Skeleton className="h-64" />
        </div>
      }
    >
      <SignView />
    </Suspense>
  );
}
