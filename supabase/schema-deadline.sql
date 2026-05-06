-- ═══════════════════════════════════════════════════════════════
--  CTWC — Registration deadline
--  Run AFTER schema-tournament.sql
-- ═══════════════════════════════════════════════════════════════

-- Add a registration deadline column to tournament. When NOW() exceeds
-- this timestamp, the mint-card and join-team APIs return 403 to lock
-- in the rosters before the bracket is seeded.
alter table public.tournament
  add column if not exists registration_deadline timestamptz;

-- Default existing single tournament row to a deadline 7 days from now
-- so the gate works immediately if the admin doesn't override it.
update public.tournament
set    registration_deadline = now() + interval '7 days'
where  registration_deadline is null;
