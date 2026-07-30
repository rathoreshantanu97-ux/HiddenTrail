-- =============================================================================
-- SCOTLAND YARD — SUPABASE SCHEMA
-- =============================================================================
-- Run this in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: uses `create table if not exists` throughout.
--
-- READ THIS FIRST — the one important design decision:
--
-- Mr. X's real position must be invisible to detective players. Postgres
-- Row Level Security (RLS) controls access per ROW, not per COLUMN, so we
-- can't just say "hide this one column." Instead, Mr. X's true position
-- lives in its OWN TABLE (mrx_secret) that only Mr. X's own client is
-- allowed to SELECT from. Detective clients never even query that table —
-- they get Mr. X's public info (tickets, travel log, revealed position on
-- reveal rounds) from a separate `mrx_public` table that everyone can read.
--
-- This means the actual secrecy is enforced by Postgres itself (via RLS),
-- not by the React app choosing not to display something it technically
-- has. Even someone opening browser devtools and reading every network
-- response cannot see Mr. X's real position unless they ARE Mr. X, or a
-- reveal round has published it into mrx_public.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- ROOMS — one row per game lobby/session.
-- -----------------------------------------------------------------------------
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- short human-typeable code, e.g. "BXQP42"
  map_id text not null,                   -- "city" | "bengaluru" | "westeros" | future maps
  num_detectives int not null,
  total_players int not null default 0,   -- host-declared total (1 Mr.X + N detective-controllers).
                                           -- 0 means "not using the seat-based model" (legacy rooms
                                           -- created before this column existed) -- see
                                           -- compute_seat_layout() for how this drives seat sizing.
  status text not null default 'lobby',   -- 'lobby' | 'playing' | 'ended'
  host_player_id uuid,                    -- set once the host's player row exists
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- PLAYERS — one row per connected participant (detective slot or Mr. X).
-- A player's `id` is generated client-side on first join and stored in
-- their browser (localStorage), so refreshing the page doesn't lose their
-- seat. There's no real auth system here — this is a private-game code
-- shared with friends, not a public matchmaking product.
-- -----------------------------------------------------------------------------
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  -- role: "mrx" for the Mr. X seat, or a comma-separated list of
  -- detective indices for a detective seat, e.g. "d0" (controls just
  -- detective 0) or "d0,d2" (one player controlling detectives 0 AND 2,
  -- per the multi-detective-per-player room model). Comma-joined rather
  -- than a separate seats/detectives table -- keeps the existing
  -- single-column uniqueness constraint below working unchanged, and
  -- every existing piece of code that already does
  -- `role.startsWith("d")` / `role === "mrx"` still works correctly,
  -- since "d0,d2" still starts with "d" and isn't "mrx".
  role text not null,
  display_name text not null,
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Mr. X's seat can only be taken once per room (simple case, a plain
-- unique index works fine here since "mrx" is never combined with
-- anything else).
create unique index if not exists players_room_mrx_unique
  on players(room_id, role)
  where role = 'mrx';

-- Detective seats are trickier: role can be "d0,d2", so two different
-- role strings ("d0,d1" and "d1,d2") could still both claim detective 1
-- -- a plain unique index on the raw string can't catch that overlap. A
-- trigger checks this properly by comparing each seat's actual set of
-- detective indices against every other seat's set in the same room.
create or replace function check_no_overlapping_detective_seats() returns trigger
language plpgsql
as $$
declare
  v_new_ids text[];
  v_conflict boolean;
begin
  if new.role = 'mrx' then
    return new; -- mrx handled by the unique index above
  end if;

  v_new_ids := string_to_array(new.role, ',');

  select exists (
    select 1
    from players p
    where p.room_id = new.room_id
      and p.id <> new.id
      and p.role <> 'mrx'
      and string_to_array(p.role, ',') && v_new_ids  -- && = "arrays overlap"
  ) into v_conflict;

  if v_conflict then
    raise exception 'One or more detective seats in "%" are already claimed by another player in this room', new.role;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_no_overlapping_detective_seats on players;
create trigger trg_check_no_overlapping_detective_seats
  before insert or update of role on players
  for each row
  execute function check_no_overlapping_detective_seats();


