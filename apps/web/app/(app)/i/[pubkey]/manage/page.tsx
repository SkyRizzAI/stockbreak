import type { Metadata } from "next";
import { ManageView } from "@/components/index/manage-view";

export const metadata: Metadata = { title: "Manage index" };

export default async function ManagePage({ params }: PageProps<"/i/[pubkey]/manage">) {
  const { pubkey } = await params;
  return <ManageView pubkey={pubkey} />;
}
