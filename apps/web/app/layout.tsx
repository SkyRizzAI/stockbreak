import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { MobileNav } from "@/components/shell/nav";
import { TopBar } from "@/components/shell/top-bar";
import { APP_NAME } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Build, share and join tokenized stock indexes on Solana. All assets are simulated.",
  metadataBase: new URL(process.env.WEB_URL || "http://localhost:3000"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <TopBar />
          <main className="flex-1 pb-20 md:pb-10">{children}</main>
          <footer className="hidden border-t py-4 text-xs text-muted-foreground md:block">
            <div className="mx-auto max-w-[1200px] px-4">
              {APP_NAME} · Assets, prices and history are simulated on localnet/devnet. Not
              investment advice.
            </div>
          </footer>
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
