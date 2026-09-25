import type { Metadata } from "next";
import { ProfileView } from "@/components/pages/profile-view";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ params }: PageProps<"/u/[wallet]">) {
  const { wallet } = await params;
  return <ProfileView wallet={wallet} />;
}
