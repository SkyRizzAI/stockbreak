import { indexCardImage } from "@/lib/server/index-card";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Index card";

export default async function Image({ params }: { params: Promise<{ pubkey: string }> }) {
  return indexCardImage((await params).pubkey);
}
