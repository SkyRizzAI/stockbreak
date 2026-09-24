import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateWizard } from "@/components/create/wizard";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create index" };

export default function CreatePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-6">
          <Skeleton className="h-96" />
        </div>
      }
    >
      <CreateWizard />
    </Suspense>
  );
}