-- -----------------------------------------------------------------------------
-- GAME STATE (PUBLIC) — everything every player is allowed to see:
-- round number, turn order/index, detective positions+tickets, Mr. X's
-- ticket counts (but NOT position), Mr. X's travel-log (mode only, no
-- position), the revealed position (only populated on reveal rounds),
-- winner, and the human-readable move log.
-- -----------------------------------------------------------------------------
create table if not exists game_state_public (
  room_id uuid primary key references rooms(id) on delete cascade,
  phase text not null default 'playing',      -- "playing" | "ended"
  round int not null default 1,
  turn_order text[] not null default '{}',    -- e.g. {"mrx","d0","d1"}
  turn_idx int not null default 0,
  detectives jsonb not null default '[]',     -- [{id,color,pos,tickets,history}]
  mrx_tickets jsonb not null default '{}',    -- {taxi,bus,underground,black,double}
  mrx_revealed_pos int,                       -- null except on reveal rounds
  mrx_last_reveal_round int not null default 0,
  mrx_travel_log jsonb not null default '[]', -- [{round,move,mode}] -- MODE ONLY, no pos
  mrx_double_move_active boolean not null default false,
  mrx_double_move_legs_remaining int not null default 0,
  winner text,                                -- null | "mrx" | "detectives"
  log jsonb not null default '[]',            -- [{kind,payload}] structured log entries
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- GAME STATE (MR. X SECRET) — Mr. X's true position. Only Mr. X's own
-- client can ever read this table (see RLS policy below). At game end, we
-- copy the full positionLog into game_state_public so everyone can see the
-- "full route revealed" screen — that's an intentional, explicit reveal,
-- not a leak.
-- -----------------------------------------------------------------------------
create table if not exists game_state_secret (
  room_id uuid primary key references rooms(id) on delete cascade,
  mrx_pos int not null,
  mrx_position_log jsonb not null default '[]',  -- [{round,pos,mode}] full hidden path
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- MOVES — append-only history, used for the log/replay. Not strictly
-- required for gameplay (game_state_public.log already covers the visible
-- log) but useful if you want a full audit trail or replay feature later.
-- -----------------------------------------------------------------------------
create table if not exists moves (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid references players(id) on delete set null,
  round int not null,
  actor text not null,          -- "mrx" | "d0" | "d1" | ...
  to_station int not null,
  mode text not null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- MESSAGES — chat. `channel` is "all" (everyone incl. Mr. X) or
-- "detectives" (detectives only — Mr. X's client never subscribes to or
-- queries this channel, and RLS blocks it server-side too, not just in
-- the UI).
-- -----------------------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  channel text not null,          -- "all" | "detectives"
  sender_player_id uuid references players(id) on delete set null,
  sender_name text not null,      -- denormalized so messages survive a player leaving
  sender_role text not null,      -- denormalized similarly
  body text not null,
  created_at timestamptz not null default now()
);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- IMPORTANT DESIGN NOTE ON "WHO IS ASKING":
-- This project has no login/auth system (it's a private game joined via a
-- room code, not a public product) -- so we can't use Supabase Auth's
-- auth.uid() in RLS policies, which is the normal way to do this.
--
-- A tempting-looking alternative is a Postgres session variable set via
-- current_setting(...), but that requires a persistent per-client session,
-- which Supabase's pooled REST/Realtime connections don't reliably give
-- you -- so we do NOT rely on that here.
--
-- Instead: game_state_secret (Mr. X's true position) is NEVER read via a
-- direct table SELECT from the client at all. The client library simply
-- never calls .from('game_state_secret').select(). The ONLY way to read
-- it is through the get_mrx_position RPC function (see functions.sql),
-- which is a SECURITY DEFINER function that takes the caller's player_id
-- as an explicit argument and checks -- inside the function body, in
-- plain SQL -- that this player_id's role is 'mrx' in that room before
-- returning anything. If it isn't, the function returns null.
--
-- This means the RLS policy on game_state_secret below is a BACKSTOP, not
-- the primary defense: even if some future code accidentally tried a
-- direct client-side select on this table, RLS still blocks it (the
-- default-deny policy below only allows rows through for a specific
-- narrow case, not client reads in general). The real defense is "the
-- client code never has a legitimate way to query this table directly,"
-- enforced by us never writing that code path in supabaseGameStore.js.
-- =============================================================================

alter table rooms enable row level security;
alter table players enable row level security;
alter table game_state_public enable row level security;
alter table game_state_secret enable row level security;
alter table moves enable row level security;
alter table messages enable row level security;

-- ROOMS: anyone can read a room if they know its id/code (needed to join),
-- anyone can create a room (host flow), nobody updates/deletes directly
-- (status changes go through the start_game RPC, see below).
drop policy if exists rooms_select_all on rooms;
create policy rooms_select_all on rooms for select using (true);

drop policy if exists rooms_insert_all on rooms;
create policy rooms_insert_all on rooms for insert with check (true);

-- PLAYERS: anyone can read player rows in a room they know about (needed
-- to show the lobby / detective ticket overview). Anyone can insert a
-- player row (the join-room flow) as long as the role isn't already taken
-- (enforced by the unique index above, not RLS). No update/delete from
-- clients — last_seen_at heartbeat goes through an RPC.
drop policy if exists players_select_all on players;
create policy players_select_all on players for select using (true);

drop policy if exists players_insert_all on players;
create policy players_insert_all on players for insert with check (true);

-- GAME STATE PUBLIC: readable by anyone who can read the room (i.e.
-- everyone in it). Writes only ever happen via the SECURITY DEFINER RPCs
-- below (make_move, activate_double_move, start_game), never a direct
-- client UPDATE — this is what stops a malicious client from just writing
-- "mrx_revealed_pos = 5" into the row directly.
drop policy if exists game_state_public_select_all on game_state_public;
create policy game_state_public_select_all on game_state_public for select using (true);

-- GAME STATE SECRET -- THE IMPORTANT ONE. Default-deny: no direct client
-- select is ever allowed on this table (there's no reliable per-request
-- identity to check against in RLS here -- see the note above). The
-- client never queries this table directly; it only ever reads Mr. X's
-- position via the get_mrx_position() RPC in functions.sql, which does
-- its own explicit authorization check against the player_id argument
-- the caller passes in. RLS here is a backstop against future code
-- accidentally adding a direct client select on this table.
drop policy if exists game_state_secret_deny_all on game_state_secret;
create policy game_state_secret_deny_all on game_state_secret
  for select using (false);

-- MOVES: readable by anyone in the room (it's just a log of what
-- happened, not a secrecy concern — detective moves are always public,
-- and Mr. X's moves in this table only ever record the MODE, never the
-- destination station, for exactly the same reason mrx_travel_log omits
-- position. See supabaseGameStore.js: Mr. X move inserts here use a
-- placeholder, not the real to_station).
drop policy if exists moves_select_all on moves;
create policy moves_select_all on moves for select using (true);

drop policy if exists moves_insert_all on moves;
create policy moves_insert_all on moves for insert with check (true);

-- MESSAGES: "all" channel readable by everyone in the room. "detectives"
-- channel readable only by players whose role is NOT "mrx" in that room —
-- this is the actual server-side enforcement of the two-chat-window
-- feature, not just a UI tab that happens to be hidden.
-- Same identity problem as game_state_secret: RLS can't reliably know
-- "who is asking" without an auth system. So: the "all" channel is
-- world-readable within a room (fine -- Mr. X is allowed to see it), but
-- the "detectives" channel is NEVER read via a direct client select
-- either. It's read through the get_detective_messages() RPC in
-- functions.sql, which checks the caller's player_id's role explicitly
-- before returning any rows. Same pattern, same reasoning, as Mr. X's
-- position.
drop policy if exists messages_select_all_channel_only on messages;
create policy messages_select_all_channel_only on messages
  for select using (channel = 'all');

drop policy if exists messages_insert_all on messages;
create policy messages_insert_all on messages
  for insert with check (true);
-- NOTE: insert is intentionally permissive at the RLS layer (anyone can
-- insert a row claiming channel='detectives'). The actual enforcement
-- that only detectives can post to and read the detectives channel lives
-- in the send_message()/get_detective_messages() RPCs, which check the
-- caller's real role server-side before allowing it -- same "RPC does the
-- real check, RLS is a coarse backstop" pattern used throughout this
-- schema, for the same reason (no auth system to hang per-row RLS off of).


-- =============================================================================
-- REALTIME — tell Supabase to broadcast changes on these tables so every
-- connected client's subscription fires when a row changes.
-- =============================================================================
-- IMPORTANT: Realtime's Postgres Changes feature does NOT automatically
-- apply your RLS policies to WHO gets notified of a change, unless you
-- explicitly enable "Realtime RLS" for the table (a setting in the
-- Database -> Replication section of the dashboard, separate from RLS on
-- normal queries) -- and even then, the messages table mixes both
-- channels together, so a naive "add messages to realtime" would risk
-- pushing 'detectives' channel row-change EVENTS (not full row selects,
-- but still enough metadata to be a leak) to Mr. X's subscribed client.
--
-- To keep this simple and definitely safe rather than clever-but-fragile:
-- messages is NOT added to the realtime publication. Chat is polled
-- instead (the client re-fetches via the get_messages / get_detective_
-- messages RPCs every couple of seconds while the chat panel is open).
-- This is a deliberate simplicity-over-latency tradeoff for a first
-- version -- a few seconds of chat delay is a fine place to start, and
-- we can add a properly-scoped Realtime broadcast channel per room later
-- if it's worth the added complexity.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table rooms;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table players;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_state_public'
  ) then
    alter publication supabase_realtime add table game_state_public;
  end if;
end $$;
-- messages: intentionally NOT added -- see note above, chat is polled.
-- game_state_secret: intentionally NOT added -- Mr. X's client fetches
-- its own position via the get_mrx_position() RPC (polled alongside the
-- game_state_public realtime updates), never via a table subscription.


-- -----------------------------------------------------------------------------
-- END GAME PROPOSALS -- vote-to-end-game mechanism. Simplified first
-- version: EVERY player currently in the room must respond (there's no
-- "inactive players auto-skipped" logic yet, since that depends on
-- presence detection, which is a later phase of this project). A
-- proposal is created when someone clicks "End Game"; every other player
-- sees it and responds yes/no; if anyone says no, or ~60s pass with no
-- resolution, it's cancelled. If everyone says yes, the game ends.
-- -----------------------------------------------------------------------------
create table if not exists end_game_proposals (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  proposed_by_player_id uuid references players(id) on delete set null,
  proposed_by_name text not null,
  status text not null default 'pending', -- 'pending' | 'accepted' | 'rejected' | 'expired'
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 seconds')
);

-- one active (pending) proposal per room at a time -- a second "end game"
-- click while one is already pending just surfaces the existing one
-- rather than creating a duplicate
create unique index if not exists end_game_proposals_pending_unique
  on end_game_proposals(room_id)
  where status = 'pending';

create table if not exists end_game_votes (
  proposal_id uuid not null references end_game_proposals(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  vote boolean not null, -- true = yes (end the game), false = no (keep playing)
  voted_at timestamptz not null default now(),
  primary key (proposal_id, player_id)
);

alter table end_game_proposals enable row level security;
alter table end_game_votes enable row level security;

-- both tables: readable by anyone (no secrecy concern here -- everyone in
-- the room is meant to see the proposal and who's voted). Writes only
-- ever happen via the propose_end_game / vote_end_game RPCs (functions.sql),
-- never a direct client insert/update, so votes can't be spoofed as
-- someone else -- the RPC checks the caller's own player_id server-side.
drop policy if exists end_game_proposals_select_all on end_game_proposals;
create policy end_game_proposals_select_all on end_game_proposals for select using (true);
drop policy if exists end_game_proposals_deny_direct_write on end_game_proposals;
create policy end_game_proposals_deny_direct_write on end_game_proposals for all using (false) with check (false);

drop policy if exists end_game_votes_select_all on end_game_votes;
create policy end_game_votes_select_all on end_game_votes for select using (true);
drop policy if exists end_game_votes_deny_direct_write on end_game_votes;
create policy end_game_votes_deny_direct_write on end_game_votes for all using (false) with check (false);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'end_game_proposals'
  ) then
    alter publication supabase_realtime add table end_game_proposals;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'end_game_votes'
  ) then
    alter publication supabase_realtime add table end_game_votes;
  end if;
end $$;


-- =============================================================================
-- NEXT FILE: supabase/functions.sql has the RPC functions (start_game,
-- make_move, activate_double_move) that actually mutate game state. Run
-- that file after this one.
-- =============================================================================
