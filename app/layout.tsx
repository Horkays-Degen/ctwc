import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ctworldcup.xyz"),
  title: "CTWC – Crypto Twitter World Cup 2026",
  description:
    "Fantasy football meets Crypto Twitter. Your X activity controls your card stats. Join 1 of 32 teams and compete in a 5-week tournament — final lands the day before the World Cup kickoff.",
  openGraph: {
    title: "CTWC – Crypto Twitter World Cup 2026",
    description:
      "Your CT activity. Your player card. The bracket of the year.",
    siteName: "CTWC",
    url: "https://ctworldcup.xyz",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CTWC – Crypto Twitter World Cup 2026",
    description:
      "Your CT activity. Your player card. The bracket of the year.",
    creator: "@horkays",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
