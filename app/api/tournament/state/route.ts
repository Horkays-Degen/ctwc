import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

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
    });
  } catch (err) {
    console.error("[tournament/state]", err);
    return NextResponse.json({ error: "Failed to fetch tournament state" }, { status: 500 });
  }
}
