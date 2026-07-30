-- =============================================================================
-- SCOTLAND YARD — RPC FUNCTIONS
-- =============================================================================
-- Run this AFTER schema.sql (it references those tables).
-- Run in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every function uses `create or replace function`.
--
-- WHAT VALIDATION HAPPENS WHERE (per the "start simple" decision made
-- earlier in this project): these functions check identity (is the
-- caller who they claim to be) and turn order (is it actually their
-- turn) and ticket counts (do they actually have that ticket). They do
-- NOT re-derive "is there really a taxi edge between station 12 and
-- station 9" in SQL — that graph-legality check already happens in the
-- browser via gameEngine.js/validMovesFor before the RPC is ever called.
-- This is the simpler of the two validation strategies discussed —
-- appropriate for a private game among friends, not hardened against a
-- determined cheater with devtools open. Upgrading later means porting
-- validMovesFor's graph-adjacency logic into a PL/pgSQL check inside
-- make_detective_move / make_mrx_move below.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- compute_seat_layout — the fair-split calculation: given N detectives
-- and P total players (1 Mr.X + (P-1) detective-controllers), returns
-- one row per detective SEAT, each seat listing which detective indices
-- it holds. Split is as even as possible: some seats get floor(N /
-- (P-1)) detectives, the rest get ceil(N / (P-1)) -- e.g. 5 detectives /
-- 2 controllers -> one seat gets 2, the other gets 3, never 1-and-4.
--
-- Returns seats as text (e.g. "d0,d1", "d2,d3,d4") in the same format
-- players.role uses for detective seats, so the client can directly use
-- these as the selectable options in the lobby.
-- -----------------------------------------------------------------------------
drop function if exists compute_seat_layout(int, int);
create or replace function compute_seat_layout(
  p_num_detectives int,
  p_total_players int
) returns table (out_seat_role text, out_detective_count int)
language plpgsql
security definer
as $$
declare
  v_controllers int := p_total_players - 1; -- everyone except Mr. X
  v_base int;
  v_extra int;
  v_next_det int := 0;
  v_this_seat_count int;
  i int;
begin
  if v_controllers < 1 then
    raise exception 'total_players must be at least 2 (1 Mr.X + at least 1 detective-controller)';
  end if;
  if p_num_detectives < v_controllers then
    raise exception 'num_detectives (%) must be at least the number of detective-controllers (%)', p_num_detectives, v_controllers;
  end if;

  v_base := p_num_detectives / v_controllers;         -- integer division = floor
  v_extra := p_num_detectives % v_controllers;         -- how many seats get one extra

  for i in 1..v_controllers loop
    -- the first v_extra seats get the "ceil" count, the rest get "floor"
    v_this_seat_count := v_base + (case when i <= v_extra then 1 else 0 end);
    out_seat_role := array_to_string(
      (select array_agg('d' || gs) from generate_series(v_next_det, v_next_det + v_this_seat_count - 1) gs),
      ','
    );
    out_detective_count := v_this_seat_count;
    v_next_det := v_next_det + v_this_seat_count;
    return next;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- create_room — host creates a new room, declaring BOTH the detective
-- count and total player count upfront. The fair-split seat layout is
-- computed immediately (via compute_seat_layout) so the lobby can show
-- pre-sized seats before anyone else has joined. The host claims one
-- seat now (either "mrx" or one of the computed detective seats);
-- everyone else claims a remaining seat when they join.
-- -----------------------------------------------------------------------------
drop function if exists create_room(text, int, int, text, text, boolean, boolean, boolean, boolean, boolean, int);
create or replace function create_room(
  p_map_id text,
  p_num_detectives int,
  p_total_players int,
  p_host_display_name text,
  p_host_role text default 'mrx',
  -- Host-chosen overrides -- NULL means "use the admin's global
  -- default", and is always accepted regardless of overridability
  -- (choosing not to override is never restricted). A non-null value is
  -- only honored if the admin has actually marked that feature
  -- overridable-by-host -- otherwise it's silently ignored and the
  -- admin's global setting is used instead, since the client should
  -- never have offered that choice in the first place, and the server
  -- must not trust that it didn't.
  p_takeovers_override boolean default null,
  p_takeover_reversal_override boolean default null,
  p_end_game_vote_override boolean default null,
  p_pause_resume_override boolean default null,
  p_redistribute_roles_override boolean default null,
  p_turn_timer_seconds int default null
) returns table (out_room_id uuid, out_room_code text, out_host_player_id uuid)
language plpgsql
security definer
as $$
declare
  v_room_id uuid;
  v_code text;
  v_host_id uuid;
  v_attempt int := 0;
  v_valid_roles text[];
  v_min_det int := 3;
  v_max_det int := 20;
  v_min_players int := 2;
  v_max_players int := 21;
  v_turn_min int := 30;
  v_turn_max int := 300;
  v_takeovers_overridable boolean := true;
  v_reversal_overridable boolean := true;
  v_endgame_overridable boolean := true;
  v_pause_overridable boolean := true;
  v_redistribute_overridable boolean := true;
  v_final_takeovers_override boolean;
  v_final_reversal_override boolean;
  v_final_endgame_override boolean;
  v_final_pause_override boolean;
  v_final_redistribute_override boolean;
begin
  -- Read configurable bounds from app_settings if that table exists (it's
  -- part of the access-control system in access_control_schema.sql,
  -- which is optional -- multiplayer works without it, just with these
  -- hardcoded fallback bounds instead of admin-configurable ones).
  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    select min_detectives, max_detectives, min_total_players, max_total_players,
           turn_timer_min_seconds, turn_timer_max_seconds,
           takeovers_overridable_by_host, takeover_reversal_overridable_by_host,
           end_game_vote_overridable_by_host, pause_resume_overridable_by_host,
           redistribute_roles_overridable_by_host
      into v_min_det, v_max_det, v_min_players, v_max_players, v_turn_min, v_turn_max,
           v_takeovers_overridable, v_reversal_overridable, v_endgame_overridable,
           v_pause_overridable, v_redistribute_overridable
      from app_settings where id = 1;
  end if;

  if p_num_detectives < v_min_det or p_num_detectives > v_max_det then
    raise exception 'num_detectives must be between % and %', v_min_det, v_max_det;
  end if;
  if p_total_players < v_min_players or p_total_players > v_max_players then
    raise exception 'total_players must be between % and %', v_min_players, v_max_players;
  end if;
  if p_total_players - 1 > p_num_detectives then
    raise exception 'Cannot have more detective-controllers than detectives';
  end if;
  if p_turn_timer_seconds is not null and (p_turn_timer_seconds < v_turn_min or p_turn_timer_seconds > v_turn_max) then
    raise exception 'turn_timer_seconds must be between % and %, or null for no limit', v_turn_min, v_turn_max;
  end if;

  -- validate the host's chosen role is actually one of the computed seats
  select array_cat(array['mrx'], array_agg(out_seat_role))
    into v_valid_roles
    from compute_seat_layout(p_num_detectives, p_total_players);
  if not (p_host_role = any(v_valid_roles)) then
    raise exception 'Invalid role % for this room''s seat layout', p_host_role;
  end if;

  -- silently drop any override the admin hasn't permitted -- see comment
  -- on the parameters above for why this must be re-checked server-side
  v_final_takeovers_override := case when v_takeovers_overridable then p_takeovers_override else null end;
  v_final_reversal_override := case when v_reversal_overridable then p_takeover_reversal_override else null end;
  v_final_endgame_override := case when v_endgame_overridable then p_end_game_vote_override else null end;
  v_final_pause_override := case when v_pause_overridable then p_pause_resume_override else null end;
  v_final_redistribute_override := case when v_redistribute_overridable then p_redistribute_roles_override else null end;

  loop
    v_code := upper(substr(md5(random()::text), 1, 6));
    v_attempt := v_attempt + 1;
    exit when not exists (select 1 from rooms r where r.code = v_code) or v_attempt > 10;
  end loop;

  insert into rooms (
    map_id, num_detectives, total_players, code, status, turn_timer_seconds,
    takeovers_enabled_override, takeover_reversal_enabled_override,
    end_game_vote_enabled_override, pause_resume_enabled_override, redistribute_roles_enabled_override
  )
  values (
    p_map_id, p_num_detectives, p_total_players, v_code, 'lobby', p_turn_timer_seconds,
    v_final_takeovers_override, v_final_reversal_override,
    v_final_endgame_override, v_final_pause_override, v_final_redistribute_override
  )
  returning id into v_room_id;

  insert into players (room_id, role, display_name)
  values (v_room_id, p_host_role, p_host_display_name)
  returning id into v_host_id;

  update rooms set host_player_id = v_host_id where id = v_room_id;

  return query select v_room_id, v_code, v_host_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- join_room — a new player joins an existing lobby by code, claiming one
-- of the room's pre-computed seats (either "mrx" or one of the detective
-- seats from compute_seat_layout). Fails if that seat is already taken
-- (enforced by the unique index / overlap trigger in schema.sql) or the
-- room already started.
-- -----------------------------------------------------------------------------
drop function if exists join_room(text, text, text);
create or replace function join_room(
  p_room_code text,
  p_role text,
  p_display_name text
) returns table (out_room_id uuid, out_player_id uuid)
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_player_id uuid;
  v_valid_roles text[];
begin
  select * into v_room from rooms r where r.code = upper(p_room_code);
  if v_room.id is null then
    raise exception 'Room not found';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'Room has already started';
  end if;

  select array_cat(array['mrx'], array_agg(out_seat_role))
    into v_valid_roles
    from compute_seat_layout(v_room.num_detectives, v_room.total_players);
  if not (p_role = any(v_valid_roles)) then
    raise exception 'Invalid role % for this room''s seat layout', p_role;
  end if;

  insert into players (room_id, role, display_name)
  values (v_room.id, p_role, p_display_name)
  returning id into v_player_id;

  return query select v_room.id, v_player_id;
exception
  when unique_violation then
    raise exception 'That seat has already been taken in this room';
end;
$$;


