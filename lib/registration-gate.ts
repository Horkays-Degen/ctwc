// lib/registration-gate.ts
// Single source of truth for whether new mints / team joins are allowed.
// Returns null if registration is open, or an error string if locked.
//
// Locks if EITHER:
//   • tournament.status is no longer "registration"  (bracket already seeded)
//   • registration_deadline has passed

import { createAdminClient } from "./supabase-server";

export async function checkRegistrationOpen(): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: t } = await supabase
    .from("tournament")
    .select("status, registration_deadline")
    .limit(1)
    .single();

  if (!t) return null; // no tournament row yet — let it through

  if (t.status && t.status !== "registration") {
    return "Registration is closed — bracket already seeded.";
  }

  if (t.registration_deadline) {
    const deadlineMs = new Date(t.registration_deadline).getTime();
    if (Date.now() > deadlineMs) {
      return "Registration deadline has passed.";
    }
  }

  return null; // open
}
