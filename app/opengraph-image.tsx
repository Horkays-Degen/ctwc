// Dynamic OG image for /
// When someone pastes ctworldcup.xyz on X / Discord / etc., this is what
// the link preview shows. Generated at request time using @vercel/og runtime
// (no static png to maintain).

import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "CTWC — Crypto Twitter World Cup 2026";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0a1424 0%, #04060d 60%, #1a0a00 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Gold radial glow */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 55%, rgba(212,165,55,0.18) 0%, transparent 65%)",
            display: "flex",
          }}
        />

        {/* Top label */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 12,
            color: "rgba(255,255,255,0.5)",
            marginBottom: 24,
          }}
        >
          CTWC 2026
        </div>

        {/* Main title */}
        <div
          style={{
            fontSize: 100,
            fontWeight: 900,
            color: "#fff",
            letterSpacing: -3,
            lineHeight: 1.05,
            textAlign: "center",
            display: "flex",
          }}
        >
          Crypto Twitter
        </div>
        <div
          style={{
            fontSize: 100,
            fontWeight: 900,
            color: "#FBBF24",
            letterSpacing: -3,
            lineHeight: 1.05,
            textAlign: "center",
            marginBottom: 30,
            display: "flex",
          }}
        >
          World Cup
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            textAlign: "center",
            maxWidth: 900,
            lineHeight: 1.4,
            display: "flex",
          }}
        >
          Your CT activity. Your player card. The bracket of the year.
        </div>

        {/* Bottom strip */}
        <div
          style={{
            position: "absolute",
            bottom: 38,
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 4,
            color: "#FBBF24",
          }}
        >
          <span>32 TEAMS</span>
          <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
          <span>5 ROUNDS</span>
          <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
          <span>ctworldcup.xyz</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
