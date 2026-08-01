-- =============================================================================
-- SCOTLAND YARD — DATA CLEANUP (pg_cron)
-- =============================================================================
-- Run this ONCE in Supabase SQL Editor, after schema.sql and functions.sql.
-- Safe to re-run (uses create-or-replace / if-not-exists throughout, and
-- cron.schedule with the same job name replaces the existing schedule
-- rather than creating a duplicate).
--
-- WHAT GETS CLEANED UP, AND WHEN:
--   - IMMEDIATELY, event-driven (not this scheduled job): a room is
--     deleted the instant it becomes empty -- either via leave_lobby
--     (pre-game leave) or leave_room_permanently (a deliberate
--     departure after a game has ended, e.g. clicking "New Game"),
--     both of which check "am I the last one here?" and delete right
--     away rather than waiting for this job's next run. This job is
--     the SAFETY NET for everything else -- abandonment that isn't a
--     deliberate, detected departure.
--   - Rooms whose game ended (game_state_public.phase = 'ended') more
--     than 1 hour ago -- gives players time to see the results screen
--     (including the full-route reveal) before the room's data disappears.
--   - Rooms stuck in 'lobby' status for more than 24 hours with nobody
--     having started a game -- an abandoned lobby nobody ever used.
--   - Rooms paused (via room_pauses.resume_deadline) past their deadline
--     with nobody having resumed -- these are auto-ENDED (phase set to
--     'ended', same as a normal game conclusion) rather than deleted
--     immediately, so they then follow the same "cleaned up 1 hour after
--     ending" rule as every other ended game, giving players a
--     consistent final-state screen instead of the room just vanishing.
--   - ACTIVE games (phase = 'playing') that everyone has genuinely
--     abandoned mid-match -- a real gap that existed before this rule:
--     such a room was never 'ended' (so the 1-hour rule never applied)
--     and never 'lobby' (so the 24-hour rule never applied either), so
--     it would sit in the database FOREVER. Now: if a playing game's
--     state hasn't changed in 3+ hours AND nobody in the room has been
--     seen (via the same presence/heartbeat signal used everywhere
--     else) recently, it's auto-ended the same way an expired pause is,
--     then cleaned up by the normal 1-hour ended-game rule.
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
  v_presence_grace_seconds int := 25;
begin
  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    select presence_grace_period_seconds into v_presence_grace_seconds from app_settings where id = 1;
  end if;

  -- Step 0: a real, previously-missing gap -- an ACTIVE game
  -- (phase='playing') that everyone has genuinely abandoned mid-match
  -- had NO cleanup path at all before this: it's not 'ended' (so the
  -- 1-hour ended-game rule never applied) and not 'lobby' (so the
  -- 24-hour abandoned-lobby rule never applied either) -- it would sit
  -- in the database forever. Fix: if a playing game's state hasn't
  -- changed in a long time AND nobody in the room is currently active
  -- (checked via the same last_seen_at heartbeat signal used
  -- everywhere else), auto-end it the same way an expired pause is
  -- auto-ended -- reusing the existing "ended games get cleaned up 1
  -- hour later" rule below rather than deleting immediately, so it
  -- still gets a moment as a normal "ended" room first (consistent
  -- behavior, same as every other way a game can conclude).
  update game_state_public gs
  set phase = 'ended',
      log = gs.log || jsonb_build_array(jsonb_build_object('kind', 'ended_abandoned'))
  where gs.phase = 'playing'
    and gs.updated_at < now() - interval '3 hours'
    and not exists (
      select 1 from players p
      where p.room_id = gs.room_id
        and p.last_seen_at > now() - (v_presence_grace_seconds || ' seconds')::interval
    );

  -- Step 1: any room paused past its resume deadline gets auto-ended
  -- (not deleted yet) -- this reuses the exact same "ended" path a normal
  -- game conclusion takes, so it then gets cleaned up by the SAME rule
  -- below (1 hour after ending) rather than needing a separate immediate
  -- delete, and gives players a consistent final screen either way.
  update game_state_public gs
  set phase = 'ended',
      log = gs.log || jsonb_build_array(jsonb_build_object('kind', 'ended_pause_expired'))
  from room_pauses rp
  where gs.room_id = rp.room_id and gs.phase = 'paused' and rp.resume_deadline < now();

  delete from room_pauses rp
  where rp.resume_deadline < now()
    and exists (select 1 from game_state_public gs where gs.room_id = rp.room_id and gs.phase = 'ended');

  -- Step 2: the usual cleanup -- ended games (including ones just ended
  -- above by the expired-pause rule) after their grace period, plus
  -- abandoned lobbies nobody ever started.
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
