import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Landfall", description: "Deposit addresses that execute on Solana." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
