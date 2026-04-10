// ── Card stats engine — same logic as the original app ───────────
// Takes raw X profile data, returns CTWC card stats + tier

export type XProfile = {
  x_handle: string;
  display_name: string;
  avatar_url: string;
  followers: number;
  following: number;
  listed_count: number;
  tweet_count: number;
  verified: boolean;
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

const clamp = (v: number, lo = 40, hi = 99) =>
  Math.min(hi, Math.max(lo, Math.round(v)));

const normalize = (v: number, max: number, scale = 99) =>
  clamp(Math.log1p(v) / Math.log1p(max) * scale);

export function buildCard(profile: XProfile): { stats: CardStats; ovr: number; tier: TierName; badges: { label: string; color: string }[] } {
  const { followers, following, listed_count, tweet_count, verified } = profile;

  const ffRatio = following > 0 ? followers / following : followers;

  const ENG = normalize(ffRatio,       50000);
  const INF = normalize(followers,     5_000_000);
  const CLT = normalize(listed_count,  50_000);
  const VOL = normalize(tweet_count,   100_000);
  const VRL = normalize(followers * (listed_count > 0 ? listed_count / 1000 : 1), 10_000_000);

  const OVR = clamp(
    Math.round(ENG * 0.20 + INF * 0.30 + CLT * 0.20 + VOL * 0.15 + VRL * 0.15)
  );

  const stats: CardStats = { ENG, INF, CLT, VOL, VRL, OVR };

  // Tier thresholds
  let tier: TierName = "CT Player";
  if (OVR >= 95)      tier = "Mythic";
  else if (OVR >= 88) tier = "CT Legend";
  else if (OVR >= 78) tier = "CT Elite";
  else if (OVR >= 65) tier = "CT Star";

  const badges: { label: string; color: string }[] = [];
  if (verified)          badges.push({ label: "✓ Verified",    color: "#1DA1F2" });
  if (followers > 100_000) badges.push({ label: "100K+ Followers", color: "#F59E0B" });
  if (OVR >= 95)         badges.push({ label: "⚡ Mythic",      color: "#A855F7" });

  return { stats, ovr: OVR, tier, badges };
}
