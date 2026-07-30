-- =============================================================================
-- MIGRATION: rename is_owner -> is_admin
-- =============================================================================
-- Run this ONCE in Supabase SQL Editor, AFTER you've already run
-- access_control_schema.sql and access_control_functions.sql at least once
-- before (i.e. your accounts table already exists with an is_owner
-- column and you've already marked your own account).
--
-- This uses "alter table ... rename column", which PRESERVES existing
-- data -- your account, already marked as owner, keeps that same true
-- value under its new name. This is NOT a fresh create-table statement,
-- so it will not wipe your accounts, sessions, or anything else.
--
-- Safe to run even if you've already renamed it once before (the IF
-- EXISTS check below skips it harmlessly on a second run).
-- =============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'accounts' and column_name = 'is_owner'
  ) then
    alter table accounts rename column is_owner to is_admin;
  end if;
end $$;

-- After running this, run access_control_functions.sql again (the
-- updated version, which now references is_admin instead of is_owner) --
-- that file must run AFTER this migration, or its functions would fail
-- trying to reference a column name that doesn't exist yet.
