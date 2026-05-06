// POST /api/tournament/deadline
// Admin-only: set the registration deadline. After this timestamp passes,
// /api/mint-card and /api/join-team return 403 to lock rosters.
//
// Body: { deadline: ISO-8601 string }
// Header: x-admin-pin

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

const ADMIN_PIN = process.env.ADMIN_PIN ?? "ctwc2026";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-admin-pin") !== ADMIN_PIN) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const deadline = body?.deadline;
  if (!deadline) return NextResponse.json({ error: "Missing deadline" }, { status: 400 });

  const dt = new Date(deadline);
  if (Number.isNaN(dt.getTime())) return NextResponse.json({ error: "Invalid deadline format" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: tournament } = await supabase.from("tournament").select("id").limit(1).single();
  if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });

  await supabase.from("tournament")
    .update({ registration_deadline: dt.toISOString() })
    .eq("id", tournament.id);

  return NextResponse.json({ ok: true, deadline: dt.toISOString() });
}
