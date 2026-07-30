-- =============================================================================
-- MIGRATION: add missing columns to existing tables
-- =============================================================================
-- Run this ONCE in Supabase SQL Editor if you set up your database before
-- some of these columns were added to schema.sql -- `create table if not
-- exists` silently does NOTHING if the table already exists, including
-- skipping any new columns that were added to the table definition since
-- then. This file uses `alter table ... add column if not exists`
-- instead, which actually adds a missing column to an existing table
-- without touching anything that's already there.
--
-- Entirely safe to re-run any number of times, and safe to run even if
-- your database already has some/all of these columns -- each line is a
-- no-op if the column is already present.
-- =============================================================================

-- rooms: total_players (added for the multi-detective-per-player room model)
alter table rooms add column if not exists total_players int not null default 0;

-- accounts: is_admin / invite-code related columns, in case your database
-- predates some of these (most installs will already have all of these
-- from access_control_schema.sql, but this is here as a safety net)
-- NOTE: these only apply if you're using the access-control system at all.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'accounts') then
    alter table accounts add column if not exists is_admin boolean not null default false;
    alter table accounts add column if not exists is_invite_created boolean not null default false;
    alter table accounts add column if not exists invited_by_account_id uuid references accounts(id) on delete set null;
    alter table accounts add column if not exists invite_code text;
    alter table accounts add column if not exists invite_code_limit int not null default 20;
    alter table accounts add column if not exists invite_code_uses int not null default 0;
  end if;
end $$;

-- app_settings: turn-timer bounds and default invite limit, in case your
-- database predates these
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    alter table app_settings add column if not exists turn_timer_min_seconds int not null default 30;
    alter table app_settings add column if not exists turn_timer_max_seconds int not null default 300;
    alter table app_settings add column if not exists default_invite_code_limit int not null default 20;
  end if;
end $$;

-- After running this, verify with:
--   select column_name from information_schema.columns where table_name = 'rooms';
-- You should see total_players in the list.
