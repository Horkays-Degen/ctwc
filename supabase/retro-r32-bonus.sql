-- ═══════════════════════════════════════════════════════════════
--  CTWC: Retroactive R32 winner bonus
--  R32 already played WITHOUT the +2 progression bonus. This SQL
--  adds +2 to every card on R32-winning teams so the new schedule
--  is consistent: every advancing team gets boosted from R32 onwards.
--
--  Run ONCE. Re-running would add another +2.
-- ═══════════════════════════════════════════════════════════════

update public.cards
set    bonus_ovr = bonus_ovr + 2
where  team_id in (
  select distinct winner_id
  from   public.matches
  where  round_num = 1
    and  status = 'complete'
    and  winner_id is not null
);

-- Verify: how many cards got boosted
select count(*) as r32_winners_boosted
from public.cards
where bonus_ovr >= 2;

-- Spot check: a few cards from a winning team
select x_handle, display_name, ovr, bonus_ovr, team_id
from public.cards
where bonus_ovr > 0
order by bonus_ovr desc, ovr desc
limit 10;
