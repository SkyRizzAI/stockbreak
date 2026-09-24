import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { Providers } from "@/components/providers";
import { MobileNav } from "@/components/shell/nav";
import { TopBar } from "@/components/shell/top-bar";
import { APP_NAME } from "@/lib/env";
import "./globals.css";

// Manrope for text and figures (tabular), IBM Plex Mono for tickers and addresses (refs).
const manrope = Manrope({ variable: "--font-sans", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

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
      className={`${manrope.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <TopBar />
          <main className="flex-1 pb-20 md:pb-10">{children}</main>
          <footer className="hidden border-t py-4 text-xs text-muted-foreground md:block">
            <div className="mx-auto max-w-[1280px] px-4 md:px-8">
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
