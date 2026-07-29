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
-- create_room — host creates a new room, gets a room code back, and is
-- seated as Mr. X (host = Mr. X is a simplifying choice; the host could
-- swap roles with a detective in the lobby before starting in a future
-- version, but isn't required for v1).
-- -----------------------------------------------------------------------------
create or replace function create_room(
  p_map_id text,
  p_num_detectives int,
  p_host_display_name text
) returns table (out_room_id uuid, out_room_code text, out_host_player_id uuid)
language plpgsql
security definer
as $$
declare
  v_room_id uuid;
  v_code text;
  v_host_id uuid;
  v_attempt int := 0;
begin
  if p_num_detectives < 2 or p_num_detectives > 5 then
    raise exception 'num_detectives must be between 2 and 5';
  end if;

  loop
    v_code := upper(substr(md5(random()::text), 1, 6));
    v_attempt := v_attempt + 1;
    exit when not exists (select 1 from rooms r where r.code = v_code) or v_attempt > 10;
  end loop;

  insert into rooms (map_id, num_detectives, code, status)
  values (p_map_id, p_num_detectives, v_code, 'lobby')
  returning id into v_room_id;

  insert into players (room_id, role, display_name)
  values (v_room_id, 'mrx', p_host_display_name)
  returning id into v_host_id;

  update rooms set host_player_id = v_host_id where id = v_room_id;

  return query select v_room_id, v_code, v_host_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- join_room — a new player joins an existing lobby by code, claiming a
-- role. Fails if the role is already taken or the room already started.
-- -----------------------------------------------------------------------------
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
begin
  select * into v_room from rooms r where r.code = upper(p_room_code);
  if v_room.id is null then
    raise exception 'Room not found';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'Room has already started';
  end if;

  insert into players (room_id, role, display_name)
  values (v_room.id, p_role, p_display_name)
  returning id into v_player_id;

  return query select v_room.id, v_player_id;
exception
  when unique_violation then
    raise exception 'That role has already been taken in this room';
end;
$$;


-- -----------------------------------------------------------------------------
-- lookup_room — for the join flow: look up a room by code WITHOUT
-- joining, so the UI can show which roles are still available before the
-- player commits to a name + role and actually inserts a players row.
-- -----------------------------------------------------------------------------
create or replace function lookup_room(p_room_code text)
returns table (out_room_id uuid, out_map_id text, out_num_detectives int, out_status text, out_taken_roles text[])
language plpgsql
security definer
as $$
declare
  v_room rooms%rowtype;
  v_taken text[];
begin
  select * into v_room from rooms r where r.code = upper(p_room_code);
  if v_room.id is null then
    raise exception 'Room not found';
  end if;

  select coalesce(array_agg(pl.role), '{}') into v_taken from players pl where pl.room_id = v_room.id;

  return query select v_room.id, v_room.map_id, v_room.num_detectives, v_room.status, v_taken;
end;
$$;


-- -----------------------------------------------------------------------------
-- start_game — host starts the match. Random start positions are
-- generated HERE (server-side), not trusted from the client, specifically
-- so Mr. X's start position never passes through any channel a detective
-- client could observe.
-- -----------------------------------------------------------------------------
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
  if v_caller.role <> v_expected_role then
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
-- heartbeat — updates last_seen_at so the lobby can show who's still
-- connected. Client calls this every ~15s while in a room.
-- -----------------------------------------------------------------------------
create or replace function heartbeat(p_player_id uuid) returns void
language sql
security definer
as $$
  update players set last_seen_at = now() where id = p_player_id;
$$;
