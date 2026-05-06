import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { checkRegistrationOpen } from "@/lib/registration-gate";

const POSITIONS = ["GK","CB","CB","LB","RB","CM","CM","CAM","LW","RW","ST"];

// POST /api/join-team
// Body: { card_id: string, team_id: string }
export async function POST(req: NextRequest) {
  try {
    const { card_id, team_id } = await req.json();
    if (!card_id || !team_id) {
      return NextResponse.json({ error: "card_id and team_id required" }, { status: 400 });
    }

    // Registration gate — locks team joins once the deadline passes or
    // the bracket is seeded.
    const closedReason = await checkRegistrationOpen();
    if (closedReason) return NextResponse.json({ error: closedReason }, { status: 403 });

    const supabase = createAdminClient();

    // Check team isn't full (max 11)
    const { count } = await supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq("team_id", team_id);

    if ((count ?? 0) >= 11) {
      return NextResponse.json({ error: "Team is full (11/11)" }, { status: 403 });
    }

    // Assign position based on current count
    const position = POSITIONS[count ?? 0] ?? "SUB";

    // Update card
    const { data: card, error } = await supabase
      .from("cards")
      .update({ team_id, position })
      .eq("id", card_id)
      .is("team_id", null)           // only if not already on a team
      .select()
      .single();

    if (error || !card) {
      return NextResponse.json(
        { error: "Could not join team — card may already be on a team" },
        { status: 409 }
      );
    }

    return NextResponse.json({ card });
  } catch (err) {
    console.error("join-team error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/join-team
// Body: { card_id: string }
export async function DELETE(req: NextRequest) {
  try {
    const { card_id } = await req.json();
    if (!card_id) {
      return NextResponse.json({ error: "card_id required" }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: card, error } = await supabase
      .from("cards")
      .update({ team_id: null, position: null })
      .eq("id", card_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: "Could not leave team" }, { status: 500 });
    }

    return NextResponse.json({ card });
  } catch (err) {
    console.error("leave-team error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
