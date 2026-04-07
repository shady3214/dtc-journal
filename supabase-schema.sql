-- ============================================================
-- DTC Journal — Supabase Database Schema
-- ============================================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- after creating your project.
-- ============================================================

-- ── Trades Table ────────────────────────────────────────────

create table if not exists trades (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pair text not null default '',
  direction text not null default '',
  entry real not null default 0,
  stop_loss real not null default 0,
  take_profit real not null default 0,
  lot_size real not null default 0,
  capital real not null default 0,
  enable_commission boolean not null default false,
  commission_per_lot real not null default 0,
  risk_percent real not null default 0,
  pnl real not null default 0,
  return_percent real not null default 0,
  status text not null default 'open',
  tags text[] not null default '{}',
  mistakes text[] not null default '{}',
  setup text,
  chart_image_data text,
  notes_html text not null default '',
  opened_at text not null default '',
  closed_at text,
  ai_analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trades_user_id_idx on trades(user_id);
create index if not exists trades_opened_at_idx on trades(opened_at);

-- ── Journal Entries Table ───────────────────────────────────

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  pre_bias text not null default '',
  pre_session text not null default '',
  pre_levels text not null default '',
  pre_plan text not null default '',
  post_went_well text not null default '',
  post_went_wrong text not null default '',
  post_lessons text not null default '',
  post_mood integer not null default 3,
  post_grade text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, date)
);

create index if not exists journal_entries_user_date_idx on journal_entries(user_id, date);

-- ── User Settings Table ─────────────────────────────────────

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Row Level Security ──────────────────────────────────────

alter table trades enable row level security;
alter table journal_entries enable row level security;
alter table user_settings enable row level security;

-- Trades: users can only access their own trades
create policy "Users can select own trades"
  on trades for select using (auth.uid() = user_id);

create policy "Users can insert own trades"
  on trades for insert with check (auth.uid() = user_id);

create policy "Users can update own trades"
  on trades for update using (auth.uid() = user_id);

create policy "Users can delete own trades"
  on trades for delete using (auth.uid() = user_id);

-- Journal entries: users can only access their own entries
create policy "Users can select own journal entries"
  on journal_entries for select using (auth.uid() = user_id);

create policy "Users can insert own journal entries"
  on journal_entries for insert with check (auth.uid() = user_id);

create policy "Users can update own journal entries"
  on journal_entries for update using (auth.uid() = user_id);

create policy "Users can delete own journal entries"
  on journal_entries for delete using (auth.uid() = user_id);

-- User settings: users can only access their own settings
create policy "Users can select own settings"
  on user_settings for select using (auth.uid() = user_id);

create policy "Users can insert own settings"
  on user_settings for insert with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on user_settings for update using (auth.uid() = user_id);

create policy "Users can delete own settings"
  on user_settings for delete using (auth.uid() = user_id);

-- ── Updated-at Trigger ──────────────────────────────────────

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trades_updated_at
  before update on trades
  for each row execute function update_updated_at();

create trigger journal_entries_updated_at
  before update on journal_entries
  for each row execute function update_updated_at();

create trigger user_settings_updated_at
  before update on user_settings
  for each row execute function update_updated_at();
