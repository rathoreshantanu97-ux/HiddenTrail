-- =============================================================================
-- SCOTLAND YARD — DATA CLEANUP (pg_cron)
-- =============================================================================
-- Run this ONCE in Supabase SQL Editor, after schema.sql and functions.sql.
-- Safe to re-run (uses create-or-replace / if-not-exists throughout, and
-- cron.schedule with the same job name replaces the existing schedule
-- rather than creating a duplicate).
--
-- WHAT GETS CLEANED UP, AND WHEN:
--   - Rooms whose game ended (game_state_public.phase = 'ended') more
--     than 1 hour ago -- gives players time to see the results screen
--     (including the full-route reveal) before the room's data disappears.
--   - Rooms stuck in 'lobby' status for more than 24 hours with nobody
--     having started a game -- an abandoned lobby nobody ever used.
--   - (Paused-game cleanup, per the original design -- "36 hours after an
--     unresumed pause" -- is NOT included yet, since the pause feature
--     itself hasn't been built. This job's structure is written so
--     adding that condition later is a one-line addition to the WHERE
--     clause in cleanup_stale_rooms(), once a paused_at column exists.)
--
-- Deleting a room cascades (via foreign keys) to its players,
-- game_state_public, game_state_secret, moves, messages, and end-game
-- proposal/vote rows -- nothing needs to be cleaned up table-by-table.
-- =============================================================================

create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- cleanup_stale_rooms — the actual cleanup logic, callable directly (for
-- manual testing) or via the scheduled cron job below.
-- -----------------------------------------------------------------------------
create or replace function cleanup_stale_rooms() returns table (out_deleted_room_ids uuid[])
language plpgsql
security definer
as $$
declare
  v_deleted uuid[];
begin
  with ended_rooms as (
    select r.id
    from rooms r
    join game_state_public gs on gs.room_id = r.id
    where gs.phase = 'ended' and gs.updated_at < now() - interval '1 hour'
  ),
  abandoned_lobbies as (
    select r.id
    from rooms r
    where r.status = 'lobby' and r.created_at < now() - interval '24 hours'
  ),
  to_delete as (
    select id from ended_rooms
    union
    select id from abandoned_lobbies
  ),
  deleted as (
    delete from rooms where id in (select id from to_delete)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_deleted from deleted;

  return query select v_deleted;
end;
$$;

-- -----------------------------------------------------------------------------
-- Schedule cleanup_stale_rooms() to run every 30 minutes. Using the same
-- job name on re-run replaces the existing schedule instead of creating
-- a duplicate, so this file stays safe to re-run.
-- -----------------------------------------------------------------------------
select cron.schedule(
  'scotland-yard-cleanup-stale-rooms',
  '*/30 * * * *',
  $$select cleanup_stale_rooms()$$
);

-- To check the job is registered:
--   select * from cron.job where jobname = 'scotland-yard-cleanup-stale-rooms';
-- To see its run history:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- To run it manually right now (e.g. to test):
--   select cleanup_stale_rooms();
-- To remove the schedule entirely:
--   select cron.unschedule('scotland-yard-cleanup-stale-rooms');
