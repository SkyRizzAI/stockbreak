import type { Metadata } from "next";
import { Suspense } from "react";
import { SignView } from "@/components/pages/sign-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Review & sign" };

export default function SignPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-10 xl:px-14">
          <Skeleton className="h-64" />
        </div>
      }
    >
      <SignView />
    </Suspense>
  );
}
