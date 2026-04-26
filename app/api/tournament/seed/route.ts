// POST /api/tournament/seed
// Admin-only: close registration, shuffle teams into bracket, create R32 matches.
// Requires header: x-admin-pin matching ADMIN_PIN env var (default: "ctwc2026")

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { seedBracket, strSeed } from "@/lib/match-engine";

const ADMIN_PIN = process.env.ADMIN_PIN ?? "ctwc2026";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-pin") !== ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // ── Guard: only seed once ──────────────────────────────────
  const { data: existing } = await supabase
    .from("tournament").select("status").limit(1).single();

  if (existing && existing.status !== "registration") {
    return NextResponse.json({ error: "Tournament already seeded/started" }, { status: 409 });
  }

  // ── Fetch all teams ────────────────────────────────────────
  const { data: teams } = await supabase
    .from("teams").select("id,name").order("name");

  if (!teams || teams.length < 2) {
    return NextResponse.json({ error: "Need at least 2 teams" }, { status: 400 });
  }

  // ── Shuffle into bracket order ─────────────────────────────
  const seed    = strSeed("CTWC2026-bracket");
  let s         = seed;
  const rand    = () => {
    s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b));
    s = (Math.imul(s ^ (s >>> 16), 0x45d9f3b));
    s ^= s >>> 16;
    return (s >>> 0) / 0x100000000;
  };

  const allIds  = teams.map(t => t.id);
  // Pad to 32 with nulls if fewer than 32 teams
  while (allIds.length < 32) allIds.push("bye");
  const seeded  = seedBracket(allIds.slice(0, 32), rand);

  // ── Create R32 matches (16 matches) ────────────────────────
  const matchInserts = [];
  for (let i = 0; i < 16; i++) {
    const homeId = seeded[i * 2];
    const awayId = seeded[i * 2 + 1];
    matchInserts.push({
      round_num: 1,
      match_num: i + 1,
      home_id:   homeId === "bye" ? null : homeId,
      away_id:   awayId === "bye" ? null : awayId,
      status:    "scheduled",
    });
  }

  const { error: matchErr } = await supabase.from("matches").insert(matchInserts);
  if (matchErr) {
    console.error("[seed] match insert error:", matchErr);
    return NextResponse.json({ error: "Failed to create matches" }, { status: 500 });
  }

  // ── Update tournament state ────────────────────────────────
  const { error: tErr } = await supabase
    .from("tournament")
    .update({
      status:        "seeded",
      current_round: 1,
      seeding:       seeded,
      started_at:    new Date().toISOString(),
    })
    .eq("status", "registration");

  if (tErr) {
    console.error("[seed] tournament update error:", tErr);
    return NextResponse.json({ error: "Failed to update tournament state" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, seeded, matchCount: matchInserts.length });
}
