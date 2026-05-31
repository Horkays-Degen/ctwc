-- ═══════════════════════════════════════════════════════════════
--  CTWC — Live broadcast columns
--  Adds the timing reference for the synchronized live match player
--  that drives the /watch page from QF onwards.
--
--  When admin simulates QF/SF/Final:
--    broadcast_started_at = now()
--    broadcast_round      = the round being broadcast
--    broadcast_active     = true
--
--  Clients compute which match is currently playing + the simulated
--  minute by reading broadcast_started_at and comparing to wall clock.
-- ═══════════════════════════════════════════════════════════════

alter table public.tournament
  add column if not exists broadcast_started_at timestamptz,
  add column if not exists broadcast_round       int,
  add column if not exists broadcast_active      boolean default false;
