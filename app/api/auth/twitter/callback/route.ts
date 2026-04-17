import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { buildCard, XProfile } from "@/lib/card-engine";

const POSITIONS = ["GK","LB","CB","RB","CDM","CM","CAM","LW","ST","RW"];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ctwc.vercel.app";

  const storedState    = req.cookies.get("x_oauth_state")?.value;
  const codeVerifier   = req.cookies.get("x_code_verifier")?.value;
  const clientId       = process.env.X_CLIENT_ID!;
  const clientSecret   = process.env.X_CLIENT_SECRET!;

  // Validate state + verifier
  if (!code || !state || state !== storedState || !codeVerifier) {
    return NextResponse.redirect(`${appUrl}?error=oauth_failed`);
  }

  // ── Exchange code for access token ───────────────────────────
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:  "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  `${appUrl}/api/auth/twitter/callback`,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    return NextResponse.redirect(`${appUrl}?error=token_failed`);
  }

  const { access_token } = await tokenRes.json();

  // ── Fetch the authenticated user's own profile ───────────────
  const userRes = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=name,username,profile_image_url,public_metrics,verified,verified_type",
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!userRes.ok) {
    console.error("Profile fetch failed:", await userRes.text());
    return NextResponse.redirect(`${appUrl}?error=profile_failed`);
  }

  const { data: u } = await userRes.json();
  if (!u) return NextResponse.redirect(`${appUrl}?error=no_user`);

  const handle   = (u.username ?? "").toLowerCase();
  const supabase = createAdminClient();

  // ── If already claimed, just redirect back ───────────────────
  const { data: existing } = await supabase
    .from("cards").select("*").eq("x_handle", handle).single();

  if (existing) {
    const res = NextResponse.redirect(`${appUrl}?just_claimed=${handle}`);
    res.cookies.delete("x_code_verifier");
    res.cookies.delete("x_oauth_state");
    return res;
  }

  // ── Check pool limit ─────────────────────────────────────────
  const { count } = await supabase
    .from("cards").select("*", { count: "exact", head: true });
  if ((count ?? 0) >= 400) {
    return NextResponse.redirect(`${appUrl}?error=pool_full`);
  }

  // ── Build profile + mint card ────────────────────────────────
  const profile: XProfile = {
    x_handle:     handle,
    display_name: u.name,
    avatar_url:   (u.profile_image_url ?? "").replace("_normal", "_400x400"),
    followers:    u.public_metrics?.followers_count  ?? 0,
    following:    u.public_metrics?.following_count  ?? 0,
    listed_count: u.public_metrics?.listed_count     ?? 0,
    tweet_count:  u.public_metrics?.tweet_count      ?? 0,
    verified:     u.verified ?? (u.verified_type === "blue"),
  };

  const { stats, ovr, tier, badges } = buildCard(profile);
  const position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];

  await supabase.from("cards").insert({
    x_handle:     profile.x_handle,
    display_name: profile.display_name,
    avatar_url:   profile.avatar_url,
    followers:    profile.followers,
    following:    profile.following,
    listed_count: profile.listed_count,
    tweet_count:  profile.tweet_count,
    verified:     profile.verified,
    ovr, tier, position, stats, badges,
  });

  // ── Clear cookies + redirect back to app ────────────────────
  const res = NextResponse.redirect(`${appUrl}?just_claimed=${handle}`);
  res.cookies.delete("x_code_verifier");
  res.cookies.delete("x_oauth_state");
  return res;
}
