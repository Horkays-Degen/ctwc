// POST /api/tournament/simulate
// Admin-only: simulate all scheduled matches in the current round,
// then create next-round match stubs with the winners.
// Requires header: x-admin-pin

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { simulateMatch, ROUND_MATCHES } from "@/lib/match-engine";
import { refreshCardStats } from "@/lib/refresh-stats";

const ADMIN_PIN = process.env.ADMIN_PIN ?? "ctwc2026";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-pin") !== ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // ── Fetch current tournament state ─────────────────────────
  const { data: tournament, error: tErr } = await supabase
    .from("tournament").select("*").limit(1).single();

  if (tErr || !tournament) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  }

  if (tournament.status === "registration") {
    return NextResponse.json({ error: "Bracket not seeded yet — run /seed first" }, { status: 400 });
  }
  if (tournament.status === "complete") {
    return NextResponse.json({ error: "Tournament already complete" }, { status: 409 });
  }

  const round = tournament.current_round as number;

  // ── Fetch scheduled matches for current round ──────────────
  const { data: roundMatches } = await supabase
    .from("matches")
    .select("*")
    .eq("round_num", round)
    .eq("status", "scheduled");

  if (!roundMatches || roundMatches.length === 0) {
    return NextResponse.json({ error: "No scheduled matches in current round" }, { status: 400 });
  }

  // ── Fetch cards for all teams in this round ────────────────
  const teamIds = Array.from(new Set(
    roundMatches.flatMap((m: any) => [m.home_id, m.away_id].filter(Boolean))
  ));

  const { data: rawCards } = await supabase
    .from("cards")
    .select("id,x_handle,display_name,avatar_url,team_id,position,stats,ovr,tier,followers,following,listed_count,tweet_count,verified")
    .in("team_id", teamIds);

  // ── Refresh stats from live Twitter data before simulating ─────
  // This is the core CTWC mechanic: who's hot on CT right now wins.
  const cards = await refreshCardStats(rawCards ?? []);

  // Group cards by team
  const cardsByTeam: Record<string, any[]> = {};
  for (const c of (cards ?? [])) {
    if (!cardsByTeam[c.team_id]) cardsByTeam[c.team_id] = [];
    cardsByTeam[c.team_id].push(c);
  }

  // Build PlayerSlot array for a team — must match the formation used in
  // /api/join-team and the client transformTeam SLOT_POSITIONS.
  const SLOT_POSITIONS = ["GK","LB","CB","CB","RB","CDM","CM","CAM","LW","ST","RW"];
  const buildSlots = (teamId: string) => {
    const teamCards = cardsByTeam[teamId] ?? [];
    // Multi-instance positions (CB×2) consume cards in DB order — same
    // logic as the client's transformTeam.
    const used = new Set<string>();
    return SLOT_POSITIONS.map((pos) => {
      const card = teamCards.find((c: any) => c.position === pos && !used.has(c.id)) || null;
      if (card) used.add(card.id);
      return {
        pos,
        stats:       card?.stats   ?? null,
        ovr:         card?.ovr     ?? 60,
        handle:      card?.x_handle     ?? "unknown",
        displayName: card?.display_name ?? "Unknown",
      };
    });
  };

  // ── Simulate each match ────────────────────────────────────
  const updates: Promise<any>[] = [];
  const results: any[]          = [];

  for (const match of roundMatches) {
    // Handle byes: the team with an opponent advances automatically
    if (!match.home_id || !match.away_id) {
      const winnerId = match.home_id || match.away_id;
      const { error } = await supabase
        .from("matches")
        .update({
          home_score: match.home_id ? 3 : 0,
          away_score: match.away_id ? 3 : 0,
          winner_id:  winnerId,
          status:     "complete",
          match_data: { events: [], bye: true },
          played_at:  new Date().toISOString(),
        })
        .eq("id", match.id);
      results.push({
        matchNum: match.match_num,
        homeId: match.home_id,
        awayId: match.away_id,
        homeScore: match.home_id ? 3 : 0,
        awayScore: match.away_id ? 3 : 0,
        winnerId,
        bye: true,
      });
      continue;
    }

    const homeSlots = buildSlots(match.home_id);
    const awaySlots = buildSlots(match.away_id);
    const result    = simulateMatch(
      match.home_id, homeSlots,
      match.away_id, awaySlots,
      match.id,
    );

    const { error } = await supabase
      .from("matches")
      .update({
        home_score: result.homeScore,
        away_score: result.awayScore,
        home_pens:  result.homePens,
        away_pens:  result.awayPens,
        winner_id:  result.winnerId,
        status:     "complete",
        match_data: {
          events:        result.events,
          homeStrength:  result.homeStrength,
          awayStrength:  result.awayStrength,
          statsRefreshed: !!process.env.X_API_BEARER_TOKEN,
        },
        played_at: new Date().toISOString(),
      })
      .eq("id", match.id);

    if (error) console.error("[simulate] update match error:", error);

    results.push({
      matchNum:     match.match_num,
      homeId:       match.home_id,
      awayId:       match.away_id,
      homeScore:    result.homeScore,
      awayScore:    result.awayScore,
      homePens:     result.homePens,
      awayPens:     result.awayPens,
      winnerId:     result.winnerId,
      events:       result.events,
      homeStrength: result.homeStrength,
      awayStrength: result.awayStrength,
    });
  }

  // ── Advance to next round ──────────────────────────────────
  const nextRound = round + 1;

  if (nextRound > 5) {
    // All rounds done — mark champion
    const finalMatch = results.find(r => r.matchNum === 1);
    await supabase
      .from("tournament")
      .update({ status: "complete", champion_id: finalMatch?.winnerId ?? null })
      .eq("id", tournament.id);

    return NextResponse.json({
      ok: true,
      results,
      round,
      message: "Tournament complete!",
      champion: finalMatch?.winnerId,
      isFinal: true,
    });
  }

  // Build next round match stubs from winners
  // Winners of matches 1,2 → next match 1; winners 3,4 → next match 2, etc.
  const completedMatches = await supabase
    .from("matches")
    .select("match_num,winner_id")
    .eq("round_num", round)
    .order("match_num");

  const winners = (completedMatches.data ?? [])
    .sort((a: any, b: any) => a.match_num - b.match_num)
    .map((m: any) => m.winner_id);

  const nextMatchCount = Math.ceil(winners.length / 2);
  const nextMatchInserts = [];

  for (let i = 0; i < nextMatchCount; i++) {
    nextMatchInserts.push({
      round_num: nextRound,
      match_num: i + 1,
      home_id:   winners[i * 2]     ?? null,
      away_id:   winners[i * 2 + 1] ?? null,
      status:    "scheduled",
    });
  }

  if (nextMatchInserts.length > 0) {
    await supabase
      .from("matches")
      .upsert(nextMatchInserts, { onConflict: "round_num,match_num", ignoreDuplicates: true });
  }

  // Update tournament round
  await supabase
    .from("tournament")
    .update({ current_round: nextRound, status: "active" })
    .eq("id", tournament.id);

  return NextResponse.json({
    ok: true,
    results,
    round,
    nextRound,
    isFinal: false,
    statsRefreshed: !!process.env.X_API_BEARER_TOKEN,
    message: `Round ${round} complete. Moving to round ${nextRound}.`,
  });
}
