// GET /api/avatar-proxy?url=<encoded-url>
//
// Fetches an external image and re-serves it with CORS headers so that
// html-to-image (used for shareable card PNG export) can draw it to canvas.
// Twitter avatar CDN (pbs.twimg.com) and unavatar.io block direct canvas
// access without CORS, breaking client-side image capture.
//
// Caches aggressively — avatars rarely change for a given handle.

import { NextRequest, NextResponse } from "next/server";

// Allowed source hosts — keeps the proxy from being abused as an open relay
const ALLOWED_HOSTS = new Set([
  "pbs.twimg.com",
  "abs.twimg.com",
  "unavatar.io",
  "douckfkffjxpptkuoraj.supabase.co", // our own storage, just in case
]);

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Missing url param", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new NextResponse("Host not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      // Pass through any cache headers but rely on Next's runtime cache too
      headers: { "User-Agent": "CTWC-Avatar-Proxy/1.0" },
      // 14-day revalidate window
      next: { revalidate: 60 * 60 * 24 * 14 },
    });

    if (!upstream.ok) {
      return new NextResponse("Upstream error: " + upstream.status, { status: 502 });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";

    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[avatar-proxy] fetch error:", err);
    return new NextResponse("Fetch failed", { status: 500 });
  }
}
