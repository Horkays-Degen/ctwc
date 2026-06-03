import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

// Never cache this — it drives the live broadcast + bracket state. A cached
// response would serve stale broadcast flags / scores to clients.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: NextRequest) {
  try {
    const supabase = createAdminClient();

    const [{ data: tournament }, { data: matches }, { data: teams }] = await Promise.all([
      supabase.from("tournament").select("*").limit(1).single(),
      supabase.from("matches").select("*").order("round_num").order("match_num"),
      supabase.from("teams").select("id,name,color,emblem,logo_img"),
    ]);

    return NextResponse.json({
      tournament: tournament ?? { status: "registration", current_round: 0, seeding: [] },
      matches:    matches    ?? [],
      teams:      teams      ?? [],
    }, {
      headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
    });
  } catch (err) {
    console.error("[tournament/state]", err);
    return NextResponse.json({ error: "Failed to fetch tournament state" }, { status: 500 });
  }
}
