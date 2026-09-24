import type { Metadata } from "next";
import { Suspense } from "react";
import { CreateWizard } from "@/components/create/wizard";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create index" };

export default function CreatePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
          <Skeleton className="h-96" />
        </div>
      }
    >
      <CreateWizard />
    </Suspense>
  );
}
