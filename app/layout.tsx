import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CTWC – CT World Cup 2026",
  description: "Fantasy football meets Crypto Twitter. Mint your card, join a team, compete in the CT World Cup.",
  openGraph: {
    title: "CTWC – CT World Cup 2026",
    description: "Fantasy football meets Crypto Twitter.",
    siteName: "CTWC",
  },
  twitter: {
    card: "summary_large_image",
    title: "CTWC – CT World Cup 2026",
    description: "Mint your CT player card and compete.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
