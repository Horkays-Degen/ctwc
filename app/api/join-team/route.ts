import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";
import { checkRegistrationOpen } from "@/lib/registration-gate";

// POST /api/join-team
// Body: { card_id: string, team_id: string, position?: string }
//
// Position-first signup model:
//  - Client passes the slot the user picked from the pitch UI.
//  - Server validates the slot exists in the formation AND is free.
//  - Falls back to first-available slot if no position is provided
//    (legacy callers / programmatic seeding).
// 4-3-3 with three CMs (matches the pitch UI slot layout)
const FORMATION_SLOTS = ["GK","LB","CB","CB","RB","CM","CM","CM","LW","ST","RW"] as const;
type Slot = typeof FORMATION_SLOTS[number];

export async function POST(req: NextRequest) {
  try {
    const { card_id, team_id, position } = await req.json();
    if (!card_id || !team_id) {
      return NextResponse.json({ error: "card_id and team_id required" }, { status: 400 });
    }

    // Registration gate — locks team joins once the deadline passes or
    // the bracket is seeded.
    const closedReason = await checkRegistrationOpen();
    if (closedReason) return NextResponse.json({ error: closedReason }, { status: 403 });

    const supabase = createAdminClient();

    // Pull current roster so we can validate the requested slot.
    const { data: roster } = await supabase
      .from("cards")
      .select("position")
      .eq("team_id", team_id);

    const filled = (roster ?? []).map(r => r.position).filter(Boolean) as string[];

    if (filled.length >= 11) {
      return NextResponse.json({ error: "Team is full (11/11)" }, { status: 403 });
    }

    // Build the list of free slots from the formation. Multi-instance
    // positions (CB, CM) are tracked by occurrence count.
    const formationCounts = FORMATION_SLOTS.reduce<Record<string, number>>(
      (acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc; }, {}
    );
    const filledCounts = filled.reduce<Record<string, number>>(
      (acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc; }, {}
    );
    const freeSlots: string[] = [];
    for (const p of Object.keys(formationCounts)) {
      const remaining = (formationCounts[p] ?? 0) - (filledCounts[p] ?? 0);
      for (let i = 0; i < remaining; i++) freeSlots.push(p);
    }

    let chosen: string;
    if (position) {
      // Validate the requested position is part of the formation and free
      if (!FORMATION_SLOTS.includes(position as Slot)) {
        return NextResponse.json({ error: `Unknown position: ${position}` }, { status: 400 });
      }
      if (!freeSlots.includes(position)) {
        return NextResponse.json({ error: `${position} is already taken — pick another` }, { status: 409 });
      }
      chosen = position;
    } else {
      chosen = freeSlots[0] ?? "SUB";
    }

    // Update card — only succeeds if the card isn't already on a team
    const { data: card, error } = await supabase
      .from("cards")
      .update({ team_id, position: chosen })
      .eq("id", card_id)
      .is("team_id", null)
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
// Locked once the bracket is seeded — once a tournament is in progress,
// no one can swap teams or abandon their squad. Same gate as joining.
export async function DELETE(req: NextRequest) {
  try {
    const { card_id } = await req.json();
    if (!card_id) {
      return NextResponse.json({ error: "card_id required" }, { status: 400 });
    }

    // Registration gate also covers leaves — once locked, you're committed
    const closedReason = await checkRegistrationOpen();
    if (closedReason) {
      return NextResponse.json({
        error: "Teams are locked — the bracket has been seeded."
      }, { status: 403 });
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
