-- ═══════════════════════════════════════════════════════════
--  CTWC — CT World Cup  |  Supabase Schema
--  Run this in: supabase.com → your project → SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── TEAMS ───────────────────────────────────────────────────
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text not null default '#6B7280',
  emblem      text,
  logo_img    text,                          -- base64 or URL for custom logos
  created_at  timestamptz default now()
);

-- ─── CARDS (minted CT player cards) ──────────────────────────
create table public.cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete set null,
  x_handle      text not null unique,        -- @handle, lowercase, no @
  display_name  text,
  avatar_url    text,
  followers     bigint default 0,
  following     bigint default 0,
  listed_count  bigint default 0,
  tweet_count   bigint default 0,
  verified      boolean default false,
  -- CTWC card stats
  ovr           int not null default 60,     -- 0–99 overall rating
  tier          text not null default 'CT Player', -- CT Player / Star / Elite / Legend / Mythic
  stats         jsonb not null default '{}', -- { ENG, INF, CLT, VOL, VRL, OVR }
  badges        jsonb default '[]',
  -- team assignment
  team_id       uuid references public.teams(id) on delete set null,
  position      text,                        -- GK / CB / LB / RB / CM / CAM / LW / RW / ST
  -- meta
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─── POOL (global card pool count) ───────────────────────────
-- We track the pool cap via a simple counter view
create view public.pool_stats as
  select
    count(*) filter (where team_id is null) as unclaimed,
    count(*) filter (where team_id is not null) as claimed,
    count(*) as total,
    400 as cap
  from public.cards;

-- ─── INDEXES ─────────────────────────────────────────────────
create index idx_cards_x_handle on public.cards(x_handle);
create index idx_cards_team_id  on public.cards(team_id);
create index idx_cards_user_id  on public.cards(user_id);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────
alter table public.teams enable row level security;
alter table public.cards enable row level security;

-- Teams: anyone can read, nobody can write from client
create policy "teams_read_all"  on public.teams for select using (true);

-- Cards: anyone can read; only owner can update their own card
create policy "cards_read_all"  on public.cards for select using (true);
create policy "cards_owner_update" on public.cards for update
  using (auth.uid() = user_id);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cards_updated_at
  before update on public.cards
  for each row execute procedure public.set_updated_at();

-- ─── SEED: 32 PRESET TEAMS ───────────────────────────────────
-- Run this after creating the table to pre-populate all teams
insert into public.teams (name, color, emblem) values
  ('Solana Speed Demons',        '#9945FF', '⚡'),
  ('Ethereum Maxis',             '#627EEA', '🔷'),
  ('Degen Raiders',              '#EF4444', '🏴‍☠️'),
  ('Meme Coin Marauders',        '#22C55E', '🐸'),
  ('Shitcoin Slayers',           '#F43F5E', '⚔️'),
  ('Hyperliquid Hustlers',       '#06B6D4', '💧'),
  ('Monad Maniacs',              '#8B5CF6', '🟣'),
  ('Base Degens',                '#2563EB', '🔵'),
  ('Pump & Dump FC',             '#F59E0B', '📈'),
  ('NFT Reapers',                '#6B7280', '💀'),
  ('Perp Dex Predators',         '#0891B2', '🦈'),
  ('RWA Realists',               '#65A30D', '🏦'),
  ('ZK Shadow Ops',              '#475569', '🕶️'),
  ('Prediction Market Prophets', '#DC2626', '🔮'),
  ('Stablecoin Syndicate',       '#16A34A', '💵'),
  ('Bitcoin Boomers',            '#F97316', '🟠'),
  ('Altcoin Army',               '#D97706', '🪖'),
  ('Venture Vultures',           '#7C3AED', '🦅'),
  ('Airdrop Addicts',            '#EC4899', '🪂'),
  ('Influencer Infantry',        '#0EA5E9', '📱'),
  ('gBillions FC',               '#1565F5', '💰'),
  ('Alpha Snipers',              '#BE123C', '🎯'),
  ('Chart Wizards',              '#0D9488', '📊'),
  ('Diamond Hand Defenders',     '#D4A537', '💎'),
  ('Paper Hand Panic',           '#94A3B8', '📄'),
  ('FUD Factory',                '#991B1B', '😱'),
  ('Hype Squad',                 '#DB2777', '📣'),
  ('Bear Market Survivors',      '#92400E', '🐻'),
  ('Bull Run Brigade',           '#15803D', '🐂'),
  ('Liquidity Lurkers',          '#1D4ED8', '💦'),
  ('Governance Gladiators',      '#7E22CE', '⚖️'),
  ('CT Legends',                 '#B45309', '👑')
on conflict (name) do nothing;

-- Update gBillions FC with custom logo (set logo_img via app after seeding)
