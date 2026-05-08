-- ═══════════════════════════════════════════════════════════════
--  CTWC — Tournament progression bonus
--  Run AFTER schema-deadline.sql
-- ═══════════════════════════════════════════════════════════════
--
-- Awards a per-card OVR bonus when their team wins a tournament round.
-- Champions accumulate boosts that compound across rounds, creating
-- visible "tournament heroes" with progressively stronger cards.
--
-- Bonus schedule (applied in simulate route):
--   R16 win → +3 each card
--   QF  win → +3 each card  (cumulative +6)
--   SF  win → +3 each card  (cumulative +9)
--   Final win → +5 each card (cumulative +14, champion)

alter table public.cards
  add column if not exists bonus_ovr int not null default 0;

-- Index helps the simulate route quickly increment by team.
create index if not exists cards_team_id_idx on public.cards(team_id);
