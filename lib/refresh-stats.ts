// lib/refresh-stats.ts
// Pre-round stat refresh: pulls live Twitter profile + recent tweet metrics,
// recalculates CT stats via card-engine, updates DB rows.
// Called by the simulate route before each round so match results reflect
// real-time CT activity — not locked registration-time snapshots.

import { buildCard, XProfile } from "./card-engine";
import { createAdminClient } from "./supabase-server";

const BEARER = process.env.X_API_BEARER_TOKEN;

async function twitterGet(url: string): Promise<any | null> {
  if (!BEARER) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${BEARER}` },
      // Next.js: bypass cache so we always get fresh data
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[refresh-stats] Twitter API", res.status, url);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn("[refresh-stats] fetch error:", err);
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────
interface RawCard {
  id: string;
  x_handle: string;
  avatar_url?: string;
  followers?: number;
  following?: number;
  listed_count?: number;
  tweet_count?: number;
  verified?: boolean;
  stats?: any;
  ovr?: number;
  tier?: string;
  position?: string;
  team_id?: string;
  display_name?: string;
}

// ── Main export ───────────────────────────────────────────────────
// Takes existing card rows (from DB), fetches fresh Twitter data,
// recalculates stats and returns updated rows.
// Also persists the new stats to Supabase in the background.
export async function refreshCardStats(cards: RawCard[]): Promise<RawCard[]> {
  if (!BEARER || cards.length === 0) {
    console.log("[refresh-stats] No bearer token or no cards — skipping refresh");
    return cards;
  }

  const updated: RawCard[] = JSON.parse(JSON.stringify(cards)); // deep clone

  // ── Step 1: Batch-fetch fresh profiles (up to 100 per request) ──
  const twitterIdMap: Record<string, string> = {}; // handle → twitter user ID
  const profileMap:   Record<string, any>    = {}; // handle → twitter user object

  for (let i = 0; i < cards.length; i += 100) {
    const batch   = cards.slice(i, i + 100).map(c => c.x_handle).join(",");
    const data    = await twitterGet(
      `https://api.twitter.com/2/users/by?usernames=${batch}` +
      `&user.fields=id,name,public_metrics,verified,verified_type`
    );
    for (const u of (data?.data ?? [])) {
      const handle = (u.username as string).toLowerCase();
      profileMap[handle]   = u;
      twitterIdMap[handle] = u.id;
    }
  }

  // ── Step 2: Per-user recent tweet metrics (last 10 tweets) ──────
  // We need to fetch each user individually — no batch endpoint for timelines.
  // For a round this is ≤ 22 players, totally fine on Basic tier.
  const tweetMetrics: Record<string, {
    avg_likes: number; avg_retweets: number;
    avg_replies: number; avg_impressions: number;
  }> = {};

  await Promise.allSettled(cards.map(async (card) => {
    const uid = twitterIdMap[card.x_handle];
    if (!uid) return;

    const data = await twitterGet(
      `https://api.twitter.com/2/users/${uid}/tweets` +
      `?max_results=10&tweet.fields=public_metrics`
    );
    const tweets: any[] = data?.data ?? [];
    if (tweets.length === 0) return;

    const avg = (fn: (t: any) => number) =>
      tweets.reduce((s, t) => s + fn(t), 0) / tweets.length;

    const avg_likes     = avg(t => t.public_metrics?.like_count    ?? 0);
    const avg_retweets  = avg(t => t.public_metrics?.retweet_count  ?? 0);
    const avg_replies   = avg(t => t.public_metrics?.reply_count    ?? 0);

    // Impressions aren't public via basic bearer — estimate them.
    // Twitter's median engagement rate for active CT accounts ≈ 2–5%.
    // We use 3.5% as a conservative floor so ENG/VRL stay realistic.
    const totalEng      = avg_likes + avg_retweets + avg_replies;
    const avg_impressions = totalEng > 0 ? totalEng / 0.035 : 0;

    tweetMetrics[card.x_handle] = {
      avg_likes, avg_retweets, avg_replies, avg_impressions,
    };
  }));

  // ── Step 3: Rebuild stats for each card ─────────────────────────
  for (let i = 0; i < cards.length; i++) {
    const card   = cards[i];
    const u      = profileMap[card.x_handle];
    const tweets = tweetMetrics[card.x_handle];

    // If Twitter didn't return this user (private, suspended, etc.) keep old stats
    if (!u) continue;

    const profile: XProfile = {
      x_handle:    card.x_handle,
      display_name: u.name ?? card.display_name ?? card.x_handle,
      avatar_url:   card.avatar_url ?? "",          // preserve existing avatar
      followers:    u.public_metrics?.followers_count  ?? card.followers  ?? 0,
      following:    u.public_metrics?.following_count   ?? card.following  ?? 0,
      listed_count: u.public_metrics?.listed_count      ?? card.listed_count ?? 0,
      tweet_count:  u.public_metrics?.tweet_count        ?? card.tweet_count  ?? 0,
      verified:     u.verified || (u.verified_type === "blue") || card.verified || false,
      // Live engagement metrics (undefined if we couldn't fetch tweets)
      avg_likes:        tweets?.avg_likes,
      avg_retweets:     tweets?.avg_retweets,
      avg_replies:      tweets?.avg_replies,
      avg_impressions:  tweets?.avg_impressions,
    };

    const built = buildCard(profile);

    updated[i] = {
      ...card,
      followers:    profile.followers,
      following:    profile.following,
      listed_count: profile.listed_count,
      tweet_count:  profile.tweet_count,
      verified:     profile.verified,
      stats:        built.stats,
      ovr:          built.ovr,
      tier:         built.tier,
      // Keep position locked — changing mid-tournament would scramble slots
    };
  }

  // ── Step 4: Persist refreshed stats to DB (fire-and-forget) ─────
  // Don't await — simulation can proceed immediately with in-memory data.
  persistRefresh(updated).catch(err =>
    console.error("[refresh-stats] persist error:", err)
  );

  const refreshed = updated.filter((u, i) => u.stats !== cards[i].stats).length;
  console.log(`[refresh-stats] refreshed ${refreshed}/${cards.length} cards with live Twitter data`);

  return updated;
}

async function persistRefresh(cards: RawCard[]) {
  const supabase = createAdminClient();
  // Batch upsert updated stats
  await Promise.allSettled(cards.map(card =>
    supabase.from("cards").update({
      followers:    card.followers,
      following:    card.following,
      listed_count: card.listed_count,
      tweet_count:  card.tweet_count,
      verified:     card.verified,
      stats:        card.stats,
      ovr:          card.ovr,
      tier:         card.tier,
    }).eq("id", card.id)
  ));
}
