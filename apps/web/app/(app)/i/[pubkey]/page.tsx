import { getIndex } from "@repo/db";
import type { Metadata } from "next";
import { IndexView } from "@/components/index/index-view";
import { db } from "@/lib/server/ctx";

export async function generateMetadata({ params }: PageProps<"/i/[pubkey]">): Promise<Metadata> {
  const { pubkey } = await params;
  try {
    const row = await getIndex(db(), pubkey);
    if (!row) return { title: "Index" };
    const title = `${row.name} (${row.symbol})`;
    return {
      title,
      description: row.description ?? "Tokenized stock index. Simulated assets.",
      openGraph: { title, description: row.description ?? undefined },
      twitter: { card: "summary_large_image", title },
    };
  } catch {
    return { title: "Index" };
  }
}

export default async function IndexPage({ params }: PageProps<"/i/[pubkey]">) {
  const { pubkey } = await params;
  return <IndexView pubkey={pubkey} />;
}
