import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/lib/env";
import "./globals.css";

// Instrument Sans for text, JetBrains Mono for figures, tickers and addresses, Instrument
// Serif for a few editorial accents (refs Editorial Minimalist, D053).
const sans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const serif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Build, share and join tokenized stock indexes on Solana. All assets are simulated.",
  // Same fallback as serverEnv(): an explicit WEB_URL, else Vercel's production domain.
  metadataBase: new URL(
    process.env.WEB_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  ),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
