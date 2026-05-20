-- ═══════════════════════════════════════════════════════════════
--  CTWC: Fix unrealistic card counts in existing match data
--  Football rules: 1 yellow = warning, 2nd yellow = automatic red.
--  Players currently showing 3+ yellows in a single match get fixed:
--    keep first yellow, convert 2nd to red, drop the rest.
--  Direct reds are preserved as-is.
--  Aggregate yellowCards/redCards counts in match_data are recomputed.
-- ═══════════════════════════════════════════════════════════════

do $$
declare
  m record;
  events_arr jsonb;
  fixed_events jsonb;
  new_event jsonb;
  player_yellow_count jsonb := '{}'::jsonb;
  player_sent_off jsonb := '{}'::jsonb;
  ev jsonb;
  scorer text;
  type_str text;
  team_str text;
  yc_home int;
  yc_away int;
  rc_home int;
  rc_away int;
begin
  for m in
    select id, match_data
    from public.matches
    where status = 'complete'
      and match_data ? 'events'
      and jsonb_array_length(coalesce(match_data->'events', '[]'::jsonb)) > 0
  loop
    events_arr := coalesce(m.match_data->'events', '[]'::jsonb);
    fixed_events := '[]'::jsonb;
    player_yellow_count := '{}'::jsonb;
    player_sent_off := '{}'::jsonb;
    yc_home := 0; yc_away := 0; rc_home := 0; rc_away := 0;

    for ev in select * from jsonb_array_elements(events_arr)
    loop
      scorer   := ev->>'scorer';
      type_str := ev->>'type';
      team_str := ev->>'team';

      -- Goals always pass through unchanged
      if type_str = 'goal' or type_str is null then
        fixed_events := fixed_events || ev;
        continue;
      end if;

      -- Direct red — preserve, mark sent off
      if type_str = 'red' then
        -- If player was already sent off via 2nd yellow, skip duplicate red
        if (player_sent_off ? scorer) then
          continue;
        end if;
        player_sent_off := player_sent_off || jsonb_build_object(scorer, true);
        fixed_events := fixed_events || ev;
        if team_str = 'home' then rc_home := rc_home + 1; else rc_away := rc_away + 1; end if;
        continue;
      end if;

      -- Yellow card processing — apply football rules
      if type_str = 'yellow' then
        -- Already sent off? skip
        if (player_sent_off ? scorer) then
          continue;
        end if;

        declare
          current_yellows int := coalesce((player_yellow_count->>scorer)::int, 0);
        begin
          if current_yellows >= 2 then
            -- Already on 2 yellows (and sent off) — should never happen
            continue;
          end if;

          if current_yellows = 0 then
            -- First yellow: keep, count it
            player_yellow_count := player_yellow_count || jsonb_build_object(scorer, 1);
            fixed_events := fixed_events || ev;
            if team_str = 'home' then yc_home := yc_home + 1; else yc_away := yc_away + 1; end if;
          else
            -- Second yellow: convert to red, mark sent off, add red event
            -- preserve original yellow count (still count the 2nd yellow as displayed)
            player_yellow_count := player_yellow_count || jsonb_build_object(scorer, 2);
            player_sent_off := player_sent_off || jsonb_build_object(scorer, true);

            -- Add the 2nd yellow event
            fixed_events := fixed_events || ev;
            if team_str = 'home' then yc_home := yc_home + 1; else yc_away := yc_away + 1; end if;

            -- Add the automatic red event right after
            new_event := jsonb_build_object(
              'minute',     ev->'minute',
              'team',       team_str,
              'type',       'red',
              'scorer',     scorer,
              'scorerName', ev->'scorerName'
            );
            fixed_events := fixed_events || new_event;
            if team_str = 'home' then rc_home := rc_home + 1; else rc_away := rc_away + 1; end if;
          end if;
        end;
      end if;
    end loop;

    -- Update the match with fixed events + corrected stat counts
    update public.matches
    set match_data = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(m.match_data, '{events}', fixed_events),
            '{homeStats,yellowCards}', to_jsonb(yc_home)
          ),
          '{homeStats,redCards}', to_jsonb(rc_home)
        ),
        '{awayStats,yellowCards}', to_jsonb(yc_away)
      ),
      '{awayStats,redCards}', to_jsonb(rc_away)
    )
    where id = m.id;
  end loop;

  raise notice 'Card discipline fix complete';
end $$;

-- Verify: should show no player with > 1 yellow card in a single match
-- after the fix (the 2nd is now a red)
select
  m.id,
  (e->>'scorer') as player,
  (e->>'type')   as card_type,
  count(*)       as count_per_match
from public.matches m,
     lateral jsonb_array_elements(coalesce(m.match_data->'events', '[]'::jsonb)) e
where m.status = 'complete' and (e->>'type') in ('yellow','red')
group by m.id, e->>'scorer', e->>'type'
having count(*) > 1
order by count_per_match desc;
