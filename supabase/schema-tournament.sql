-- ═══════════════════════════════════════════════════════════════
--  CTWC Tournament Schema — Run AFTER schema.sql
--  supabase.com → SQL Editor → run this
-- ═══════════════════════════════════════════════════════════════

-- ─── TOURNAMENT STATE ─────────────────────────────────────────
-- Single row tracks the whole tournament lifecycle.
create table if not exists public.tournament (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'registration',
  -- registration | seeded | active | complete
  current_round int  not null default 0,
  -- 0 = not started, 1 = R32, 2 = R16, 3 = QF, 4 = SF, 5 = Final
  seeding       jsonb not null default '[]',
  -- Array of 32 team_ids in bracket order (position i vs position i XOR 1)
  champion_id   uuid references public.teams(id) on delete set null,
  started_at    timestamptz,
  created_at    timestamptz default now()
);

-- ─── MATCHES ──────────────────────────────────────────────────
create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  round_num    int  not null,   -- 1=R32, 2=R16, 3=QF, 4=SF, 5=Final
  match_num    int  not null,   -- 1-indexed within round
  home_id      uuid references public.teams(id) on delete cascade,
  away_id      uuid references public.teams(id) on delete cascade,
  home_score   int,             -- null = not played
  away_score   int,
  home_pens    int,             -- penalty shootout result (null if not needed)
  away_pens    int,
  winner_id    uuid references public.teams(id) on delete set null,
  status       text not null default 'scheduled',   -- scheduled | complete
  match_data   jsonb not null default '{}',
  -- { events: [{minute,team,scorer,scorerName}], homeStrength, awayStrength }
  played_at    timestamptz,
  created_at   timestamptz default now(),
  unique(round_num, match_num)
);

-- ─── INDEXES ──────────────────────────────────────────────────
create index if not exists idx_matches_round on public.matches(round_num);
create index if not exists idx_matches_home  on public.matches(home_id);
create index if not exists idx_matches_away  on public.matches(away_id);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
alter table public.tournament enable row level security;
alter table public.matches     enable row level security;

-- Everyone can read; nobody can write from client (admin only via service key)
create policy "tournament_read_all" on public.tournament for select using (true);
create policy "matches_read_all"    on public.matches     for select using (true);

-- ─── SEED INITIAL TOURNAMENT ROW ─────────────────────────────
-- Insert a single tournament row if none exists
insert into public.tournament (status, current_round, seeding)
  select 'registration', 0, '[]'
  where not exists (select 1 from public.tournament);