-- -----------------------------------------------------------------------------
-- switch_seat — a player already in the lobby releases their current
-- seat and claims a different available one, in one atomic operation
-- (never leaves them holding zero seats, and never lets someone else
-- grab the vacated seat mid-switch, since it's all one transaction).
-- Only allowed while the room is still in 'lobby' -- once the game has
-- started, seats are locked in.
-- -----------------------------------------------------------------------------
drop function if exists switch_seat(uuid, uuid, text);
create or replace function switch_seat(
  p_room_id uuid,
  p_player_id uuid,
  p_new_role text
) returns void
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_player players%rowtype;
  v_valid_roles text[];
begin
  select * into v_room from rooms r where r.id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found'; end if;
  if v_room.status <> 'lobby' then raise exception 'Cannot switch seats after the game has started'; end if;

  select * into v_player from players p where p.id = p_player_id and p.room_id = p_room_id;
  if v_player.id is null then raise exception 'You are not a player in this room'; end if;

  select array_cat(array['mrx'], array_agg(out_seat_role))
    into v_valid_roles
    from compute_seat_layout(v_room.num_detectives, v_room.total_players);
  if not (p_new_role = any(v_valid_roles)) then
    raise exception 'Invalid role % for this room''s seat layout', p_new_role;
  end if;

  if exists (
    select 1 from players p
    where p.room_id = p_room_id and p.id <> p_player_id and p.role = p_new_role
  ) then
    raise exception 'That seat is already taken';
  end if;
  -- for detective seats (comma-joined), also check no overlap with any
  -- OTHER seat -- same check the insert trigger does, run here explicitly
  -- so the error message is clear before we even attempt the update
  if p_new_role <> 'mrx' and exists (
    select 1 from players p
    where p.room_id = p_room_id
      and p.id <> p_player_id
      and p.role <> 'mrx'
      and string_to_array(p.role, ',') && string_to_array(p_new_role, ',')
  ) then
    raise exception 'One or more detective seats in "%" are already claimed by another player', p_new_role;
  end if;

  update players set role = p_new_role where id = p_player_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- lookup_room — for the join flow: look up a room by code WITHOUT
-- joining, so the UI can show the full seat layout and which are still
-- available before the player commits to a name + seat and actually
-- inserts a players row.
-- -----------------------------------------------------------------------------
drop function if exists lookup_room(text);
create or replace function lookup_room(p_room_code text)
returns table (
  out_room_id uuid, out_map_id text, out_num_detectives int, out_total_players int,
  out_status text, out_taken_roles text[], out_available_roles text[]
)
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_taken text[];
  v_all_seats text[];
begin
  select * into v_room from rooms r where r.code = upper(p_room_code);
  if v_room.id is null then
    raise exception 'Room not found';
  end if;

  select coalesce(array_agg(pl.role), '{}') into v_taken from players pl where pl.room_id = v_room.id;

  if v_room.total_players > 0 then
    select array_cat(array['mrx'], array_agg(out_seat_role))
      into v_all_seats
      from compute_seat_layout(v_room.num_detectives, v_room.total_players);
  else
    -- legacy room created before total_players existed -- fall back to
    -- the old one-detective-per-seat assumption so old rooms don't break
    select array_cat(array['mrx'], array_agg('d' || gs order by gs))
      into v_all_seats
      from generate_series(0, v_room.num_detectives - 1) gs;
  end if;

  return query
    select
      v_room.id, v_room.map_id, v_room.num_detectives, v_room.total_players, v_room.status,
      v_taken,
      (select array_agg(s) from unnest(v_all_seats) s where not (s = any(v_taken)));
end;
$$;


-- -----------------------------------------------------------------------------
-- reassign_host — transfers host status to a different player already in
-- the room. Two ways this gets used:
--   1. Automatically inside leave_lobby (already handled separately,
--      before this function existed) when the host leaves the lobby.
--   2. As a building block for automatic reassignment once presence
--      detection exists (a later phase of this project) -- when the
--      host goes inactive mid-game, this is the function that would be
--      called to hand host status to another active player, without
--      needing a vote (host status is administrative, not a gameplay
--      role, so no consensus is required the way ending/pausing a game
--      needs one).
-- Can be called by the CURRENT host (voluntarily stepping down) or, once
-- presence exists, by any system-level process that's determined the
-- host is inactive -- for now, exposed as a plain callable RPC so it's
-- ready to use either way.
-- -----------------------------------------------------------------------------
drop function if exists reassign_host(uuid, uuid);
create or replace function reassign_host(
  p_room_id uuid,
  p_new_host_player_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_new_host players%rowtype;
begin
  select * into v_room from rooms r where r.id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found'; end if;

  select * into v_new_host from players p where p.id = p_new_host_player_id and p.room_id = p_room_id;
  if v_new_host.id is null then
    raise exception 'That player is not in this room';
  end if;

  update rooms set host_player_id = p_new_host_player_id where id = p_room_id;
end;
$$;
-- started. If the leaving player is the host, host status passes to
-- another remaining player (arbitrarily, the earliest-joined one) so the
-- room isn't left ownerless; if they were the only player left, the room
-- itself is deleted (cascades to the player row via the FK). Fails if the
-- room has already started (use a different mechanism -- pause/end-game
-- -- for that; leaving a LOBBY and leaving an in-progress GAME are
-- different actions on purpose, see the design notes higher up this file).
-- -----------------------------------------------------------------------------
drop function if exists leave_lobby(uuid, uuid);
create or replace function leave_lobby(
  p_room_id uuid,
  p_player_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_next_host_id uuid;
begin
  select * into v_room from rooms r where r.id = p_room_id;
  if v_room.id is null then
    return; -- room already gone, nothing to do
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'Cannot leave -- the game has already started';
  end if;

  delete from players where id = p_player_id and room_id = p_room_id;

  -- if the leaver was host, hand host status to whoever's been here
  -- longest; if nobody's left, delete the room entirely
  if v_room.host_player_id = p_player_id then
    select id into v_next_host_id
    from players
    where room_id = p_room_id
    order by connected_at asc
    limit 1;

    if v_next_host_id is null then
      delete from rooms where id = p_room_id;
    else
      update rooms set host_player_id = v_next_host_id where id = p_room_id;
    end if;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- start_game — host starts the match. Random start positions are
-- generated HERE (server-side), not trusted from the client, specifically
-- so Mr. X's start position never passes through any channel a detective
-- client could observe.
-- -----------------------------------------------------------------------------
drop function if exists start_game(uuid, uuid, int[], jsonb, jsonb, text[]);
create or replace function start_game(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_start_pool int[],
  p_mrx_starting_tickets jsonb,
  p_detective_starting_tickets jsonb,
  p_detective_colors text[]
) returns void
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_caller players%rowtype;
  v_pool int[];
  v_picked int[] := '{}';
  v_idx int;
  v_pos int;
  v_mrx_pos int;
  v_detectives jsonb := '[]'::jsonb;
  v_needed int;
  v_turn_order text[];
  i int;
begin
  select * into v_room from rooms r where r.id = p_room_id;
  if v_room.id is null then raise exception 'Room not found'; end if;

  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Caller is not a player in this room'; end if;
  if v_caller.id <> v_room.host_player_id then
    raise exception 'Only the host can start the game';
  end if;
  if v_room.status <> 'lobby' then raise exception 'Game already started'; end if;

  -- Every declared seat must actually be filled before the game can
  -- start -- otherwise some detectives would have no controlling player
  -- at all, permanently stuck with nobody able to move them. Compares
  -- the room's full seat layout (mrx + every fair-split detective seat)
  -- against who has actually joined.
  declare
    v_all_seats text[];
    v_joined_seats text[];
    v_missing_seats text[];
  begin
    if v_room.total_players > 0 then
      select array_cat(array['mrx'], array_agg(out_seat_role))
        into v_all_seats
        from compute_seat_layout(v_room.num_detectives, v_room.total_players);
    else
      -- legacy room created before total_players existed
      select array_cat(array['mrx'], array_agg('d' || gs order by gs))
        into v_all_seats
        from generate_series(0, v_room.num_detectives - 1) gs;
    end if;

    select coalesce(array_agg(pl.role), '{}') into v_joined_seats from players pl where pl.room_id = p_room_id;

    select array_agg(s) into v_missing_seats from unnest(v_all_seats) s where not (s = any(v_joined_seats));

    if v_missing_seats is not null and array_length(v_missing_seats, 1) > 0 then
      raise exception 'Not everyone has joined yet -- waiting on: %', array_to_string(v_missing_seats, ', ');
    end if;
  end;

  v_needed := v_room.num_detectives + 1;
  if array_length(p_start_pool, 1) < v_needed then
    raise exception 'Map does not have enough stations for this many players';
  end if;

  v_pool := p_start_pool;
  for i in 1..v_needed loop
    v_idx := 1 + floor(random() * array_length(v_pool, 1))::int;
    v_pos := v_pool[v_idx];
    v_picked := array_append(v_picked, v_pos);
    v_pool := v_pool[1:v_idx-1] || v_pool[v_idx+1:array_length(v_pool,1)];
  end loop;

  v_mrx_pos := v_picked[1];

  for i in 0..(v_room.num_detectives - 1) loop
    v_detectives := v_detectives || jsonb_build_array(jsonb_build_object(
      'id', i,
      'color', p_detective_colors[i + 1],
      'pos', v_picked[i + 2],
      'tickets', p_detective_starting_tickets,
      'history', '[]'::jsonb
    ));
  end loop;

  select array_cat(array['mrx'], array_agg('d' || gs order by gs))
    into v_turn_order
    from generate_series(0, v_room.num_detectives - 1) gs;

  insert into game_state_public (
    room_id, phase, round, turn_order, turn_idx,
    detectives, mrx_tickets, mrx_revealed_pos, mrx_last_reveal_round,
    mrx_travel_log, mrx_double_move_active, mrx_double_move_legs_remaining,
    winner, log
  ) values (
    p_room_id, 'playing', 1, v_turn_order, 0,
    v_detectives, p_mrx_starting_tickets, null, 0,
    '[]'::jsonb, false, 0,
    null,
    jsonb_build_array(jsonb_build_object('kind', 'game_started', 'payload', jsonb_build_object('numDetectives', v_room.num_detectives)))
  )
  on conflict (room_id) do update set
    phase = excluded.phase, round = excluded.round, turn_order = excluded.turn_order,
    turn_idx = excluded.turn_idx, detectives = excluded.detectives,
    mrx_tickets = excluded.mrx_tickets, mrx_revealed_pos = excluded.mrx_revealed_pos,
    mrx_last_reveal_round = excluded.mrx_last_reveal_round, mrx_travel_log = excluded.mrx_travel_log,
    mrx_double_move_active = excluded.mrx_double_move_active,
    mrx_double_move_legs_remaining = excluded.mrx_double_move_legs_remaining,
    winner = excluded.winner, log = excluded.log, updated_at = now();

  insert into game_state_secret (room_id, mrx_pos, mrx_position_log)
  values (
    p_room_id, v_mrx_pos,
    jsonb_build_array(jsonb_build_object('round', 0, 'pos', v_mrx_pos, 'mode', null))
  )
  on conflict (room_id) do update set
    mrx_pos = excluded.mrx_pos, mrx_position_log = excluded.mrx_position_log, updated_at = now();

  update rooms set status = 'playing' where id = p_room_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_mrx_position — the ONLY way to read Mr. X's true position. Checks
-- the caller's role explicitly. Returns an empty result set (not an
-- error) for non-Mr.X callers, so client code can treat "nothing
-- returned" uniformly as "not authorized."
-- -----------------------------------------------------------------------------
drop function if exists get_mrx_position(uuid, uuid);
create or replace function get_mrx_position(
  p_room_id uuid,
  p_caller_player_id uuid
) returns table (out_mrx_pos int, out_mrx_position_log jsonb)
language plpgsql
security definer
as $$
declare
  v_is_mrx boolean;
begin
  select exists(
    select 1 from players pl
    where pl.id = p_caller_player_id and pl.room_id = p_room_id and pl.role = 'mrx'
  ) into v_is_mrx;

  if not v_is_mrx then
    return;
  end if;

  return query
    select gs.mrx_pos, gs.mrx_position_log
    from game_state_secret gs
    where gs.room_id = p_room_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- advance_turn_internal — shared turn-advancement logic used by both move
-- functions. Not exposed to clients directly (no grant needed beyond the
-- default, since it's only ever called from inside the other SECURITY
-- DEFINER functions in this file, which already run as the function owner).
-- -----------------------------------------------------------------------------
drop function if exists advance_turn_internal(uuid);
create or replace function advance_turn_internal(p_room_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_gs game_state_public%rowtype;
  v_next_idx int;
  v_next_round int;
begin
  select * into v_gs from game_state_public where room_id = p_room_id for update;

  v_next_idx := v_gs.turn_idx + 1;
  v_next_round := v_gs.round;
  if v_next_idx >= array_length(v_gs.turn_order, 1) then
    v_next_idx := 0;
    v_next_round := v_gs.round + 1;
  end if;

  update game_state_public
  set turn_idx = v_next_idx, round = v_next_round, updated_at = now()
  where room_id = p_room_id;

  -- NOTE: "22" here duplicates MAX_ROUNDS from src/lib/gameEngine.js. SQL
  -- can't import a JS constant, so if the round limit ever changes, BOTH
  -- this literal and MAX_ROUNDS in gameEngine.js must be updated by hand.
  -- Same duplication applies to REVEAL_ROUNDS (3,8,13,18,22) below in
  -- make_mrx_move.
  if v_next_round > 22 then
    update game_state_public
    set winner = 'mrx',
        phase = 'ended',
        log = log || jsonb_build_array(jsonb_build_object('kind', 'round_limit_reached')),
        updated_at = now()
    where room_id = p_room_id;

    -- reveal Mr. X's full route now that the game has ended
    update game_state_public gp
    set log = gp.log || jsonb_build_array(jsonb_build_object(
          'kind', 'reveal_full_route',
          'payload', jsonb_build_object('positionLog', gs2.mrx_position_log)
        ))
    from game_state_secret gs2
    where gp.room_id = p_room_id and gs2.room_id = p_room_id;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- make_detective_move — a detective moves. Validates caller identity,
-- turn order, and ticket availability. Passes the spent ticket to Mr. X's
-- pool. Checks for capture against Mr. X's REAL position (read from the
-- secret table server-side; never exposed back to this caller either way).
-- -----------------------------------------------------------------------------
drop function if exists make_detective_move(uuid, uuid, int, int, text);
create or replace function make_detective_move(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_det_id int,
  p_to_station int,
  p_mode text
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_gs game_state_public%rowtype;
  v_secret game_state_secret%rowtype;
  v_detectives jsonb;
  v_det jsonb;
  v_det_idx int;
  v_ticket_count int;
  v_expected_role text;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  v_expected_role := 'd' || p_det_id;
  -- role can be a comma-joined list for a multi-detective seat (e.g.
  -- "d0,d2"), so check membership in that list rather than exact string
  -- equality -- this is the one change needed here for the
  -- multi-detective-per-player room model; everything else about turn
  -- order and ticket logic is already keyed by individual detective id
  -- and needs no changes.
  if not (v_expected_role = any(string_to_array(v_caller.role, ','))) then
    raise exception 'You do not control this detective';
  end if;

  select * into v_gs from game_state_public where room_id = p_room_id for update;
  if v_gs.room_id is null then raise exception 'Game not started'; end if;
  if v_gs.phase <> 'playing' then raise exception 'Game is not in progress'; end if;
  if v_gs.turn_order[v_gs.turn_idx + 1] <> v_expected_role then
    raise exception 'It is not your turn';
  end if;

  v_detectives := v_gs.detectives;
  select (t.idx - 1), t.elem into v_det_idx, v_det
  from jsonb_array_elements(v_detectives) with ordinality as t(elem, idx)
  where (t.elem->>'id')::int = p_det_id;

  if v_det is null then raise exception 'Detective not found in game state'; end if;

  v_ticket_count := (v_det->'tickets'->>p_mode)::int;
  if v_ticket_count is null or v_ticket_count <= 0 then
    raise exception 'No % tickets remaining', p_mode;
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_detectives) e
    where (e->>'pos')::int = p_to_station
  ) then
    raise exception 'Another detective already occupies that station';
  end if;

  v_det := jsonb_set(v_det, '{pos}', to_jsonb(p_to_station));
  v_det := jsonb_set(v_det, array['tickets', p_mode], to_jsonb(v_ticket_count - 1));
  v_det := jsonb_set(v_det, '{history}', (v_det->'history') || jsonb_build_array(
    jsonb_build_object('round', v_gs.round, 'to', p_to_station, 'mode', p_mode)
  ));
  v_detectives := jsonb_set(v_detectives, array[v_det_idx::text], v_det);

  update game_state_public
  set detectives = v_detectives,
      mrx_tickets = jsonb_set(mrx_tickets, array[p_mode], to_jsonb(coalesce((mrx_tickets->>p_mode)::int, 0) + 1)),
      log = log || jsonb_build_array(jsonb_build_object(
        'kind', 'detective_move',
        'payload', jsonb_build_object('detId', p_det_id, 'to', p_to_station, 'mode', p_mode)
      )),
      updated_at = now()
  where room_id = p_room_id;

  select * into v_secret from game_state_secret where room_id = p_room_id;

  if v_secret.mrx_pos = p_to_station then
    update game_state_public
    set winner = 'detectives',
        phase = 'ended',
        log = log || jsonb_build_array(jsonb_build_object('kind', 'detective_capture', 'payload', jsonb_build_object('to', p_to_station)))
                   || jsonb_build_array(jsonb_build_object('kind', 'reveal_full_route', 'payload', jsonb_build_object('positionLog', v_secret.mrx_position_log))),
        updated_at = now()
    where room_id = p_room_id;
    return;
  end if;

  perform advance_turn_internal(p_room_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- make_mrx_move — Mr. X moves. Validates caller is Mr. X, it's Mr. X's
-- turn, and the claimed ticket exists (ferries always force a black
-- ticket regardless of what's passed). Handles reveal rounds and
-- double-move legs. The destination is written to game_state_secret;
-- game_state_public.log only ever includes the destination if this round
-- is a reveal round.
-- -----------------------------------------------------------------------------
drop function if exists make_mrx_move(uuid, uuid, int, text, text);
create or replace function make_mrx_move(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_to_station int,
  p_edge_mode text,
  p_ticket_used text
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_gs game_state_public%rowtype;
  v_secret game_state_secret%rowtype;
  v_spent text;
  v_ticket_count int;
  v_is_reveal boolean;
  v_continuing_double boolean;
  v_new_travel_log jsonb;
  v_new_position_log jsonb;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;
  if v_caller.role <> 'mrx' then raise exception 'You do not control Mr. X'; end if;

  select * into v_gs from game_state_public where room_id = p_room_id for update;
  if v_gs.room_id is null then raise exception 'Game not started'; end if;
  if v_gs.phase <> 'playing' then raise exception 'Game is not in progress'; end if;
  if v_gs.turn_order[v_gs.turn_idx + 1] <> 'mrx' then
    raise exception 'It is not your turn';
  end if;

  v_spent := case when p_edge_mode = 'ferry' then 'black' else p_ticket_used end;
  v_ticket_count := (v_gs.mrx_tickets->>v_spent)::int;
  if v_ticket_count is null or v_ticket_count <= 0 then
    raise exception 'No % tickets remaining', v_spent;
  end if;

  v_is_reveal := v_gs.round in (3, 8, 13, 18, 22);
  v_continuing_double := v_gs.mrx_double_move_active and v_gs.mrx_double_move_legs_remaining > 1;

  select * into v_secret from game_state_secret where room_id = p_room_id for update;

  v_new_travel_log := v_gs.mrx_travel_log || jsonb_build_array(jsonb_build_object(
    'round', v_gs.round,
    'move', jsonb_array_length(v_gs.mrx_travel_log) + 1,
    'mode', v_spent
  ));
  v_new_position_log := v_secret.mrx_position_log || jsonb_build_array(jsonb_build_object(
    'round', v_gs.round, 'pos', p_to_station, 'mode', v_spent
  ));

  update game_state_secret
  set mrx_pos = p_to_station, mrx_position_log = v_new_position_log, updated_at = now()
  where room_id = p_room_id;

  update game_state_public
  set mrx_tickets = jsonb_set(mrx_tickets, array[v_spent], to_jsonb(v_ticket_count - 1)),
      mrx_revealed_pos = case when v_is_reveal then p_to_station else mrx_revealed_pos end,
      mrx_last_reveal_round = case when v_is_reveal then v_gs.round else mrx_last_reveal_round end,
      mrx_travel_log = v_new_travel_log,
      mrx_double_move_active = v_continuing_double,
      mrx_double_move_legs_remaining = case when v_continuing_double then v_gs.mrx_double_move_legs_remaining - 1 else 0 end,
      log = log || jsonb_build_array(jsonb_build_object(
        'kind', 'mrx_move',
        'payload', jsonb_build_object('mode', v_spent, 'revealedAt', case when v_is_reveal then p_to_station else null end)
      )),
      updated_at = now()
  where room_id = p_room_id;

  -- capture check: Mr. X walked onto a detective's station
  if exists (
    select 1 from jsonb_array_elements(v_gs.detectives) e
    where (e->>'pos')::int = p_to_station
  ) then
    update game_state_public
    set winner = 'detectives',
        phase = 'ended',
        log = log || jsonb_build_array(jsonb_build_object('kind', 'mrx_walked_into_detective'))
                   || jsonb_build_array(jsonb_build_object('kind', 'reveal_full_route', 'payload', jsonb_build_object('positionLog', v_new_position_log))),
        updated_at = now()
    where room_id = p_room_id;
    return;
  end if;

  if v_continuing_double then
    -- stay on Mr. X's turn for the second leg — no turn advance
    return;
  end if;

  perform advance_turn_internal(p_room_id);
end;
$$;


-- -----------------------------------------------------------------------------
-- activate_double_move — Mr. X plays a 2x card.
-- -----------------------------------------------------------------------------
drop function if exists activate_double_move(uuid, uuid);
create or replace function activate_double_move(
  p_room_id uuid,
  p_caller_player_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_gs game_state_public%rowtype;
  v_double_count int;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;
  if v_caller.role <> 'mrx' then raise exception 'You do not control Mr. X'; end if;

  select * into v_gs from game_state_public where room_id = p_room_id for update;
  if v_gs.room_id is null then raise exception 'Game not started'; end if;
  if v_gs.mrx_double_move_active then raise exception 'Double move already active'; end if;

  v_double_count := (v_gs.mrx_tickets->>'double')::int;
  if v_double_count is null or v_double_count <= 0 then
    raise exception 'No double-move cards remaining';
  end if;

  update game_state_public
  set mrx_tickets = jsonb_set(mrx_tickets, '{double}', to_jsonb(v_double_count - 1)),
      mrx_double_move_active = true,
      mrx_double_move_legs_remaining = 2,
      log = log || jsonb_build_array(jsonb_build_object('kind', 'double_move_activated')),
      updated_at = now()
  where room_id = p_room_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- send_message — post a chat message. For the "detectives" channel,
-- checks server-side that the caller's role is not "mrx" before allowing
-- the insert — this is the actual enforcement, not just RLS or a hidden
-- UI tab.
-- -----------------------------------------------------------------------------
drop function if exists send_message(uuid, uuid, text, text);
create or replace function send_message(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_channel text,
  p_body text
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  if p_channel not in ('all', 'detectives') then
    raise exception 'Invalid channel';
  end if;
  if p_channel = 'detectives' and v_caller.role = 'mrx' then
    raise exception 'Mr. X cannot post in the detectives channel';
  end if;
  if length(trim(p_body)) = 0 then
    raise exception 'Message cannot be empty';
  end if;
  if length(p_body) > 500 then
    raise exception 'Message too long';
  end if;

  insert into messages (room_id, channel, sender_player_id, sender_name, sender_role, body)
  values (p_room_id, p_channel, v_caller.id, v_caller.display_name, v_caller.role, p_body);
end;
$$;


-- -----------------------------------------------------------------------------
-- get_detective_messages — the ONLY way to read the "detectives" channel.
-- Checks the caller's role explicitly; returns nothing for Mr. X.
-- -----------------------------------------------------------------------------
drop function if exists get_detective_messages(uuid, uuid, timestamptz);
create or replace function get_detective_messages(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_after timestamptz default '1970-01-01'
) returns table (
  out_id uuid, out_sender_name text, out_sender_role text,
  out_body text, out_created_at timestamptz
)
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null or v_caller.role = 'mrx' then
    return; -- empty result set for non-players or Mr. X
  end if;

  return query
    select m.id, m.sender_name, m.sender_role, m.body, m.created_at
    from messages m
    where m.room_id = p_room_id and m.channel = 'detectives' and m.created_at > p_after
    order by m.created_at asc;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_all_channel_messages — the "all" channel is world-readable within a
-- room anyway (RLS already allows a direct select), but exposed as an RPC
-- too for a consistent client-side calling convention across both
-- channels.
-- -----------------------------------------------------------------------------
drop function if exists get_all_channel_messages(uuid, timestamptz);
create or replace function get_all_channel_messages(
  p_room_id uuid,
  p_after timestamptz default '1970-01-01'
) returns table (
  out_id uuid, out_sender_name text, out_sender_role text,
  out_body text, out_created_at timestamptz
)
language plpgsql
security definer
as $$
begin
  return query
    select m.id, m.sender_name, m.sender_role, m.body, m.created_at
    from messages m
    where m.room_id = p_room_id and m.channel = 'all' and m.created_at > p_after
    order by m.created_at asc;
end;
$$;


-- -----------------------------------------------------------------------------
-- propose_end_game — any player proposes ending the game. Fails if a
-- proposal is already pending (the unique index catches this) -- the
-- caller should just show the existing pending proposal instead.
-- Simplified first version: requires ALL players currently in the room
-- to vote yes (no inactive-player auto-skip yet -- see schema.sql notes
-- on end_game_proposals for why, and how this upgrades later).
-- -----------------------------------------------------------------------------
drop function if exists propose_end_game(uuid, uuid);
create or replace function propose_end_game(
  p_room_id uuid,
  p_caller_player_id uuid
) returns table (out_proposal_id uuid)
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_proposal_id uuid;
begin
  if not is_feature_enabled('end_game_vote_enabled', p_room_id) then
    raise exception 'The end-game vote feature is currently disabled';
  end if;

  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  insert into end_game_proposals (room_id, proposed_by_player_id, proposed_by_name)
  values (p_room_id, p_caller_player_id, v_caller.display_name)
  returning id into v_proposal_id;

  -- the proposer is automatically counted as a "yes" vote, since
  -- proposing to end the game is itself an expression of wanting to end it
  insert into end_game_votes (proposal_id, player_id, vote)
  values (v_proposal_id, p_caller_player_id, true);

  return query select v_proposal_id;
exception
  when unique_violation then
    raise exception 'A proposal to end the game is already pending';
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_end_game_proposal — check if there's a pending proposal for
-- this room, and how the votes currently stand (who's voted, how many
-- players total need to agree). Expired proposals (past their 60s
-- window with no resolution) are marked expired here as a side effect of
-- checking, so any client polling this naturally cleans them up.
-- -----------------------------------------------------------------------------
drop function if exists get_active_end_game_proposal(uuid);
create or replace function get_active_end_game_proposal(p_room_id uuid)
returns table (
  out_proposal_id uuid, out_proposed_by_name text, out_expires_at timestamptz,
  out_total_players int, out_yes_votes int, out_no_votes int, out_voted_player_ids uuid[]
)
language plpgsql
security definer
as $$
declare
  v_proposal end_game_proposals%rowtype;
  v_total_players int;
begin
  select * into v_proposal
  from end_game_proposals p
  where p.room_id = p_room_id and p.status = 'pending'
  order by p.created_at desc
  limit 1;

  if v_proposal.id is null then
    return; -- no pending proposal
  end if;

  if v_proposal.expires_at < now() then
    update end_game_proposals set status = 'expired' where id = v_proposal.id;
    return; -- treat as if there were none
  end if;

  select count(*) into v_total_players from players where room_id = p_room_id;

  return query
    select
      v_proposal.id, v_proposal.proposed_by_name, v_proposal.expires_at,
      v_total_players,
      (select count(*)::int from end_game_votes v where v.proposal_id = v_proposal.id and v.vote = true),
      (select count(*)::int from end_game_votes v where v.proposal_id = v_proposal.id and v.vote = false),
      (select coalesce(array_agg(v.player_id), '{}') from end_game_votes v where v.proposal_id = v_proposal.id);
end;
$$;


-- -----------------------------------------------------------------------------
-- vote_end_game — a player responds to the active proposal. If this vote
-- makes it unanimous yes (every player in the room has voted yes), the
-- game is marked ended. If anyone votes no, the proposal is immediately
-- rejected for everyone (no need to wait for further votes).
-- -----------------------------------------------------------------------------
drop function if exists vote_end_game(uuid, uuid, uuid, boolean);
create or replace function vote_end_game(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_proposal_id uuid,
  p_vote boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_proposal end_game_proposals%rowtype;
  v_total_players int;
  v_yes_votes int;
  v_active_ids uuid[];
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  select * into v_proposal from end_game_proposals p where p.id = p_proposal_id and p.room_id = p_room_id for update;
  if v_proposal.id is null or v_proposal.status <> 'pending' then
    raise exception 'This proposal is no longer active';
  end if;
  if v_proposal.expires_at < now() then
    update end_game_proposals set status = 'expired' where id = v_proposal.id;
    raise exception 'This proposal has expired';
  end if;

  insert into end_game_votes (proposal_id, player_id, vote)
  values (p_proposal_id, p_caller_player_id, p_vote)
  on conflict (proposal_id, player_id) do update set vote = excluded.vote, voted_at = now();

  if not p_vote then
    update end_game_proposals set status = 'rejected' where id = p_proposal_id;
    return;
  end if;

  select array_agg(out_player_id) into v_active_ids from get_active_player_ids(p_room_id);
  select count(*) into v_total_players from players where room_id = p_room_id and id = any(v_active_ids);
  select count(*) into v_yes_votes from end_game_votes where proposal_id = p_proposal_id and vote = true
    and player_id = any(v_active_ids);

  if v_yes_votes >= v_total_players then
    update end_game_proposals set status = 'accepted' where id = p_proposal_id;
    update game_state_public
    set phase = 'ended', winner = null,
        log = log || jsonb_build_array(jsonb_build_object('kind', 'ended_by_vote'))
    where room_id = p_room_id;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- heartbeat — updates last_seen_at so the lobby can show who's still
-- connected. Client calls this every ~15s while in a room.
-- -----------------------------------------------------------------------------
drop function if exists heartbeat(uuid);
create or replace function heartbeat(p_player_id uuid) returns void
language sql
security definer
as $$
  update players set last_seen_at = now() where id = p_player_id;
$$;


-- -----------------------------------------------------------------------------
-- flag_inactive_player -- any client can call this once it's determined
-- (via Presence, client-side) that a player has been gone past the grace
-- period. Creates a takeover_events row if one doesn't already exist for
-- that seat. Idempotent: if an event is already active for this seat,
-- just returns its id rather than erroring (many clients might notice
-- the same inactivity around the same time).
-- -----------------------------------------------------------------------------
drop function if exists flag_inactive_player(uuid, text);
create or replace function flag_inactive_player(
  p_room_id uuid,
  p_target_role text
) returns table (out_event_id uuid)
language plpgsql
security definer
as $$
declare
  v_existing takeover_events%rowtype;
  v_target players%rowtype;
  v_event_id uuid;
  v_nomination_window int := 30;
begin
  if not is_feature_enabled('takeovers_enabled', p_room_id) then
    return; -- feature disabled -- inactive seats just sit inactive, turn-timer keeps the game moving
  end if;
  select * into v_existing
  from takeover_events e
  where e.room_id = p_room_id and e.target_role = p_target_role
    and e.status not in ('completed', 'cancelled', 'expired');
  if v_existing.id is not null then
    return query select v_existing.id;
    return;
  end if;

  select * into v_target from players p where p.room_id = p_room_id and p.role = p_target_role;
  if v_target.id is null then
    raise exception 'No player currently holds that seat';
  end if;

  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    select nomination_window_seconds into v_nomination_window from app_settings where id = 1;
  end if;

  if p_target_role = 'mrx' then
    -- Mr.X: goes to the host first, per project design (scarcer/more
    -- contentious seat -- the host gets to decide wait vs. takeover
    -- before opening it up to nominations).
    insert into takeover_events (room_id, target_role, target_player_id, target_display_name, status)
    values (p_room_id, p_target_role, v_target.id, v_target.display_name, 'awaiting_host_decision')
    returning id into v_event_id;
  else
    -- Detective seat: skip the host-decision step entirely and open
    -- nominations immediately -- first person to click "I'll take over"
    -- wins as soon as they're the sole nominee (see nominate_self, which
    -- resolves a detective-seat event immediately on the first
    -- nomination rather than waiting for the window to close).
    insert into takeover_events (room_id, target_role, target_player_id, target_display_name, status, decision_deadline)
    values (p_room_id, p_target_role, v_target.id, v_target.display_name, 'nominating', now() + (v_nomination_window || ' seconds')::interval)
    returning id into v_event_id;
  end if;

  return query select v_event_id;
exception
  when unique_violation then
    select id into v_event_id from takeover_events
    where room_id = p_room_id and target_role = p_target_role
      and status not in ('completed', 'cancelled', 'expired')
    limit 1;
    return query select v_event_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_takeover_event -- fetch the current takeover event (if any)
-- for a room, plus nomination/vote tallies, so the client can render the
-- right UI state (host decision prompt, nomination window, voting, etc).
-- Also auto-expires an event whose decision_deadline has passed, same
-- pattern as get_active_end_game_proposal.
-- -----------------------------------------------------------------------------
drop function if exists get_active_takeover_event(uuid);
create or replace function get_active_takeover_event(p_room_id uuid)
returns table (
  out_event_id uuid, out_target_role text, out_target_display_name text,
  out_status text, out_decision_deadline timestamptz,
  out_nominee_ids uuid[], out_nominee_names text[],
  out_vote_counts jsonb -- {nominee_player_id: count}
)
language plpgsql
security definer
as $$
declare
  v_event takeover_events%rowtype;
begin
  select * into v_event
  from takeover_events e
  where e.room_id = p_room_id and e.status not in ('completed', 'cancelled', 'expired')
  order by e.created_at desc
  limit 1;

  if v_event.id is null then
    return;
  end if;

  if v_event.decision_deadline is not null and v_event.decision_deadline < now() then
    -- deadline passed with no resolution -- resolve it here rather than
    -- leaving it dangling (see resolve_expired_takeover for the logic)
    perform resolve_expired_takeover(v_event.id);
    select * into v_event from takeover_events where id = v_event.id;
    if v_event.status in ('completed', 'cancelled', 'expired') then
      return;
    end if;
  end if;

  return query
    select
      v_event.id, v_event.target_role, v_event.target_display_name,
      v_event.status, v_event.decision_deadline,
      (select coalesce(array_agg(n.player_id), '{}') from takeover_nominations n where n.event_id = v_event.id),
      (select coalesce(array_agg(pl.display_name), '{}')
         from takeover_nominations n join players pl on pl.id = n.player_id
         where n.event_id = v_event.id),
      (select coalesce(jsonb_object_agg(v.nominee_player_id::text, cnt), '{}'::jsonb)
         from (select nominee_player_id, count(*) cnt from takeover_votes where event_id = v_event.id group by nominee_player_id) v);
end;
$$;


-- -----------------------------------------------------------------------------
-- host_decide_takeover -- the host chooses "wait" or "takeover" for a
-- pending event. "wait" moves to a waiting state (stalled turns auto-play
-- via the existing turn-timer logic, handled client-side/by the normal
-- turn-timeout mechanism -- no special-casing needed here since a
-- stalled Mr.X's turn just times out like any other). "takeover" opens
-- the nomination window.
-- -----------------------------------------------------------------------------
drop function if exists host_decide_takeover(uuid, uuid, uuid, text);
create or replace function host_decide_takeover(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_event_id uuid,
  p_decision text -- 'wait' | 'takeover'
) returns void
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_event takeover_events%rowtype;
  v_nomination_window int := 30;
begin
  select * into v_room from rooms r where r.id = p_room_id;
  if v_room.id is null or v_room.host_player_id <> p_caller_player_id then
    raise exception 'Only the host can make this decision';
  end if;

  select * into v_event from takeover_events e where e.id = p_event_id and e.room_id = p_room_id for update;
  if v_event.id is null or v_event.status <> 'awaiting_host_decision' then
    raise exception 'This event is no longer awaiting a decision';
  end if;

  -- Only Mr.X's inactivity goes through the host wait-or-takeover
  -- decision + nomination/vote sequence. Detective seats use a simpler
  -- flow (flag_inactive_player routes them straight to 'nominating' with
  -- first-click-wins semantics -- see that function and
  -- resolve_expired_takeover's single-nominee-wins-immediately path,
  -- which already covers "first to click gets it" for a detective seat
  -- without needing a separate code path here). This function should
  -- never actually be called for a detective-seat event in practice
  -- (the client only shows the host-decision UI for target_role='mrx'),
  -- but this check exists as a server-side backstop against that
  -- assumption being violated.
  if v_event.target_role <> 'mrx' then
    raise exception 'Detective seat takeovers do not use a host decision step';
  end if;

  if p_decision = 'wait' then
    update takeover_events set status = 'waiting', updated_at = now() where id = p_event_id;
  elsif p_decision = 'takeover' then
    if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
      select nomination_window_seconds into v_nomination_window from app_settings where id = 1;
    end if;
    update takeover_events
    set status = 'nominating',
        decision_deadline = now() + (v_nomination_window || ' seconds')::interval,
        updated_at = now()
    where id = p_event_id;
  else
    raise exception 'Invalid decision: %', p_decision;
  end if;
end;
$$;



-- -----------------------------------------------------------------------------
-- start_takeover_from_waiting -- escalates a 'waiting' event into
-- 'nominating', usable by ANY player (not just the host) -- this is the
-- persistent "start takeover" button that stays available even after the
-- host initially chose "wait".
-- -----------------------------------------------------------------------------
drop function if exists start_takeover_from_waiting(uuid, uuid, uuid);
create or replace function start_takeover_from_waiting(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_event_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_event takeover_events%rowtype;
  v_nomination_window int := 30;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  select * into v_event from takeover_events e where e.id = p_event_id and e.room_id = p_room_id for update;
  if v_event.id is null or v_event.status <> 'waiting' then
    raise exception 'This event is not currently in a waiting state';
  end if;

  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    select nomination_window_seconds into v_nomination_window from app_settings where id = 1;
  end if;

  update takeover_events
  set status = 'nominating',
      decision_deadline = now() + (v_nomination_window || ' seconds')::interval,
      updated_at = now()
  where id = p_event_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- nominate_self -- a player volunteers to take over during the
-- nominating window. Anyone (including the target's own former self, if
-- they've come back -- though that's an edge case; auto-heal handles the
-- more common "came back before anyone confirmed" path separately) can
-- nominate themselves once.
-- -----------------------------------------------------------------------------
drop function if exists nominate_self(uuid, uuid, uuid);
create or replace function nominate_self(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_event_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_event takeover_events%rowtype;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  select * into v_event from takeover_events e where e.id = p_event_id and e.room_id = p_room_id for update;
  if v_event.id is null or v_event.status <> 'nominating' then
    raise exception 'Nominations are not currently open for this event';
  end if;
  if v_event.decision_deadline < now() then
    raise exception 'The nomination window has closed';
  end if;

  insert into takeover_nominations (event_id, player_id)
  values (p_event_id, p_caller_player_id)
  on conflict (event_id, player_id) do nothing;

  -- Detective seats: first-to-click-wins, per project design (not
  -- scarce/contentious like Mr.X) -- resolve IMMEDIATELY on the first
  -- nomination rather than waiting for the window to close. Mr.X's
  -- events still wait out the full nomination window, since multiple
  -- people might want to volunteer and a vote may be needed.
  if v_event.target_role <> 'mrx' then
    perform complete_takeover(p_event_id, p_caller_player_id);
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- vote_takeover_nominee -- during the voting stage (multiple nominees),
-- every player votes for exactly one nominee. Cannot vote for yourself.
-- -----------------------------------------------------------------------------
drop function if exists vote_takeover_nominee(uuid, uuid, uuid, uuid);
create or replace function vote_takeover_nominee(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_event_id uuid,
  p_nominee_player_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_event takeover_events%rowtype;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  if p_caller_player_id = p_nominee_player_id then
    raise exception 'You cannot vote for yourself';
  end if;

  select * into v_event from takeover_events e where e.id = p_event_id and e.room_id = p_room_id;
  if v_event.id is null or v_event.status <> 'voting' then
    raise exception 'Voting is not currently open for this event';
  end if;
  if v_event.decision_deadline < now() then
    raise exception 'The voting window has closed';
  end if;
  if not exists (select 1 from takeover_nominations n where n.event_id = p_event_id and n.player_id = p_nominee_player_id) then
    raise exception 'That player is not a nominee for this event';
  end if;

  insert into takeover_votes (event_id, voter_player_id, nominee_player_id)
  values (p_event_id, p_caller_player_id, p_nominee_player_id)
  on conflict (event_id, voter_player_id) do update set nominee_player_id = excluded.nominee_player_id, voted_at = now();
end;
$$;


-- -----------------------------------------------------------------------------
-- resolve_expired_takeover -- internal helper (not called directly by
-- clients; invoked from get_active_takeover_event when a deadline has
-- passed). Decides what happens when a nomination or voting window
-- closes with no further input:
--   - nominating window closed, 0 nominees: no volunteers -> for Mr.X,
--     the game ends (abandoned/inconclusive, per project design); for a
--     detective seat, the event just expires and the "start takeover"
--     button remains available to try again later.
--   - nominating window closed, exactly 1 nominee: they win directly, no
--     vote needed.
--   - nominating window closed, 2+ nominees: move to voting stage.
--   - voting window closed: whoever has the most votes wins (ties broken
--     by whoever was nominated first, for determinism).
-- -----------------------------------------------------------------------------
drop function if exists resolve_expired_takeover(uuid);
create or replace function resolve_expired_takeover(p_event_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_event takeover_events%rowtype;
  v_nominee_count int;
  v_sole_nominee uuid;
  v_poll_window int := 60;
  v_winner uuid;
begin
  select * into v_event from takeover_events e where e.id = p_event_id for update;
  if v_event.id is null then return; end if;

  if v_event.status = 'nominating' then
    select count(*) into v_nominee_count from takeover_nominations where event_id = p_event_id;

    if v_nominee_count = 0 then
      if v_event.target_role = 'mrx' then
        update game_state_public set phase = 'ended', winner = null,
          log = log || jsonb_build_array(jsonb_build_object('kind', 'ended_no_takeover'))
        where room_id = v_event.room_id;
      end if;
      update takeover_events set status = 'expired', updated_at = now() where id = p_event_id;
      return;
    end if;

    if v_nominee_count = 1 then
      select player_id into v_sole_nominee from takeover_nominations where event_id = p_event_id limit 1;
      perform complete_takeover(p_event_id, v_sole_nominee);
      return;
    end if;

    -- 2+ nominees -> move to voting
    if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
      select poll_window_seconds into v_poll_window from app_settings where id = 1;
    end if;
    update takeover_events
    set status = 'voting', decision_deadline = now() + (v_poll_window || ' seconds')::interval, updated_at = now()
    where id = p_event_id;
    return;
  end if;

  if v_event.status = 'voting' then
    select nominee_player_id into v_winner
    from takeover_votes
    where event_id = p_event_id
    group by nominee_player_id
    order by count(*) desc,
             min((select nominated_at from takeover_nominations n where n.event_id = p_event_id and n.player_id = nominee_player_id)) asc
    limit 1;

    if v_winner is null then
      -- nobody voted at all -- fall back to whoever was nominated first
      select player_id into v_winner from takeover_nominations where event_id = p_event_id order by nominated_at asc limit 1;
    end if;

    perform complete_takeover(p_event_id, v_winner);
    return;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- complete_takeover -- internal helper: actually transfers the seat.
--   - Mr.X: winner's OLD role (if they controlled detectives) becomes
--     unassigned; game_state_secret / game_state_public are untouched
--     (Mr.X's hidden state carries over as-is, just under new control);
--     the winner's players.role becomes 'mrx'. The vacated detective
--     seat(s), if any, are left ownerless until reassign_vacated_seat()
--     is called (the "new Mr.X picks someone to inherit their old
--     detectives" step) -- a separate explicit action, not automatic,
--     since the design calls for the new Mr.X to choose.
--   - Detective seat: winner's role becomes the target_role directly
--     (they now control this in ADDITION to whatever they already
--     controlled -- see the note on merging below).
-- -----------------------------------------------------------------------------
drop function if exists complete_takeover(uuid, uuid);
create or replace function complete_takeover(p_event_id uuid, p_winner_player_id uuid) returns void
language plpgsql
security definer
as $$
declare
  v_event takeover_events%rowtype;
  v_winner players%rowtype;
  v_merged_role text;
begin
  select * into v_event from takeover_events e where e.id = p_event_id;
  if v_event.id is null then return; end if;

  select * into v_winner from players p where p.id = p_winner_player_id;
  if v_winner.id is null then
    update takeover_events set status = 'cancelled', updated_at = now() where id = p_event_id;
    return;
  end if;

  -- Auto-heal check: if the ORIGINAL target player's presence has
  -- resumed by now, don't actually transfer -- cancel the takeover and
  -- leave them in place. This is enforced here (at confirmation time),
  -- not just when the event was opened, per the project design ("keep
  -- their seat if not yet confirmed"). NOTE: presence itself is tracked
  -- client-side (Supabase Realtime Presence channels aren't queryable
  -- from SQL) -- so this specific check is performed by the CALLING
  -- client before invoking whichever RPC ultimately calls this function,
  -- not inside this function itself. This comment exists so that
  -- invariant is documented at the point where it matters, even though
  -- the actual guard lives in the client (src/lib/usePresence.js +
  -- the takeover UI components).

  if v_event.target_role = 'mrx' then
    -- winner becomes mrx; their old role (if any) is simply left behind
    -- on their own players row being overwritten -- but we want to KEEP
    -- track of what they used to control so it can be offered onward.
    -- We stash it in target_display_name's counterpart via a temp swap:
    -- simplest correct approach is to just update players.role directly.
    update players set role = 'mrx' where id = p_winner_player_id;
  else
    -- detective seat: merge the vacated seat's detectives into whatever
    -- the winner already controls (a player can hold multiple detective
    -- seats' worth of detectives as one comma-joined role).
    if v_winner.role = 'mrx' then
      raise exception 'Mr. X cannot also take over a detective seat';
    end if;
    v_merged_role := case
      when v_winner.role is null or v_winner.role = '' then v_event.target_role
      else v_winner.role || ',' || v_event.target_role
    end;
    update players set role = v_merged_role where id = p_winner_player_id;
  end if;

  -- the original (inactive) player's row, if it still exists and still
  -- holds the OLD role, is removed -- their seat has been reassigned.
  if v_event.target_player_id is not null then
    delete from players where id = v_event.target_player_id and role = v_event.target_role;
  end if;

  update takeover_events
  set status = 'completed', winner_player_id = p_winner_player_id, updated_at = now()
  where id = p_event_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- cancel_takeover_event -- called when auto-heal detects the original
-- player has returned before a takeover was confirmed (State C/D from
-- the design: grace period or open nomination/voting, nobody's won yet).
-- Client-side presence detection triggers this; it just marks the event
-- cancelled so it stops showing to anyone.
-- -----------------------------------------------------------------------------
drop function if exists cancel_takeover_event(uuid, uuid);
create or replace function cancel_takeover_event(p_room_id uuid, p_event_id uuid) returns void
language plpgsql
security definer
as $$
begin
  update takeover_events
  set status = 'cancelled', updated_at = now()
  where id = p_event_id and room_id = p_room_id and status not in ('completed', 'cancelled', 'expired');
end;
$$;


-- -----------------------------------------------------------------------------
-- reassign_vacated_seat -- after a new Mr.X takes over, if they
-- previously controlled detective seat(s), this is the explicit "pick
-- one active player to receive them" step.
-- -----------------------------------------------------------------------------
drop function if exists reassign_vacated_seat(uuid, uuid, text, uuid);
create or replace function reassign_vacated_seat(
  p_room_id uuid,
  p_caller_player_id uuid,   -- must be the new Mr.X making this choice
  p_vacated_role text,       -- the detective role string the new Mr.X used to hold
  p_recipient_player_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_caller players%rowtype;
  v_recipient players%rowtype;
  v_merged_role text;
begin
  select * into v_room from rooms r where r.id = p_room_id;
  if v_room.id is null then raise exception 'Room not found'; end if;

  select * into v_caller from players p where p.id = p_caller_player_id and p.room_id = p_room_id;
  if v_caller.id is null or v_caller.role <> 'mrx' then
    raise exception 'Only the current Mr. X can reassign a vacated detective seat';
  end if;

  select * into v_recipient from players p where p.id = p_recipient_player_id and p.room_id = p_room_id;
  if v_recipient.id is null then raise exception 'Recipient is not a player in this room'; end if;
  if v_recipient.role = 'mrx' then raise exception 'Cannot assign detectives to Mr. X'; end if;

  v_merged_role := case
    when v_recipient.role is null or v_recipient.role = '' then p_vacated_role
    else v_recipient.role || ',' || p_vacated_role
  end;

  update players set role = v_merged_role where id = p_recipient_player_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- propose_pause -- any player proposes pausing the game. Same
-- proposal/vote shape as propose_end_game. Fails if one's already
-- pending, or if the game is already paused.
-- -----------------------------------------------------------------------------
drop function if exists propose_pause(uuid, uuid);
create or replace function propose_pause(
  p_room_id uuid,
  p_caller_player_id uuid
) returns table (out_proposal_id uuid)
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_gs game_state_public%rowtype;
  v_proposal_id uuid;
begin
  if not is_feature_enabled('pause_resume_enabled', p_room_id) then
    raise exception 'The pause/resume feature is currently disabled';
  end if;

  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  select * into v_gs from game_state_public where room_id = p_room_id;
  if v_gs.phase = 'paused' then raise exception 'The game is already paused'; end if;
  if v_gs.phase = 'ended' then raise exception 'The game has already ended'; end if;

  insert into pause_proposals (room_id, proposed_by_player_id, proposed_by_name)
  values (p_room_id, p_caller_player_id, v_caller.display_name)
  returning id into v_proposal_id;

  insert into pause_votes (proposal_id, player_id, vote)
  values (v_proposal_id, p_caller_player_id, true);

  return query select v_proposal_id;
exception
  when unique_violation then
    raise exception 'A proposal to pause the game is already pending';
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_pause_proposal -- same shape as get_active_end_game_proposal.
-- -----------------------------------------------------------------------------
drop function if exists get_active_pause_proposal(uuid);
create or replace function get_active_pause_proposal(p_room_id uuid)
returns table (out_proposal_id uuid, out_proposed_by_name text, out_expires_at timestamptz,
               out_total_players int, out_yes_votes int, out_no_votes int, out_voted_player_ids uuid[])
language plpgsql
security definer
as $$
declare
  v_proposal pause_proposals%rowtype;
  v_total_players int;
begin
  select * into v_proposal from pause_proposals p where p.room_id = p_room_id and p.status = 'pending'
    order by p.created_at desc limit 1;
  if v_proposal.id is null then return; end if;
  if v_proposal.expires_at < now() then
    update pause_proposals set status = 'expired' where id = v_proposal.id;
    return;
  end if;

  select count(*) into v_total_players from players where room_id = p_room_id;

  return query
    select v_proposal.id, v_proposal.proposed_by_name, v_proposal.expires_at, v_total_players,
      (select count(*)::int from pause_votes v where v.proposal_id = v_proposal.id and v.vote = true),
      (select count(*)::int from pause_votes v where v.proposal_id = v_proposal.id and v.vote = false),
      (select coalesce(array_agg(v.player_id), '{}') from pause_votes v where v.proposal_id = v_proposal.id);
end;
$$;


-- -----------------------------------------------------------------------------
-- vote_pause -- same shape as vote_end_game. On unanimous yes, actually
-- pauses the game: sets game_state_public.phase = 'paused' and records
-- the resume deadline in room_pauses (admin-configurable hours, default 36).
-- -----------------------------------------------------------------------------
drop function if exists vote_pause(uuid, uuid, uuid, boolean);
create or replace function vote_pause(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_proposal_id uuid,
  p_vote boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_proposal pause_proposals%rowtype;
  v_total_players int;
  v_yes_votes int;
  v_deadline_hours int := 36;
  v_active_ids uuid[];
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  select * into v_proposal from pause_proposals p where p.id = p_proposal_id and p.room_id = p_room_id for update;
  if v_proposal.id is null or v_proposal.status <> 'pending' then
    raise exception 'This proposal is no longer active';
  end if;
  if v_proposal.expires_at < now() then
    update pause_proposals set status = 'expired' where id = v_proposal.id;
    raise exception 'This proposal has expired';
  end if;

  insert into pause_votes (proposal_id, player_id, vote)
  values (p_proposal_id, p_caller_player_id, p_vote)
  on conflict (proposal_id, player_id) do update set vote = excluded.vote, voted_at = now();

  if not p_vote then
    update pause_proposals set status = 'rejected' where id = p_proposal_id;
    return;
  end if;

  select array_agg(out_player_id) into v_active_ids from get_active_player_ids(p_room_id);
  select count(*) into v_total_players from players where room_id = p_room_id and id = any(v_active_ids);
  select count(*) into v_yes_votes from pause_votes where proposal_id = p_proposal_id and vote = true
    and player_id = any(v_active_ids);

  if v_yes_votes >= v_total_players then
    update pause_proposals set status = 'accepted' where id = p_proposal_id;

    if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
      select pause_resume_deadline_hours into v_deadline_hours from app_settings where id = 1;
    end if;

    update game_state_public
    set phase = 'paused',
        log = log || jsonb_build_array(jsonb_build_object('kind', 'game_paused'))
    where room_id = p_room_id;

    insert into room_pauses (room_id, resume_deadline, paused_by_name)
    values (p_room_id, now() + (v_deadline_hours || ' hours')::interval, v_caller.display_name)
    on conflict (room_id) do update set
      paused_at = now(), resume_deadline = excluded.resume_deadline, paused_by_name = excluded.paused_by_name;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- resume_game -- any single active player can resume (lower stakes than
-- pausing, per project design -- no vote needed). Sets phase back to
-- 'playing' and clears the room_pauses row.
-- -----------------------------------------------------------------------------
drop function if exists resume_game(uuid, uuid);
create or replace function resume_game(
  p_room_id uuid,
  p_caller_player_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_caller players%rowtype;
  v_gs game_state_public%rowtype;
begin
  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  select * into v_gs from game_state_public where room_id = p_room_id;
  if v_gs.phase <> 'paused' then raise exception 'The game is not currently paused'; end if;

  update game_state_public
  set phase = 'playing',
      log = log || jsonb_build_array(jsonb_build_object('kind', 'game_resumed', 'payload', jsonb_build_object('by', v_caller.display_name)))
  where room_id = p_room_id;

  delete from room_pauses where room_id = p_room_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_pause_status -- lets the client show "paused, resumes-or-ends in Xh"
-- countdown. Returns nothing if the room isn't currently paused.
-- -----------------------------------------------------------------------------
drop function if exists get_pause_status(uuid);
create or replace function get_pause_status(p_room_id uuid)
returns table (out_paused_at timestamptz, out_resume_deadline timestamptz, out_paused_by_name text)
language sql
security definer
as $$
  select paused_at, resume_deadline, paused_by_name from room_pauses where room_id = p_room_id;
$$;


-- -----------------------------------------------------------------------------
-- check_player_still_in_room -- lets a client verify its own stored
-- player_id still corresponds to a real seat in the room. Used to detect
-- "I've been replaced by a takeover while I was gone" -- if this returns
-- false, the client shows a clear "you were replaced, now spectating"
-- screen instead of silently continuing to believe it still controls a
-- seat that's actually been reassigned to someone else.
-- -----------------------------------------------------------------------------
drop function if exists check_player_still_in_room(uuid, uuid);
create or replace function check_player_still_in_room(
  p_room_id uuid,
  p_player_id uuid
) returns table (out_still_in_room boolean, out_replaced_role text)
language plpgsql
security definer
as $$
declare
  v_exists boolean;
  v_last_known_role text;
begin
  select exists(select 1 from players where id = p_player_id and room_id = p_room_id) into v_exists;

  if v_exists then
    return query select true, null::text;
    return;
  end if;

  -- player row is gone -- try to find what role they used to hold, via
  -- the most recent completed takeover event that targeted them, purely
  -- so the "you were replaced" message can say what they lost (e.g.
  -- "Mr. X" or "Detectives 2 & 3") rather than a generic message.
  select target_role into v_last_known_role
  from takeover_events
  where room_id = p_room_id and target_player_id = p_player_id and status = 'completed'
  order by updated_at desc
  limit 1;

  return query select false, v_last_known_role;
end;
$$;


-- -----------------------------------------------------------------------------
-- is_feature_enabled -- internal helper: checks a named feature toggle in
-- app_settings, defaulting to TRUE if app_settings doesn't exist (the
-- access-control system is optional; multiplayer works without it, with
-- every feature enabled by default in that case).
-- -----------------------------------------------------------------------------
drop function if exists is_feature_enabled(text, uuid);
create or replace function is_feature_enabled(p_feature_name text, p_room_id uuid default null) returns boolean
language plpgsql
security definer
as $$
declare
  v_enabled boolean := true;
  v_override boolean;
  v_override_column text;
begin
  if not exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    return true;
  end if;

  -- Check the room-level override first, if a room was given. The
  -- override column naming convention is always "<feature_name>_override"
  -- (e.g. takeovers_enabled -> takeovers_enabled_override), matching the
  -- columns added to `rooms` for exactly this purpose.
  if p_room_id is not null then
    v_override_column := p_feature_name || '_override';
    begin
      execute format('select %I from rooms where id = %L', v_override_column, p_room_id) into v_override;
      if v_override is not null then
        return v_override;
      end if;
    exception
      when others then
        null; -- column doesn't exist or room not found -- fall through to the global setting
    end;
  end if;

  execute format('select %I from app_settings where id = 1', p_feature_name) into v_enabled;
  return coalesce(v_enabled, true);
exception
  when others then
    return true; -- unknown feature name or column missing -- fail open rather than break the game
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_player_ids -- internal helper: which players in a room are
-- considered "active" server-side, using last_seen_at (heartbeat) against
-- presence_grace_period_seconds as the threshold. This is the
-- server-visible proxy for Presence (which itself lives client-side and
-- isn't queryable from SQL) -- used by vote-resolution logic so
-- "auto-skip inactive players" has something concrete to check.
-- -----------------------------------------------------------------------------
drop function if exists get_active_player_ids(uuid);
create or replace function get_active_player_ids(p_room_id uuid) returns table (out_player_id uuid)
language plpgsql
security definer
as $$
declare
  v_grace_seconds int := 25;
begin
  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    select presence_grace_period_seconds into v_grace_seconds from app_settings where id = 1;
  end if;
  return query
    select id from players
    where room_id = p_room_id and last_seen_at > now() - (v_grace_seconds || ' seconds')::interval;
end;
$$;


-- -----------------------------------------------------------------------------
-- propose_takeover_reversal -- the REPLACED player proposes getting their
-- seat back, within takeover_reversal_window_minutes of the takeover
-- completing. Requires takeover_reversal_enabled (subject to room
-- override). Anyone currently active must unanimously agree (including
-- whoever currently holds the seat) for it to pass.
-- -----------------------------------------------------------------------------
drop function if exists propose_takeover_reversal(uuid, uuid, uuid);
create or replace function propose_takeover_reversal(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_takeover_event_id uuid
) returns table (out_proposal_id uuid)
language plpgsql
security definer
as $$
declare
  v_event takeover_events%rowtype;
  v_window_minutes int := 5;
  v_proposal_id uuid;
begin
  if not is_feature_enabled('takeover_reversal_enabled', p_room_id) then
    raise exception 'The takeover reversal feature is currently disabled';
  end if;

  select * into v_event from takeover_events e where e.id = p_takeover_event_id and e.room_id = p_room_id;
  if v_event.id is null or v_event.status <> 'completed' then
    raise exception 'That takeover is not in a completed state';
  end if;
  if v_event.target_player_id <> p_caller_player_id then
    raise exception 'Only the player who was replaced can propose reversing this takeover';
  end if;

  if exists (select 1 from information_schema.tables where table_name = 'app_settings') then
    select takeover_reversal_window_minutes into v_window_minutes from app_settings where id = 1;
  end if;
  if v_event.updated_at < now() - (v_window_minutes || ' minutes')::interval then
    raise exception 'The window to request a reversal has passed';
  end if;

  insert into takeover_reversal_proposals (room_id, takeover_event_id, proposed_by_player_id, proposed_by_name, original_role)
  values (p_room_id, p_takeover_event_id, p_caller_player_id, v_event.target_display_name, v_event.target_role)
  returning id into v_proposal_id;

  insert into takeover_reversal_votes (proposal_id, player_id, vote)
  values (v_proposal_id, p_caller_player_id, true);

  return query select v_proposal_id;
exception
  when unique_violation then
    raise exception 'A reversal proposal for this takeover is already pending';
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_takeover_reversal -- lets the client show a pending
-- reversal vote, same shape as get_active_end_game_proposal.
-- -----------------------------------------------------------------------------
drop function if exists get_active_takeover_reversal(uuid);
create or replace function get_active_takeover_reversal(p_room_id uuid)
returns table (out_proposal_id uuid, out_proposed_by_name text, out_original_role text, out_expires_at timestamptz,
               out_total_active int, out_yes_votes int)
language plpgsql
security definer
as $$
declare
  v_proposal takeover_reversal_proposals%rowtype;
  v_active_ids uuid[];
begin
  select * into v_proposal from takeover_reversal_proposals p
    where p.room_id = p_room_id and p.status = 'pending' order by p.created_at desc limit 1;
  if v_proposal.id is null then return; end if;
  if v_proposal.expires_at < now() then
    update takeover_reversal_proposals set status = 'expired' where id = v_proposal.id;
    return;
  end if;

  select array_agg(out_player_id) into v_active_ids from get_active_player_ids(p_room_id);

  return query
    select v_proposal.id, v_proposal.proposed_by_name, v_proposal.original_role, v_proposal.expires_at,
      (select count(*)::int from players where room_id = p_room_id and id = any(v_active_ids)),
      (select count(*)::int from takeover_reversal_votes v where v.proposal_id = v_proposal.id and v.vote = true
         and v.player_id = any(v_active_ids));
end;
$$;


-- -----------------------------------------------------------------------------
-- vote_takeover_reversal -- unanimous active-players-agree, same pattern
-- as vote_end_game/vote_pause. On success, transfers the seat back to
-- the original player (role-only, no state rewind -- any moves already
-- made under the new controller stand as-is).
-- -----------------------------------------------------------------------------
drop function if exists vote_takeover_reversal(uuid, uuid, uuid, boolean);
create or replace function vote_takeover_reversal(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_proposal_id uuid,
  p_vote boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_proposal takeover_reversal_proposals%rowtype;
  v_active_ids uuid[];
  v_total_active int;
  v_yes_votes int;
  v_current_holder players%rowtype;
begin
  select * into v_proposal from takeover_reversal_proposals p where p.id = p_proposal_id and p.room_id = p_room_id for update;
  if v_proposal.id is null or v_proposal.status <> 'pending' then
    raise exception 'This proposal is no longer active';
  end if;
  if v_proposal.expires_at < now() then
    update takeover_reversal_proposals set status = 'expired' where id = v_proposal.id;
    raise exception 'This proposal has expired';
  end if;

  insert into takeover_reversal_votes (proposal_id, player_id, vote)
  values (p_proposal_id, p_caller_player_id, p_vote)
  on conflict (proposal_id, player_id) do update set vote = excluded.vote, voted_at = now();

  if not p_vote then
    update takeover_reversal_proposals set status = 'rejected' where id = p_proposal_id;
    return;
  end if;

  select array_agg(out_player_id) into v_active_ids from get_active_player_ids(p_room_id);
  select count(*) into v_total_active from players where room_id = p_room_id and id = any(v_active_ids);
  select count(*) into v_yes_votes from takeover_reversal_votes where proposal_id = p_proposal_id and vote = true
    and player_id = any(v_active_ids);

  if v_yes_votes >= v_total_active then
    update takeover_reversal_proposals set status = 'accepted' where id = p_proposal_id;

    -- transfer the seat back: whoever currently holds original_role loses
    -- it (or has it stripped out of their merged detective role string),
    -- and the original player's row (still present -- they're spectating,
    -- not deleted) gets it reassigned.
    select * into v_current_holder from players where room_id = p_room_id and (
      role = v_proposal.original_role or role like '%' || v_proposal.original_role || '%'
    ) limit 1;

    if v_current_holder.id is not null then
      if v_current_holder.role = v_proposal.original_role then
        delete from players where id = v_current_holder.id;
      else
        -- current holder has merged roles (e.g. "d0,d1,d2" and only
        -- "d1" should be given back) -- strip just that piece out
        update players
        set role = array_to_string(
          array(select unnest(string_to_array(role, ',')) except select v_proposal.original_role),
          ','
        )
        where id = v_current_holder.id;
      end if;
    end if;

    update players set role = v_proposal.original_role
    where room_id = p_room_id and id = (
      select target_player_id from takeover_events where id = v_proposal.takeover_event_id
    );
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- REDISTRIBUTE ROLES -- same propose/vote pattern, but instead of a
-- simple yes/no, the host proposes a FULL new seat mapping (every player
-- ID -> new role, covering every seat including Mr.X). Stored as JSONB
-- so we don't need a whole extra table for "proposed assignments".
-- Requires redistribute_roles_enabled. Unanimous ACTIVE-players-agree,
-- same as every other vote in this project. On success, applies every
-- seat transfer atomically -- game state (positions, tickets, hidden
-- Mr.X data) is completely untouched, only players.role changes.
-- -----------------------------------------------------------------------------
create table if not exists redistribute_proposals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  proposed_by_player_id uuid references players(id) on delete set null,
  proposed_by_name text not null,
  new_assignments jsonb not null, -- {player_id: new_role, ...} covering every seat
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 seconds')
);

create unique index if not exists redistribute_proposals_pending_unique
  on redistribute_proposals(room_id)
  where status = 'pending';

create table if not exists redistribute_votes (
  proposal_id uuid not null references redistribute_proposals(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  vote boolean not null,
  voted_at timestamptz not null default now(),
  primary key (proposal_id, player_id)
);

alter table redistribute_proposals enable row level security;
alter table redistribute_votes enable row level security;

drop policy if exists redistribute_proposals_select_all on redistribute_proposals;
create policy redistribute_proposals_select_all on redistribute_proposals for select using (true);
drop policy if exists redistribute_proposals_deny_direct_write on redistribute_proposals;
create policy redistribute_proposals_deny_direct_write on redistribute_proposals for all using (false) with check (false);

drop policy if exists redistribute_votes_select_all on redistribute_votes;
create policy redistribute_votes_select_all on redistribute_votes for select using (true);
drop policy if exists redistribute_votes_deny_direct_write on redistribute_votes;
create policy redistribute_votes_deny_direct_write on redistribute_votes for all using (false) with check (false);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'redistribute_proposals') then
    alter publication supabase_realtime add table redistribute_proposals;
  end if;
end $$;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'redistribute_votes') then
    alter publication supabase_realtime add table redistribute_votes;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- propose_redistribute_roles -- host-only. p_new_assignments is a JSON
-- object mapping player_id (as text) -> new role string. Must cover
-- every player currently in the room, exactly once, using a valid seat
-- layout (same validation as create_room/join_room's role checks).
-- -----------------------------------------------------------------------------
drop function if exists propose_redistribute_roles(uuid, uuid, jsonb);
create or replace function propose_redistribute_roles(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_new_assignments jsonb
) returns table (out_proposal_id uuid)
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_caller players%rowtype;
  v_proposal_id uuid;
  v_all_player_ids uuid[];
  v_assigned_player_ids uuid[];
  v_valid_roles text[];
  v_assigned_roles text[];
  v_key text;
  v_val text;
begin
  if not is_feature_enabled('redistribute_roles_enabled', p_room_id) then
    raise exception 'The redistribute roles feature is currently disabled';
  end if;

  select * into v_room from rooms r where r.id = p_room_id;
  if v_room.id is null or v_room.host_player_id <> p_caller_player_id then
    raise exception 'Only the host can propose redistributing roles';
  end if;

  select * into v_caller from players pl where pl.id = p_caller_player_id and pl.room_id = p_room_id;
  if v_caller.id is null then raise exception 'Not a player in this room'; end if;

  -- validate: every current player appears exactly once, and every
  -- assigned role is a legal seat for this room's layout
  select array_agg(id) into v_all_player_ids from players where room_id = p_room_id;
  select array_cat(array['mrx'], array_agg(out_seat_role)) into v_valid_roles
    from compute_seat_layout(v_room.num_detectives, v_room.total_players);

  v_assigned_player_ids := '{}';
  v_assigned_roles := '{}';
  for v_key, v_val in select * from jsonb_each_text(p_new_assignments) loop
    v_assigned_player_ids := array_append(v_assigned_player_ids, v_key::uuid);
    v_assigned_roles := array_append(v_assigned_roles, v_val);
    if not (v_val = any(v_valid_roles)) then
      raise exception 'Invalid role % in proposed assignment', v_val;
    end if;
  end loop;

  if (select array_agg(x order by x) from unnest(v_all_player_ids) x) <> (select array_agg(x order by x) from unnest(v_assigned_player_ids) x) then
    raise exception 'Proposed assignment must cover every current player exactly once';
  end if;
  if (select array_agg(x order by x) from unnest(v_valid_roles) x) <> (select array_agg(x order by x) from unnest(v_assigned_roles) x) then
    raise exception 'Proposed assignment must use every seat in this room''s layout exactly once';
  end if;

  insert into redistribute_proposals (room_id, proposed_by_player_id, proposed_by_name, new_assignments)
  values (p_room_id, p_caller_player_id, v_caller.display_name, p_new_assignments)
  returning id into v_proposal_id;

  insert into redistribute_votes (proposal_id, player_id, vote)
  values (v_proposal_id, p_caller_player_id, true);

  return query select v_proposal_id;
exception
  when unique_violation then
    raise exception 'A redistribute-roles proposal is already pending';
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_redistribute_proposal -- same shape as other active-proposal getters.
-- -----------------------------------------------------------------------------
drop function if exists get_active_redistribute_proposal(uuid);
create or replace function get_active_redistribute_proposal(p_room_id uuid)
returns table (out_proposal_id uuid, out_proposed_by_name text, out_new_assignments jsonb, out_expires_at timestamptz,
               out_total_active int, out_yes_votes int)
language plpgsql
security definer
as $$
declare
  v_proposal redistribute_proposals%rowtype;
  v_active_ids uuid[];
begin
  select * into v_proposal from redistribute_proposals p
    where p.room_id = p_room_id and p.status = 'pending' order by p.created_at desc limit 1;
  if v_proposal.id is null then return; end if;
  if v_proposal.expires_at < now() then
    update redistribute_proposals set status = 'expired' where id = v_proposal.id;
    return;
  end if;

  select array_agg(out_player_id) into v_active_ids from get_active_player_ids(p_room_id);

  return query
    select v_proposal.id, v_proposal.proposed_by_name, v_proposal.new_assignments, v_proposal.expires_at,
      (select count(*)::int from players where room_id = p_room_id and id = any(v_active_ids)),
      (select count(*)::int from redistribute_votes v where v.proposal_id = v_proposal.id and v.vote = true
         and v.player_id = any(v_active_ids));
end;
$$;


-- -----------------------------------------------------------------------------
-- vote_redistribute_roles -- unanimous active-agree. On success, applies
-- every seat reassignment atomically in one transaction.
-- -----------------------------------------------------------------------------
drop function if exists vote_redistribute_roles(uuid, uuid, uuid, boolean);
create or replace function vote_redistribute_roles(
  p_room_id uuid,
  p_caller_player_id uuid,
  p_proposal_id uuid,
  p_vote boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_proposal redistribute_proposals%rowtype;
  v_active_ids uuid[];
  v_total_active int;
  v_yes_votes int;
  v_key text;
  v_val text;
begin
  select * into v_proposal from redistribute_proposals p where p.id = p_proposal_id and p.room_id = p_room_id for update;
  if v_proposal.id is null or v_proposal.status <> 'pending' then
    raise exception 'This proposal is no longer active';
  end if;
  if v_proposal.expires_at < now() then
    update redistribute_proposals set status = 'expired' where id = v_proposal.id;
    raise exception 'This proposal has expired';
  end if;

  insert into redistribute_votes (proposal_id, player_id, vote)
  values (p_proposal_id, p_caller_player_id, p_vote)
  on conflict (proposal_id, player_id) do update set vote = excluded.vote, voted_at = now();

  if not p_vote then
    update redistribute_proposals set status = 'rejected' where id = p_proposal_id;
    return;
  end if;

  select array_agg(out_player_id) into v_active_ids from get_active_player_ids(p_room_id);
  select count(*) into v_total_active from players where room_id = p_room_id and id = any(v_active_ids);
  select count(*) into v_yes_votes from redistribute_votes where proposal_id = p_proposal_id and vote = true
    and player_id = any(v_active_ids);

  if v_yes_votes >= v_total_active then
    update redistribute_proposals set status = 'accepted' where id = p_proposal_id;

    for v_key, v_val in select * from jsonb_each_text(v_proposal.new_assignments) loop
      update players set role = v_val where id = v_key::uuid and room_id = p_room_id;
    end loop;
  end if;
end;
$$;
