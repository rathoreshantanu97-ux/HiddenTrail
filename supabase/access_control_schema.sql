-- =============================================================================
-- SCOTLAND YARD — ACCESS CONTROL SCHEMA
-- =============================================================================
-- Run this in Supabase Dashboard -> SQL Editor, AFTER schema.sql and
-- functions.sql. Safe to re-run.
--
-- DESIGN: this is a deliberately lightweight, custom access-gate — NOT
-- Supabase Auth. The reasoning: the owner wants a one-time approval step
-- per new person (an OTP the owner personally relays), after which that
-- person logs in with a username+password from any device, with no
-- further friction. Supabase Auth's built-in email/password flow is built
-- around self-service signup + email verification, which doesn't match
-- "the owner personally approves every new person" -- so instead we roll
-- a small custom table-based system:
--
--   access_requests  -- someone asks for access; owner gets emailed an OTP
--   accounts         -- approved accounts: username + hashed password
--
-- Passwords are hashed with pgcrypto's crypt()/bcrypt -- never stored or
-- compared in plaintext, and never sent back to any client in a SELECT.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- APP SETTINGS -- one global row of admin-adjustable configuration.
--   is_public: false (default) = only accounts can log in; true = also
--     offers "Continue as Guest" (see AuthScreen.jsx / accessControlApi.js).
--   turn_timer_min_seconds / turn_timer_max_seconds: bounds a host can
--     choose from when setting a room's turn timer. NOTE: the absolute
--     floor of 15s is enforced in the set_app_config() RPC below and
--     cannot be lowered further from here -- this exists specifically to
--     protect the "turn timer minimum >= inactivity grace period"
--     invariant the multiplayer design relies on; an admin accidentally
--     setting a 5s minimum would silently reintroduce that conflict.
--   default_invite_code_limit: how many uses a NEWLY issued invite code
--     starts with. Existing accounts' individual limits (accounts.
--     invite_code_limit) are unaffected by later changes to this default.
--   nomination_window_seconds: how long the "does anyone want to
--     volunteer to take over Mr.X/a detective" step stays open before
--     auto-resolving (default 30s, per project design).
--   poll_window_seconds: how long the "vote for which nominee wins"
--     step stays open when there are multiple volunteers (default 60s).
--   min_detectives / max_detectives: bounds a host can pick when
--     creating a room (previously hardcoded 3-20 in create_room()).
--   min_total_players / max_total_players: bounds on total room size.
--   presence_grace_period_seconds: how long after a player's connection
--     drops before they're treated as genuinely inactive (absorbs brief
--     blips like a phone screen lock or a wifi hiccup).
--   pause_resume_deadline_hours: how long a paused game can sit
--     unresumed before it's automatically treated as ended.
-- Only an admin account (accounts.is_admin = true) can change any of
-- these, via the set_app_config() / set_timing_config() RPCs.
-- -----------------------------------------------------------------------------
create table if not exists app_settings (
  id int primary key default 1,
  is_public boolean not null default false,
  turn_timer_min_seconds int not null default 30,
  turn_timer_max_seconds int not null default 300,
  default_invite_code_limit int not null default 20,
  nomination_window_seconds int not null default 30,
  poll_window_seconds int not null default 60,
  min_detectives int not null default 3,
  -- Hard-capped at 8: DETECTIVE_COLORS (gameEngine.js) only has 8
  -- distinct colors, enforced independently in set_timing_config too.
  max_detectives int not null default 8,
  min_total_players int not null default 2,
  max_total_players int not null default 9,
  presence_grace_period_seconds int not null default 25,
  pause_resume_deadline_hours int not null default 36,
  takeover_reversal_window_minutes int not null default 5,
  -- Feature toggles -- each independently switches a whole feature on/off.
  -- takeovers_enabled: if false, an inactive player's seat is simply left
  --   inactive (no automated flag/nominate/vote flow at all -- the
  --   turn-timer's auto-random-move logic keeps the game moving, but
  --   nobody is ever offered control of that seat).
  -- takeover_reversal_enabled: only meaningful when takeovers_enabled is
  --   true -- lets a replaced player propose getting their seat back
  --   (unanimous vote required) within takeover_reversal_window_minutes
  --   of the takeover completing.
  -- end_game_vote_enabled / pause_resume_enabled: self-explanatory,
  --   same on/off pattern.
  takeovers_enabled boolean not null default true,
  takeover_reversal_enabled boolean not null default true,
  end_game_vote_enabled boolean not null default true,
  pause_resume_enabled boolean not null default true,
  redistribute_roles_enabled boolean not null default true,
  -- "Overridable by host" flags -- gate WHETHER a host is even offered
  -- the choice to override a given feature for their own room. If
  -- false, the host never sees that option at all when creating a room
  -- -- the admin's global on/off setting simply applies unconditionally.
  -- Defaults to true (admin can lock any of these down later if they
  -- want tighter central control).
  takeovers_overridable_by_host boolean not null default true,
  takeover_reversal_overridable_by_host boolean not null default true,
  end_game_vote_overridable_by_host boolean not null default true,
  pause_resume_overridable_by_host boolean not null default true,
  redistribute_roles_overridable_by_host boolean not null default true,
  -- Turn-highlight style: 'ring' (pulsing outline, default) or 'blink'
  -- (fill/opacity pulse). Applies to both the detective turn-indicator
  -- (visible to everyone) and Mr.X's own private self-locating
  -- indicator (visible only to Mr.X's own client).
  -- Two INDEPENDENT highlight-style settings: one for POSITION
  -- indicators (the turn-indicator on a detective's current station,
  -- and Mr.X's own private self-locator), one for DESTINATION
  -- indicators (the legal-move ring shown around stations you could
  -- move to). Five styles each: 'ring' (pulsing), 'rotating' (spinning
  -- dashes), 'blink' (fill pulse), 'static' (plain, no animation),
  -- 'none' (nothing shown).
  position_highlight_style text not null default 'ring',
  position_highlight_style_overridable_by_host boolean not null default true,
  destination_highlight_style text not null default 'rotating',
  destination_highlight_style_overridable_by_host boolean not null default true,
  -- Route explorer: lets the player whose turn it is highlight every
  -- station reachable by a specific transport mode (only modes they
  -- actually hold a ticket for), a purely informational "what if" view,
  -- not a move commitment.
  route_explorer_enabled boolean not null default true,
  route_explorer_overridable_by_host boolean not null default true,
  -- Round-count scaling ratio: multiplies the computed round count (from
  -- graph-distance calibration) up or down. 1.0 = use the computed
  -- default unchanged. Same purpose as detective_density_ratio: admin
  -- can tune the FEEL of every game (longer or shorter hunts) without
  -- needing per-map micromanagement, while per-map overrides (in
  -- map_settings) still take precedence for a specific map if set.
  round_scaling_ratio numeric not null default 1.0,
  round_scaling_overridable_by_host boolean not null default true,
  -- Public rooms: whether hosts are even allowed to mark a room public
  -- at all. Unlike the other toggles, there's no separate
  -- "overridable_by_host" companion for this one -- being ABLE to make a
  -- room public already IS the host's choice; this flag is the
  -- admin-level gate on whether that choice exists at all (e.g. an
  -- admin running a small private deployment may want to disable public
  -- rooms entirely, since a room browser only makes sense for a
  -- deployment with enough traffic to have unrelated groups discovering
  -- each other's games).
  public_rooms_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id, is_public) values (1, false) on conflict (id) do nothing;

-- Self-healing: if this table already existed before these columns were
-- added to its definition above, `create table if not exists` would have
-- silently skipped adding them (same gap the rooms.total_players issue
-- hit earlier in this project) -- these lines actually add them either way.
alter table app_settings add column if not exists nomination_window_seconds int not null default 30;
alter table app_settings add column if not exists poll_window_seconds int not null default 60;
alter table app_settings add column if not exists min_detectives int not null default 3;
alter table app_settings add column if not exists max_detectives int not null default 20;
alter table app_settings add column if not exists min_total_players int not null default 2;
alter table app_settings add column if not exists max_total_players int not null default 21;
alter table app_settings add column if not exists presence_grace_period_seconds int not null default 25;
alter table app_settings add column if not exists pause_resume_deadline_hours int not null default 36;
alter table app_settings add column if not exists takeover_reversal_window_minutes int not null default 5;
alter table app_settings add column if not exists takeovers_enabled boolean not null default true;
alter table app_settings add column if not exists takeover_reversal_enabled boolean not null default true;
alter table app_settings add column if not exists end_game_vote_enabled boolean not null default true;
alter table app_settings add column if not exists pause_resume_enabled boolean not null default true;
alter table app_settings add column if not exists redistribute_roles_enabled boolean not null default true;
alter table app_settings add column if not exists takeovers_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists takeover_reversal_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists end_game_vote_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists pause_resume_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists redistribute_roles_overridable_by_host boolean not null default true;
-- These two columns are now genuinely dead (replaced by the two
-- independent position/destination columns above) -- dropped here
-- rather than left as confusing leftover state on any database that
-- already ran an earlier version of this file.
alter table app_settings drop column if exists turn_highlight_style;
alter table app_settings drop column if exists turn_highlight_style_overridable_by_host;
alter table app_settings add column if not exists position_highlight_style text not null default 'ring';
alter table app_settings add column if not exists position_highlight_style_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists destination_highlight_style text not null default 'rotating';
alter table app_settings add column if not exists destination_highlight_style_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists route_explorer_enabled boolean not null default true;
alter table app_settings add column if not exists route_explorer_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists round_scaling_ratio numeric not null default 1.0;
alter table app_settings add column if not exists round_scaling_overridable_by_host boolean not null default true;
alter table app_settings add column if not exists public_rooms_enabled boolean not null default true;

-- -----------------------------------------------------------------------------
-- MAP SETTINGS -- lets an owner deactivate a map without deleting its
-- code, so it stops appearing in the map picker (Create Room, pass-and-
-- play setup) without needing a code change. `map_id` matches the id used
-- in src/maps/index.js (e.g. "city", "bengaluru", "westeros") -- there's
-- no foreign key here since maps are defined in code, not the database;
-- a row simply doesn't exist yet for a map until someone (the owner
-- panel, on first load) creates one, defaulting to active.
-- -----------------------------------------------------------------------------
create table if not exists map_settings (
  map_id text primary key,
  is_active boolean not null default true,
  -- Per-map overrides for the computed defaults in mapSchema.js
  -- (computeMapLimits / computeTicketCounts). NULL means "use the
  -- computed default for this map"; a non-null value is an admin's
  -- explicit override for this SPECIFIC map only (doesn't affect any
  -- other map). detective_density_ratio_override is capped at 0.20 by
  -- set_map_ticket_overrides() below, same hard ceiling as the global
  -- default -- an admin can't misconfigure an individual map into
  -- something broken any more than they can globally.
  detective_density_ratio_override numeric,
  ticket_counts_override jsonb, -- {detective: {taxi,bus,underground}, mrx: {taxi,bus,underground,black,double}} or null
  round_scaling_ratio_override numeric, -- per-map override for the round-count scaling ratio, or null to use the global default
  -- VISUAL overrides, added for the in-UI map editor (curve dragging +
  -- small station adjustments). Deliberately kept separate in intent
  -- from the gameplay-balance overrides above, even though they live in
  -- the same row/table -- these only ever change how the map LOOKS
  -- (curve shape, station position/label/name/prominence), never
  -- connectivity, ticket counts, or round timing, so they can't affect
  -- game balance no matter what an admin drags.
  --
  -- curve_offset_overrides: {"a-b": number, ...} -- same key format
  -- (lower station id first) and same perpendicular-offset semantics as
  -- MANUAL_CURVE_OFFSETS in each map's own JS file (see cityOfSendhwa.js
  -- for the full explanation of the offset math) -- this OVERRIDES that
  -- static value per-edge when present, exactly like ticket_counts_override
  -- overrides the computed ticket defaults.
  curve_offset_overrides jsonb,
  -- station_overrides: {"<stationId>": {x, y, labelDir, name, isMajor}, ...}
  -- -- any subset of these four fields may be present per station; a
  -- missing field means "use the map's own default for that field."
  -- Position nudges are capped server-side (see
  -- set_map_visual_overrides) to a small radius from the station's
  -- original coordinates, so this can't be used to drag a station
  -- somewhere that would silently invalidate the ticket-count
  -- calibration (which is derived from the map's real inter-station
  -- distances).
  station_overrides jsonb,
  -- decorations: [{id, type, x, y, ...type-specific fields}, ...] -- an
  -- ORDERED array (index = paint order within this layer, back to
  -- front), unlike curve_offset_overrides/station_overrides which are
  -- keyed objects merged field-by-field. A decorations list is saved
  -- and loaded as a whole -- there's no sensible per-item merge for an
  -- ordered list the way there is for "this one edge's curve" or "this
  -- one station's name." Purely visual (icons/shapes/text/images placed
  -- by the admin for beautification) -- rendered by DecorationsLayer.jsx,
  -- always directly after the background and before any transit line or
  -- station, so it can never cover anything gameplay-relevant. See
  -- set_map_visual_overrides below for the full validation.
  decorations jsonb,
  -- background_override: a single hex color string (e.g. "#eef3e0")
  -- replacing just the base fill/wash MapBackground.jsx draws for
  -- whichever theme is active -- every other piece of that theme's art
  -- (water gradients, parks, landmark icons, region hulls for Westeros)
  -- still renders on top exactly as before. null = use the map's own
  -- default background color.
  background_override text,
  -- THEME overrides -- per-map nomenclature reskin (Mr. X's name, the
  -- detective team's collective name, and each transport mode's display
  -- label). Purely cosmetic text, like decorations/background_override
  -- above: never touches connectivity, ticket counts, round timing, or
  -- any mode's underlying KEY ("taxi"/"bus"/"underground"/"ferry" stay
  -- fixed internal identifiers everywhere in the code -- only the display
  -- LABEL shown to players changes), so it can't affect game balance no
  -- matter what an admin types.
  --
  -- mrx_name_override / detective_team_name_override: plain text,
  -- null = use the map's own default ("Mr. X" / "Detectives"). Length-
  -- capped and sanitized server-side (see set_map_visual_overrides).
  mrx_name_override text,
  detective_team_name_override text,
  -- mode_labels_override: {"taxi": "Horse", "bus": "Raven", ...} -- a
  -- keyed object (like curve_offset_overrides/station_overrides above),
  -- so an admin can rename just one or two modes without needing to
  -- specify all four. Only "taxi"/"bus"/"underground"/"ferry" are valid
  -- keys (validated server-side against the map's actual modeTheme,
  -- same allow-list pattern as decoration icon names).
  mode_labels_override jsonb,
  updated_at timestamptz not null default now()
);
alter table map_settings add column if not exists detective_density_ratio_override numeric;
alter table map_settings add column if not exists ticket_counts_override jsonb;
alter table map_settings add column if not exists round_scaling_ratio_override numeric;
alter table map_settings add column if not exists curve_offset_overrides jsonb;
alter table map_settings add column if not exists station_overrides jsonb;
alter table map_settings add column if not exists decorations jsonb;
alter table map_settings add column if not exists background_override text;
alter table map_settings add column if not exists mrx_name_override text;
alter table map_settings add column if not exists detective_team_name_override text;
alter table map_settings add column if not exists mode_labels_override jsonb;


