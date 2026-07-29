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
-- APP SETTINGS -- one global row of owner-adjustable configuration.
--   is_public: false (default) = only accounts can log in; true = also
--     offers "Continue as Guest" (see AuthScreen.jsx / accessControlApi.js).
--   turn_timer_min_seconds / turn_timer_max_seconds: bounds a host can
--     choose from when setting a room's turn timer. NOTE: the absolute
--     floor of 15s is enforced in the set_app_config() RPC below and
--     cannot be lowered further from here -- this exists specifically to
--     protect the "turn timer minimum >= inactivity grace period"
--     invariant the multiplayer design relies on (see project notes on
--     presence detection); an admin accidentally setting a 5s minimum
--     would silently reintroduce that conflict.
--   default_invite_code_limit: how many uses a NEWLY issued invite code
--     starts with. Existing accounts' individual limits (accounts.
--     invite_code_limit) are unaffected by later changes to this default.
-- Only an owner account (accounts.is_owner = true) can change any of
-- these, via the set_app_config() RPC.
-- -----------------------------------------------------------------------------
create table if not exists app_settings (
  id int primary key default 1,
  is_public boolean not null default false,
  turn_timer_min_seconds int not null default 30,
  turn_timer_max_seconds int not null default 300,
  default_invite_code_limit int not null default 20,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id, is_public) values (1, false) on conflict (id) do nothing;

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
  updated_at timestamptz not null default now()
);


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
  is_owner boolean not null default false,   -- set manually on your own account row
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
-- set_app_public() RPC, which checks the caller is an owner account.
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
