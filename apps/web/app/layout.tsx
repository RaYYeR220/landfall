import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";

const mono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Landfall — deposit addresses that execute on Solana",
  description:
    "One permanent address on every chain. Whatever you send — from a wallet, an exchange or Bitcoin — lands on Solana as shares of a curated USDC vault lending on Kamino and Jupiter Lend. Powered by Aurora Intents.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://landfall.vercel.app"),
  openGraph: { title: "Landfall", description: "Deposit addresses that execute on Solana.", type: "website" },
};

export const viewport: Viewport = { themeColor: "#0a0b0d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" />
      </head>
      <body>
        {children}
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
