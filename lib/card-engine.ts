// ── CTWC Card Engine ─────────────────────────────────────────────
// Calibrated for active CT participants, not mega-whales.
// Realistic ceilings: 200k followers, 150k tweets, 10k listed, 15% eng rate.

export type XProfile = {
  x_handle:        string;
  display_name:    string;
  avatar_url:      string;
  followers:       number;
  following:       number;
  listed_count:    number;
  tweet_count:     number;
  verified:        boolean;
  // Optional — fetched from user timeline on OAuth mint
  avg_likes?:       number;
  avg_retweets?:    number;
  avg_replies?:     number;
  avg_impressions?: number;
};

export type CardStats = {
  ENG: number; // Engagement
  INF: number; // Influence
  CLT: number; // Clout
  VOL: number; // Volume
  VRL: number; // Viral reach
  OVR: number; // Overall
};

export type TierName = "CT Player" | "CT Star" | "CT Elite" | "CT Legend" | "Mythic";

// ── Helpers ───────────────────────────────────────────────────────
const clamp  = (v: number, lo = 40, hi = 99) => Math.min(hi, Math.max(lo, Math.round(v)));
// Logarithmic scale — compresses the long tail while keeping resolution at the low end
const logNorm = (v: number, max: number) =>
  clamp(Math.log1p(v) / Math.log1p(max) * 99);

// ── Position assignment (stat-driven, deterministic per handle) ───
function assignPosition(stats: CardStats, handle: string): string {
  const { ENG, INF, CLT, VOL, VRL } = stats;
  // Deterministic tie-breaker from handle chars so same user always gets same pos
  const h = handle.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = (opts: string[]) => opts[h % opts.length];

  if (INF >= 82)                        return "GK";          // big accounts anchor the goal
  if (ENG >= 78 && VOL >= 78)           return "ST";          // prolific + high engagement
  if (VRL >= 78 && ENG >= 65)           return pick(["LW","RW"]);  // viral wings
  if (ENG >= 72)                        return "CAM";         // creative, engaging
  if (VOL >= 78 && CLT >= 60)           return "CDM";         // engine: high vol + clout
  if (VOL >= 65 && ENG >= 55)           return "CM";          // versatile midfielder
  if (CLT >= 68)                        return "CB";          // authoritative, well-listed
  if (CLT >= 52)                        return pick(["LB","RB"]); // community connectors
  return "CM";                                                 // default
}

// ── Main builder ──────────────────────────────────────────────────
export function buildCard(profile: XProfile): {
  stats: CardStats; ovr: number; tier: TierName;
  badges: { label: string; color: string }[];
  position: string;
} {
  const { followers, following, listed_count, tweet_count, verified } = profile;

  const hasEng = (profile.avg_impressions ?? 0) > 0;

  // ── INF: follower reach — ceiling 200k ───────────────────────
  const INF = logNorm(followers, 200_000);

  // ── CLT: listed count authority — ceiling 10k ────────────────
  const CLT = logNorm(listed_count, 10_000);

  // ── VOL: posting volume — ceiling 150k ───────────────────────
  const VOL = logNorm(tweet_count, 150_000);

  // ── ENG: engagement — real rate preferred, FF ratio fallback ─
  // Real:     (likes + rts + replies) / impressions × 100, ceiling 15%
  // Fallback: followers / following ratio, ceiling 200
  const ffRatio = following > 0 ? followers / following : Math.min(followers, 200);
  const engRate = hasEng
    ? ((profile.avg_likes! + profile.avg_retweets! + (profile.avg_replies ?? 0))
       / profile.avg_impressions!) * 100
    : 0;
  const ENG = hasEng ? logNorm(engRate, 15) : logNorm(ffRatio, 200);

  // ── VRL: viral reach — real: rts×log(followers), fallback: followers×log(listed) ─
  const VRL = hasEng
    ? logNorm((profile.avg_retweets! + (profile.avg_replies ?? 0)) * Math.log1p(followers), 50_000)
    : logNorm(followers * Math.log1p(listed_count + 1), 300_000);

  // ── OVR — weighted blend ──────────────────────────────────────
  let rawOvr = Math.round(
    ENG * 0.25 +
    INF * 0.25 +
    CLT * 0.20 +
    VOL * 0.15 +
    VRL * 0.15,
  );

  // Verified badge = +8 (meaningful but not game-breaking)
  if (verified) rawOvr += 8;

  const OVR = clamp(rawOvr);

  // ── Stats object ─────────────────────────────────────────────
  const stats: CardStats = { ENG, INF, CLT, VOL, VRL, OVR };

  // ── Tier ─────────────────────────────────────────────────────
  let tier: TierName = "CT Player";
  if      (OVR >= 93) tier = "Mythic";
  else if (OVR >= 83) tier = "CT Legend";
  else if (OVR >= 73) tier = "CT Elite";
  else if (OVR >= 60) tier = "CT Star";

  // ── Position ─────────────────────────────────────────────────
  const position = assignPosition(stats, profile.x_handle);

  // ── Badges ───────────────────────────────────────────────────
  const badges: { label: string; color: string }[] = [];
  if (verified)               badges.push({ label: "✓ Verified",      color: "#1DA1F2" });
  if (followers >= 100_000)   badges.push({ label: "100K+ Followers",  color: "#F59E0B" });
  if (hasEng && engRate >= 5) badges.push({ label: "🔥 High Eng.",     color: "#EF4444" });
  if (OVR >= 93)              badges.push({ label: "⚡ Mythic",         color: "#A855F7" });

  return { stats, ovr: OVR, tier, badges, position };
}
