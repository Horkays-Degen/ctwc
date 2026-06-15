// POST /api/tournament/third-place
// Admin-only: run the 3rd-place playoff between the two Semi-Final losers.
// Stored as round_num=6, match_num=1 with match_data.third_place=true so it
// never collides with the real bracket rounds (1-5). Idempotent-ish: refuses
// if a 3rd-place match already exists (pass {force:true} to re-run).
//
// Requires header: x-admin-pin

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { simulateMatch } from "@/lib/match-engine";
import { refreshCardStats } from "@/lib/refresh-stats";

const ADMIN_PIN = process.env.ADMIN_PIN ?? "ctwc2026";
const TP_ROUND = 6;       // synthetic round for the 3rd-place match
const TP_MATCH = 1;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-pin") !== ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const force = !!body?.force;

  const supabase = createAdminClient();
  const { data: tournament } = await supabase.from("tournament").select("*").limit(1).single();
  if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  // ── Already run? ───────────────────────────────────────────
  const { data: existing } = await supabase
    .from("matches").select("id").eq("round_num", TP_ROUND).eq("match_num", TP_MATCH).maybeSingle();
  if (existing && !force) {
    return NextResponse.json({ error: "3rd-place match already played. Pass {force:true} to re-run." }, { status: 409 });
  }

  // ── Find the two Semi-Final losers ─────────────────────────
  const { data: sfMatches } = await supabase
    .from("matches").select("*").eq("round_num", 4).order("match_num");
  if (!sfMatches || sfMatches.length < 2) {
    return NextResponse.json({ error: "Semi-Finals not complete yet." }, { status: 400 });
  }
  const losers = sfMatches.map((m: any) => {
    if (!m.winner_id) return null;
    return m.winner_id === m.home_id ? m.away_id : m.home_id;
  }).filter(Boolean) as string[];
  if (losers.length < 2) {
    return NextResponse.json({ error: "Could not determine both SF losers." }, { status: 400 });
  }
  const [homeId, awayId] = losers;

  // ── Fetch + refresh cards for both teams ───────────────────
  const { data: rawCards } = await supabase
    .from("cards")
    .select("id,x_handle,display_name,avatar_url,team_id,position,stats,ovr,bonus_ovr,tier,followers,following,listed_count,tweet_count,verified")
    .in("team_id", [homeId, awayId]);
  const cards = await refreshCardStats(rawCards ?? []);

  const cardsByTeam: Record<string, any[]> = {};
  for (const c of (cards ?? [])) {
    (cardsByTeam[c.team_id] ??= []).push(c);
  }
  const SLOT_POSITIONS = ["GK","LB","CB","CB","RB","CM","CM","CM","LW","ST","RW"];
  const buildSlots = (teamId: string) => {
    const teamCards = cardsByTeam[teamId] ?? [];
    const used = new Set<string>();
    return SLOT_POSITIONS.map((pos) => {
      const card = teamCards.find((c: any) => c.position === pos && !used.has(c.id)) || null;
      if (card) used.add(card.id);
      return {
        pos,
        stats:       card?.stats        ?? null,
        ovr:         card?.ovr          ?? 60,
        bonusOvr:    card?.bonus_ovr    ?? 0,
        handle:      card?.x_handle     ?? "unknown",
        displayName: card?.display_name ?? "Unknown",
      };
    });
  };

  // ── Simulate (seed off a fixed id so it's deterministic) ───
  const seedId = `third-place-${homeId}-${awayId}`;
  const result = simulateMatch(homeId, buildSlots(homeId), awayId, buildSlots(awayId), seedId);

  // ── Persist ────────────────────────────────────────────────
  await supabase.from("matches").upsert({
    round_num:  TP_ROUND,
    match_num:  TP_MATCH,
    home_id:    homeId,
    away_id:    awayId,
    home_score: result.homeScore,
    away_score: result.awayScore,
    home_pens:  result.homePens,
    away_pens:  result.awayPens,
    winner_id:  result.winnerId,
    status:     "complete",
    match_data: {
      events:       result.events,
      homeStrength: result.homeStrength,
      awayStrength: result.awayStrength,
      homeStats:    result.homeStats,
      awayStats:    result.awayStats,
      motm:         result.motm,
      third_place:  true,
    },
    played_at: new Date().toISOString(),
  }, { onConflict: "round_num,match_num" });

  return NextResponse.json({
    ok: true,
    thirdPlaceWinner: result.winnerId,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    homePens:  result.homePens,
    awayPens:  result.awayPens,
  });
}