-- -----------------------------------------------------------------------------
-- ACCOUNTS — approved users. Created either via the OTP flow
-- (complete_signup) or via someone else's invite code (signup_with_invite_code).
--
-- invite_code / invite_code_limit / invite_code_uses: every account that
-- was itself OTP-approved (is_invite_created = false) gets a reusable
-- invite code others can sign up with directly, no OTP needed. Accounts
-- created VIA an invite code (is_invite_created = true) do NOT get their
-- own invite code by default -- they'd need to request an upgrade
-- (another OTP round) to get one, which turns them into a
-- non-invite-created account with their own code.
-- -----------------------------------------------------------------------------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  is_admin boolean not null default false,   -- set manually on your own account row
  is_invite_created boolean not null default false,  -- true if created via someone's invite code
  invited_by_account_id uuid references accounts(id) on delete set null,
  invite_code text unique,                    -- null for invite_created accounts until upgraded
  invite_code_limit int not null default 20,  -- configurable per-account, owner can adjust
  invite_code_uses int not null default 0,    -- how many people have used this code so far
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists accounts_invite_code_idx on accounts(invite_code) where invite_code is not null;

-- -----------------------------------------------------------------------------
-- ACCESS REQUESTS — someone asks for an account, OR an existing (invite-
-- created) account asks to be upgraded into a full account with its own
-- invite code. Owner is emailed an OTP either way and relays it to the
-- requester through their own out-of-band channel. The request row is
-- never shown to the requester, so they can't see or guess their own OTP.
-- -----------------------------------------------------------------------------
create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null default 'new_account',  -- 'new_account' | 'invite_upgrade'
  requested_username text,             -- for 'new_account' requests
  existing_account_id uuid references accounts(id) on delete cascade,  -- for 'invite_upgrade' requests
  requester_display_name text not null,
  otp_hash text not null,              -- hashed, never stored/returned in plaintext
  status text not null default 'pending',  -- 'pending' | 'approved' | 'expired' | 'denied'
  attempts int not null default 0,     -- failed OTP entry attempts, capped to prevent guessing
  expires_at timestamptz not null,     -- OTP validity window (short, e.g. 30 min)
  created_at timestamptz not null default now()
);

