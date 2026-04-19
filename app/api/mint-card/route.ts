import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { buildCard, XProfile } from "@/lib/card-engine";

export async function POST(req: NextRequest) {
  try {
    const { x_handle } = await req.json();
    if (!x_handle || typeof x_handle !== "string") {
      return NextResponse.json({ error: "x_handle is required" }, { status: 400 });
    }
    const handle = x_handle.replace(/^@/, "").toLowerCase().trim();
    const supabase = createAdminClient();

    const { data: existing } = await supabase.from("cards").select("*").eq("x_handle", handle).single();
    if (existing) return NextResponse.json({ card: existing, cached: true });

    const { count } = await supabase.from("cards").select("*", { count: "exact", head: true });
    if ((count ?? 0) >= 400) return NextResponse.json({ error: "Pool is full (400/400)" }, { status: 403 });

    const bearerToken = process.env.X_API_BEARER_TOKEN;
    let profile: XProfile;

    if (!bearerToken) {
      const seed = handle.split("").reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0);
      const rand = (min: number, max: number) => min + ((seed * 9301 + 49297) % (max - min));
      profile = {
        x_handle: handle,
        display_name: handle.charAt(0).toUpperCase() + handle.slice(1),
        avatar_url: "https://unavatar.io/twitter/" + handle,
        followers: rand(500, 250000),
        following: rand(100, 5000),
        listed_count: rand(10, 2000),
        tweet_count: rand(200, 50000),
        verified: seed % 7 === 0,
      };
    } else {
      const xRes = await fetch(
        "https://api.twitter.com/2/users/by/username/" + handle + "?user.fields=name,profile_image_url,public_metrics,verified,verified_type",
        { headers: { Authorization: "Bearer " + bearerToken } }
      );
      if (!xRes.ok) {
        const err = await xRes.json();
        return NextResponse.json({ error: err?.errors?.[0]?.detail ?? "X API error" }, { status: xRes.status });
      }
      const xData = await xRes.json();
      const u = xData.data;
      if (!u) return NextResponse.json({ error: "X user not found" }, { status: 404 });
      profile = {
        x_handle: handle,
        display_name: u.name,
        avatar_url: (u.profile_image_url ?? "").replace("_normal", "_400x400"),
        followers: u.public_metrics?.followers_count ?? 0,
        following: u.public_metrics?.following_count ?? 0,
        listed_count: u.public_metrics?.listed_count ?? 0,
        tweet_count: u.public_metrics?.tweet_count ?? 0,
        verified: u.verified ?? (u.verified_type === "blue"),
      };
    }

    const { stats, ovr, tier, badges, position } = buildCard(profile);
    const { data: card, error: insertErr } = await supabase.from("cards").insert({
      x_handle: profile.x_handle,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      followers: profile.followers,
      following: profile.following,
      listed_count: profile.listed_count,
      tweet_count: profile.tweet_count,
      verified: profile.verified,
      ovr, tier, position, stats, badges,
    }).select().single();

    if (insertErr) return NextResponse.json({ error: "Failed to save card" }, { status: 500 });
    return NextResponse.json({ card, cached: false });
  } catch (err) {
    console.error("mint-card error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}