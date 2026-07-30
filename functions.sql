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
drop function if exists create_room(text, int, int, text, text);
create or replace function create_room(
  p_map_id text,
  p_num_detectives int,
  p_total_players int,
  p_host_display_name text,
  p_host_role text default 'mrx'
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
begin
  if p_num_detectives < 3 or p_num_detectives > 20 then
    raise exception 'num_detectives must be between 3 and 20';
  end if;
  if p_total_players < 2 then
    raise exception 'total_players must be at least 2';
  end if;
  if p_total_players - 1 > p_num_detectives then
    raise exception 'Cannot have more detective-controllers than detectives';
  end if;

  -- validate the host's chosen role is actually one of the computed seats
  select array_cat(array['mrx'], array_agg(out_seat_role))
    into v_valid_roles
    from compute_seat_layout(p_num_detectives, p_total_players);
  if not (p_host_role = any(v_valid_roles)) then
    raise exception 'Invalid role % for this room''s seat layout', p_host_role;
  end if;

  loop
    v_code := upper(substr(md5(random()::text), 1, 6));
    v_attempt := v_attempt + 1;
    exit when not exists (select 1 from rooms r where r.code = v_code) or v_attempt > 10;
  end loop;

  insert into rooms (map_id, num_detectives, total_players, code, status)
  values (p_map_id, p_num_detectives, p_total_players, v_code, 'lobby')
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

  select count(*) into v_total_players from players where room_id = p_room_id;
  select count(*) into v_yes_votes from end_game_votes where proposal_id = p_proposal_id and vote = true;

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
