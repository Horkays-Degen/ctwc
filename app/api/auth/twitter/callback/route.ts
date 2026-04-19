import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { buildCard, XProfile } from "@/lib/card-engine";

const POSITIONS = ["GK","LB","CB","RB","CDM","CM","CAM","LW","ST","RW"];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ctwc.vercel.app";

  const clientId     = process.env.X_CLIENT_ID!;
  const clientSecret = process.env.X_CLIENT_SECRET!;

  // Extract codeVerifier from state (format: nonce|codeVerifier)
  const parts        = (state ?? "").split("|");
  const codeVerifier = parts.length >= 2 ? parts.slice(1).join("|") : null;

  if (!code || !state || !codeVerifier) {
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
    console.error("[twitter/callback] token exchange failed:", tokenRes.status, await tokenRes.text());
    return NextResponse.redirect(`${appUrl}?error=token_failed`);
  }

  const { access_token } = await tokenRes.json();

  // ── Fetch the authenticated user's own profile ───────────────
  const userRes = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=name,username,profile_image_url,public_metrics,verified,verified_type",
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!userRes.ok) {
    console.error("[twitter/callback] profile fetch failed:", userRes.status);
    return NextResponse.redirect(`${appUrl}?error=profile_failed`);
  }

  const { data: u } = await userRes.json();
  if (!u) return NextResponse.redirect(`${appUrl}?error=no_user`);

  const handle   = (u.username ?? "").toLowerCase();

  // ── Fetch recent tweets for real engagement metrics ──────────
  let avgLikes = 0, avgRetweets = 0, avgReplies = 0, avgImpressions = 0;
  try {
    const tweetRes = await fetch(
      `https://api.twitter.com/2/users/${u.id}/tweets?max_results=20&tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    if (tweetRes.ok) {
      const { data: tweets } = await tweetRes.json();
      if (tweets && tweets.length > 0) {
        const avg = (fn: (t: any) => number) => tweets.reduce((s: number, t: any) => s + (fn(t) || 0), 0) / tweets.length;
        avgLikes       = avg(t => t.public_metrics?.like_count);
        avgRetweets    = avg(t => t.public_metrics?.retweet_count);
        avgReplies     = avg(t => t.public_metrics?.reply_count);
        avgImpressions = avg(t => t.public_metrics?.impression_count);
      }
    }
  } catch { /* tweet fetch is best-effort */ }

  const supabase = createAdminClient();

  // ── If already claimed, just redirect back ───────────────────
  const { data: existing } = await supabase
    .from("cards").select("id").eq("x_handle", handle).single();

  if (existing) {
    return NextResponse.redirect(`${appUrl}?just_claimed=${handle}`);
  }

  // ── Check pool limit ─────────────────────────────────────────
  const { count } = await supabase
    .from("cards").select("*", { count: "exact", head: true });
  if ((count ?? 0) >= 400) {
    return NextResponse.redirect(`${appUrl}?error=pool_full`);
  }

  // ── Build profile + mint card ────────────────────────────────
  const profile: XProfile = {
    x_handle:        handle,
    display_name:    u.name,
    avatar_url:      (u.profile_image_url ?? "").replace("_normal", "_400x400"),
    followers:       u.public_metrics?.followers_count  ?? 0,
    following:       u.public_metrics?.following_count  ?? 0,
    listed_count:    u.public_metrics?.listed_count     ?? 0,
    tweet_count:     u.public_metrics?.tweet_count      ?? 0,
    verified:        u.verified ?? (u.verified_type === "blue"),
    avg_likes:       avgLikes,
    avg_retweets:    avgRetweets,
    avg_replies:     avgReplies,
    avg_impressions: avgImpressions,
  };

  const { stats, ovr, tier, badges } = buildCard(profile);
  const position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];

  const { data: newCard, error: insertErr } = await supabase.from("cards").insert({
    x_handle:     profile.x_handle,
    display_name: profile.display_name,
    avatar_url:   profile.avatar_url,
    followers:    profile.followers,
    following:    profile.following,
    listed_count: profile.listed_count,
    tweet_count:  profile.tweet_count,
    verified:     profile.verified,
    ovr, tier, position, stats, badges,
  }).select().single();

  if (insertErr || !newCard) {
    console.error("[twitter/callback] insert failed:", insertErr);
    return NextResponse.redirect(`${appUrl}?error=mint_failed`);
  }

  return NextResponse.redirect(`${appUrl}?just_claimed=${handle}`);
}