-- one pending request per requested username at a time (stops spamming
-- duplicate requests for the same username while one is already pending)
create unique index if not exists access_requests_pending_username_unique
  on access_requests(requested_username)
  where status = 'pending' and request_type = 'new_account';

-- one pending upgrade request per account at a time
create unique index if not exists access_requests_pending_upgrade_unique
  on access_requests(existing_account_id)
  where status = 'pending' and request_type = 'invite_upgrade';

-- -----------------------------------------------------------------------------
-- SESSIONS — a lightweight signed session token issued on successful
-- login, stored client-side (localStorage) and sent back on every
-- request that needs to prove "I am this account". Not a JWT (we don't
-- have Supabase Auth's JWT infrastructure available for a custom login
-- system) -- just a random opaque token the server can look up.
-- -----------------------------------------------------------------------------
create table if not exists sessions (
  token text primary key default encode(gen_random_bytes(32), 'hex'),
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table access_requests enable row level security;
alter table accounts enable row level security;
alter table sessions enable row level security;
alter table app_settings enable row level security;
alter table map_settings enable row level security;

-- access_requests: nobody reads directly (contains otp_hash + tracks
-- pending state -- no reason for any client to ever select this table
-- directly; all access goes through RPCs, which run as SECURITY DEFINER
-- and bypass RLS internally while still enforcing their own checks).
drop policy if exists access_requests_deny_all on access_requests;
create policy access_requests_deny_all on access_requests for select using (false);

-- Inserting a new request is allowed (that's the "request access" action
-- itself) -- the RPC wrapper still validates the input shape.
drop policy if exists access_requests_insert_all on access_requests;
create policy access_requests_insert_all on access_requests for insert with check (true);

-- accounts: never readable directly (contains password_hash). All
-- lookups happen inside SECURITY DEFINER RPCs (login, etc).
drop policy if exists accounts_deny_all on accounts;
create policy accounts_deny_all on accounts for select using (false);

-- sessions: never readable directly either -- validated only via the
-- validate_session RPC.
drop policy if exists sessions_deny_all on sessions;
create policy sessions_deny_all on sessions for select using (false);


-- app_settings: readable by EVERYONE (even logged-out visitors need to
-- know whether to show the "Continue as Guest" option on the login
-- screen). Never writable directly by clients -- only via the
-- set_app_public() RPC, which checks the caller is an admin account.
drop policy if exists app_settings_select_all on app_settings;
create policy app_settings_select_all on app_settings for select using (true);

drop policy if exists app_settings_deny_direct_write on app_settings;
create policy app_settings_deny_direct_write on app_settings for update using (false);

-- map_settings: readable by everyone (the map picker needs to know which
-- maps are active before anyone's logged in, same reasoning as
-- app_settings). Never writable directly -- only via set_map_active().
drop policy if exists map_settings_select_all on map_settings;
create policy map_settings_select_all on map_settings for select using (true);

drop policy if exists map_settings_deny_direct_write on map_settings;
create policy map_settings_deny_direct_write on map_settings for all using (false) with check (false);
