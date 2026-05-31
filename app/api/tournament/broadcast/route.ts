// POST /api/tournament/broadcast
// Admin-only: manually start, end, or restart a live broadcast.
// Body: { action: "start" | "end", round?: number }
//   - start: sets broadcast_started_at = now() and broadcast_active = true
//   - end:   sets broadcast_active = false (matches stay in DB; people who
//            missed the live window can still see scores in the bracket)
//
// Useful for re-airing a finished broadcast, or stopping one early.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

const ADMIN_PIN = process.env.ADMIN_PIN ?? "ctwc2026";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-pin") !== ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = body?.action;
  if (!["start","end"].includes(action)) {
    return NextResponse.json({ error: "action must be 'start' or 'end'" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: tournament } = await supabase.from("tournament").select("id, current_round").limit(1).single();
  if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  if (action === "start") {
    const round = body?.round ?? tournament.current_round;
    await supabase.from("tournament").update({
      broadcast_started_at: new Date().toISOString(),
      broadcast_round:      round,
      broadcast_active:     true,
    }).eq("id", tournament.id);
    return NextResponse.json({ ok: true, action: "start", round });
  }

  // end
  await supabase.from("tournament").update({
    broadcast_active: false,
  }).eq("id", tournament.id);
  return NextResponse.json({ ok: true, action: "end" });
}
