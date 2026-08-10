-- =============================================================================
-- SCOTLAND YARD — ACCESS CONTROL RPC FUNCTIONS
-- =============================================================================
-- Run AFTER access_control_schema.sql. Safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- request_access — a new person asks for an account. Generates a 6-digit
-- OTP, stores only its HASH (never the plaintext), and returns the
-- plaintext OTP to the CALLER of this function -- but the caller here is
-- not the requester's browser response; it's consumed server-side by a
-- database webhook that emails it to the owner (see
-- supabase/functions/notify-access-request/ Edge Function). The
-- requester's own browser never sees this return value.
-- -----------------------------------------------------------------------------
drop function if exists request_access(text, text);
create or replace function request_access(
  p_requested_username text,
  p_requester_display_name text
) returns table (out_request_id uuid, out_otp text)
language plpgsql
security definer
as $$
declare
  v_username text := lower(trim(p_requested_username));
  v_otp text;
  v_request_id uuid;
begin
  if length(v_username) < 3 or length(v_username) > 24 then
    raise exception 'Username must be 3-24 characters';
  end if;
  if v_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain lowercase letters, numbers, and underscores';
  end if;
  if exists (select 1 from accounts a where a.username = v_username) then
    raise exception 'That username is already taken';
  end if;
  if exists (select 1 from access_requests r where r.requested_username = v_username and r.status = 'pending') then
    raise exception 'A request for that username is already pending';
  end if;

  v_otp := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into access_requests (requested_username, requester_display_name, otp_hash, expires_at)
  values (v_username, trim(p_requester_display_name), crypt(v_otp, gen_salt('bf')), now() + interval '30 minutes')
  returning id into v_request_id;

  return query select v_request_id, v_otp;
end;
$$;


-- -----------------------------------------------------------------------------
-- verify_access_otp — the requester enters the OTP the owner relayed to
-- them. On success, marks the request approved and returns the request id
-- so the client can proceed to the "set your password" step. Attempts are
-- capped to prevent brute-forcing a 6-digit code.
-- -----------------------------------------------------------------------------
drop function if exists verify_access_otp(text, text);
create or replace function verify_access_otp(
  p_requested_username text,
  p_otp text
) returns table (out_request_id uuid, out_display_name text)
language plpgsql
security definer
as $$
declare
  v_username text := lower(trim(p_requested_username));
  v_req access_requests%rowtype;
begin
  select * into v_req
  from access_requests r
  where r.requested_username = v_username and r.status = 'pending' and r.request_type = 'new_account'
  order by r.created_at desc
  limit 1;

  if v_req.id is null then
    raise exception 'No pending request found for that username';
  end if;
  if v_req.expires_at < now() then
    update access_requests set status = 'expired' where id = v_req.id;
    raise exception 'This code has expired -- please request access again';
  end if;
  if v_req.attempts >= 5 then
    update access_requests set status = 'expired' where id = v_req.id;
    raise exception 'Too many incorrect attempts -- please request access again';
  end if;

  if v_req.otp_hash <> crypt(p_otp, v_req.otp_hash) then
    update access_requests set attempts = attempts + 1 where id = v_req.id;
    raise exception 'Incorrect code';
  end if;

  update access_requests set status = 'approved' where id = v_req.id;
  return query select v_req.id, v_req.requester_display_name;
end;
$$;


-- -----------------------------------------------------------------------------
-- complete_signup — after a successful OTP verification, the requester
-- sets their password and the account is actually created. Also logs
-- them in immediately (returns a session token), since they just proved
-- ownership of the request via the OTP a moment ago.
--
-- This account is OTP-approved (is_invite_created = false), so it gets
-- its own reusable invite code immediately -- generated here, not left
-- null, since only invite-code-created accounts start without one.
-- -----------------------------------------------------------------------------
drop function if exists complete_signup(uuid, text);
create or replace function complete_signup(
  p_request_id uuid,
  p_password text
) returns table (out_session_token text, out_account_id uuid, out_display_name text)
language plpgsql
security definer
as $$
declare
  v_req access_requests%rowtype;
  v_account_id uuid;
  v_token text;
  v_invite_code text;
begin
  select * into v_req from access_requests r where r.id = p_request_id and r.status = 'approved' and r.request_type = 'new_account';
  if v_req.id is null then
    raise exception 'Request not found or not approved';
  end if;
  if length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  v_invite_code := generate_unique_invite_code();

  insert into accounts (username, display_name, password_hash, is_invite_created, invite_code)
  values (v_req.requested_username, v_req.requester_display_name, crypt(p_password, gen_salt('bf')), false, v_invite_code)
  returning id into v_account_id;

  insert into sessions (account_id) values (v_account_id) returning token into v_token;

  return query select v_token, v_account_id, v_req.requester_display_name;
end;
$$;


-- -----------------------------------------------------------------------------
-- generate_unique_invite_code — internal helper, not exposed to clients
-- directly (no grant needed beyond default, since it's only called from
-- other SECURITY DEFINER functions in this file). Produces an 8-character
-- code, retrying on the astronomically rare collision.
-- -----------------------------------------------------------------------------
drop function if exists generate_unique_invite_code();
create or replace function generate_unique_invite_code() returns text
language plpgsql
security definer
as $$
declare
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    v_attempt := v_attempt + 1;
    exit when not exists (select 1 from accounts a where a.invite_code = v_code) or v_attempt > 10;
  end loop;
  return v_code;
end;
$$;


-- -----------------------------------------------------------------------------
-- signup_with_invite_code — a friend of an already-approved account signs
-- up directly using that account's invite code, no OTP needed. Fails if
-- the code doesn't exist or has hit its usage limit. The new account is
-- marked is_invite_created = true and does NOT get its own invite code.
-- -----------------------------------------------------------------------------
drop function if exists signup_with_invite_code(text, text, text, text);
create or replace function signup_with_invite_code(
  p_invite_code text,
  p_username text,
  p_display_name text,
  p_password text
) returns table (out_session_token text, out_account_id uuid, out_display_name text)
language plpgsql
security definer
as $$
declare
  v_inviter accounts%rowtype;
  v_username text := lower(trim(p_username));
  v_account_id uuid;
  v_token text;
begin
  select * into v_inviter from accounts a where a.invite_code = upper(trim(p_invite_code)) for update;
  if v_inviter.id is null then
    raise exception 'Invalid invite code';
  end if;
  if v_inviter.invite_code_uses >= v_inviter.invite_code_limit then
    raise exception 'This invite code has reached its usage limit';
  end if;

  if length(v_username) < 3 or length(v_username) > 24 then
    raise exception 'Username must be 3-24 characters';
  end if;
  if v_username !~ '^[a-z0-9_]+$' then
    raise exception 'Username can only contain lowercase letters, numbers, and underscores';
  end if;
  if exists (select 1 from accounts a where a.username = v_username) then
    raise exception 'That username is already taken';
  end if;
  if length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  insert into accounts (username, display_name, password_hash, is_invite_created, invited_by_account_id)
  values (v_username, trim(p_display_name), crypt(p_password, gen_salt('bf')), true, v_inviter.id)
  returning id into v_account_id;

  update accounts set invite_code_uses = invite_code_uses + 1 where id = v_inviter.id;

  insert into sessions (account_id) values (v_account_id) returning token into v_token;

  return query select v_token, v_account_id, trim(p_display_name);
end;
$$;


-- -----------------------------------------------------------------------------
-- get_my_invite_info — a logged-in account checks its own invite code,
-- usage, and limit (to show in their profile panel). Returns nothing
-- useful for invite_created accounts that haven't been upgraded yet
-- (invite_code is null) -- the client shows "request your own code" in
-- that case instead.
-- -----------------------------------------------------------------------------
drop function if exists get_my_invite_info(uuid);
create or replace function get_my_invite_info(p_account_id uuid)
returns table (out_invite_code text, out_invite_code_limit int, out_invite_code_uses int, out_is_invite_created boolean)
language plpgsql
security definer
as $$
declare
  v_account accounts%rowtype;
begin
  select * into v_account from accounts a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'Account not found';
  end if;
  return query select v_account.invite_code, v_account.invite_code_limit, v_account.invite_code_uses, v_account.is_invite_created;
end;
$$;


-- -----------------------------------------------------------------------------
-- request_invite_upgrade — an invite-created account (no code of its own)
-- asks the owner for one. Same OTP-relay pattern as request_access, but
-- tied to an EXISTING account instead of creating a new one.
-- -----------------------------------------------------------------------------
drop function if exists request_invite_upgrade(uuid);
create or replace function request_invite_upgrade(
  p_account_id uuid
) returns table (out_request_id uuid, out_otp text)
language plpgsql
security definer
as $$
declare
  v_account accounts%rowtype;
  v_otp text;
  v_request_id uuid;
begin
  select * into v_account from accounts a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'Account not found';
  end if;
  if v_account.invite_code is not null then
    raise exception 'This account already has an invite code';
  end if;
  if exists (select 1 from access_requests r where r.existing_account_id = p_account_id and r.status = 'pending' and r.request_type = 'invite_upgrade') then
    raise exception 'An upgrade request is already pending for this account';
  end if;

  v_otp := lpad(floor(random() * 1000000)::text, 6, '0');

  insert into access_requests (request_type, existing_account_id, requester_display_name, otp_hash, expires_at)
  values ('invite_upgrade', p_account_id, v_account.display_name, crypt(v_otp, gen_salt('bf')), now() + interval '30 minutes')
  returning id into v_request_id;

  return query select v_request_id, v_otp;
end;
$$;


-- -----------------------------------------------------------------------------
-- verify_invite_upgrade_otp — completes the upgrade: verifies the OTP and,
-- on success, immediately grants the account its own invite code (no
-- separate "set password" step needed here, since they already have a
-- password from their original invite-code signup).
-- -----------------------------------------------------------------------------
drop function if exists verify_invite_upgrade_otp(uuid, text);
create or replace function verify_invite_upgrade_otp(
  p_account_id uuid,
  p_otp text
) returns table (out_invite_code text)
language plpgsql
security definer
as $$
declare
  v_req access_requests%rowtype;
  v_new_code text;
begin
  select * into v_req
  from access_requests r
  where r.existing_account_id = p_account_id and r.status = 'pending' and r.request_type = 'invite_upgrade'
  order by r.created_at desc
  limit 1;

  if v_req.id is null then
    raise exception 'No pending upgrade request found';
  end if;
  if v_req.expires_at < now() then
    update access_requests set status = 'expired' where id = v_req.id;
    raise exception 'This code has expired -- please request an upgrade again';
  end if;
  if v_req.attempts >= 5 then
    update access_requests set status = 'expired' where id = v_req.id;
    raise exception 'Too many incorrect attempts -- please request an upgrade again';
  end if;
  if v_req.otp_hash <> crypt(p_otp, v_req.otp_hash) then
    update access_requests set attempts = attempts + 1 where id = v_req.id;
    raise exception 'Incorrect code';
  end if;

  update access_requests set status = 'approved' where id = v_req.id;

  v_new_code := generate_unique_invite_code();
  update accounts set invite_code = v_new_code, is_invite_created = false where id = p_account_id;

  return query select v_new_code;
end;
$$;


-- -----------------------------------------------------------------------------
-- regenerate_invite_code — invalidates an account's current code and
-- issues a new one (e.g. if the old one got shared too widely). Resets
-- the usage counter back to 0, since it's a fresh code. Callable by the
-- account owner themselves, or by an app admin on anyone's behalf.
-- -----------------------------------------------------------------------------
drop function if exists regenerate_invite_code(uuid, uuid);
create or replace function regenerate_invite_code(
  p_caller_account_id uuid,
  p_target_account_id uuid
) returns table (out_invite_code text)
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
  v_new_code text;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null then raise exception 'Caller account not found'; end if;
  if p_caller_account_id <> p_target_account_id and not v_caller.is_admin then
    raise exception 'Only the account owner or an app admin can regenerate this code';
  end if;

  v_new_code := generate_unique_invite_code();
  update accounts set invite_code = v_new_code, invite_code_uses = 0 where id = p_target_account_id;

  return query select v_new_code;
end;
$$;


-- -----------------------------------------------------------------------------
-- set_invite_code_limit — app-owner-only: adjust how many people a given
-- account's invite code can bring in. This is the "easy accessibility"
-- control requested for the owner panel.
-- -----------------------------------------------------------------------------
drop function if exists set_invite_code_limit(uuid, uuid, int);
create or replace function set_invite_code_limit(
  p_caller_account_id uuid,
  p_target_account_id uuid,
  p_new_limit int
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change invite limits';
  end if;
  if p_new_limit < 0 then
    raise exception 'Limit cannot be negative';
  end if;

  update accounts set invite_code_limit = p_new_limit where id = p_target_account_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- list_accounts_for_admin — owner-only overview: every account, their
-- invite usage, who invited them. Used by the owner-only admin panel.
-- -----------------------------------------------------------------------------
drop function if exists list_accounts_for_admin(uuid);
create or replace function list_accounts_for_admin(p_caller_account_id uuid)
returns table (
  out_id uuid, out_username text, out_display_name text, out_is_admin boolean,
  out_is_invite_created boolean, out_invited_by_username text,
  out_invite_code text, out_invite_code_limit int, out_invite_code_uses int,
  out_created_at timestamptz, out_last_login_at timestamptz
)
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can view this';
  end if;

  return query
    select a.id, a.username, a.display_name, a.is_admin, a.is_invite_created,
           inviter.username, a.invite_code, a.invite_code_limit, a.invite_code_uses,
           a.created_at, a.last_login_at
    from accounts a
    left join accounts inviter on inviter.id = a.invited_by_account_id
    order by a.created_at desc;
end;
$$;


-- -----------------------------------------------------------------------------
-- list_pending_requests_for_admin — owner-only: see pending access
-- requests and upgrade requests awaiting an OTP relay. Does NOT return
-- the OTP itself (it was only ever returned once, to the request-time
-- caller, and emailed) -- this is just for visibility into what's pending.
-- -----------------------------------------------------------------------------
drop function if exists list_pending_requests_for_admin(uuid);
create or replace function list_pending_requests_for_admin(p_caller_account_id uuid)
returns table (
  out_id uuid, out_request_type text, out_requested_username text,
  out_requester_display_name text, out_expires_at timestamptz, out_created_at timestamptz
)
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can view this';
  end if;

  return query
    select r.id, r.request_type, r.requested_username, r.requester_display_name, r.expires_at, r.created_at
    from access_requests r
    where r.status = 'pending'
    order by r.created_at desc;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_app_public_status — anyone (even logged out) can check whether
-- guest login should be offered.
-- -----------------------------------------------------------------------------
drop function if exists get_app_public_status();
create or replace function get_app_public_status() returns boolean
language sql
security definer
as $$
  select is_public from app_settings where id = 1;
$$;


-- -----------------------------------------------------------------------------
-- set_app_public — owner-only: flips public/private mode.
-- -----------------------------------------------------------------------------
drop function if exists set_app_public(uuid, boolean);
create or replace function set_app_public(
  p_caller_account_id uuid,
  p_is_public boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  update app_settings set is_public = p_is_public, updated_at = now() where id = 1;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_public_config — anyone (even logged out) can read the config values
-- that affect what they see before signing in: turn-timer bounds (shown
-- when a host sets up a room) and the current default invite-code limit
-- (shown for reference, though it doesn't affect already-issued codes).
-- Public/private status is intentionally kept separate
-- (get_app_public_status, above) since it's checked more often (every
-- AuthGate load) and a dedicated boolean-returning function is cheaper to
-- call than unpacking a row for just one field.
-- -----------------------------------------------------------------------------
drop function if exists get_public_config();
create or replace function get_public_config()
returns table (out_turn_timer_min int, out_turn_timer_max int, out_default_invite_limit int)
language sql
security definer
as $$
  select turn_timer_min_seconds, turn_timer_max_seconds, default_invite_code_limit
  from app_settings where id = 1;
$$;


-- -----------------------------------------------------------------------------
-- set_app_config — owner-only: adjust turn-timer bounds and the default
-- invite-code limit for newly issued codes.
--
-- IMPORTANT: turn_timer_min is clamped to a hard floor of 15 seconds
-- REGARDLESS of what the owner requests, enforced here in code, not just
-- documented. This protects an invariant the multiplayer design relies
-- on: the turn timer's minimum must stay at or above the presence-based
-- inactivity grace period, or the turn-timer's auto-random-move logic and
-- the "is this player actually gone" detection can fire in a confusing,
-- overlapping order (see project design notes on this). An owner
-- accidentally setting a 5-second minimum shouldn't be able to silently
-- reintroduce that bug -- so it just can't go below 15s from here, no
-- matter what's passed in.
-- -----------------------------------------------------------------------------
drop function if exists set_app_config(uuid, int, int, int);
create or replace function set_app_config(
  p_caller_account_id uuid,
  p_turn_timer_min int,
  p_turn_timer_max int,
  p_default_invite_limit int
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
  v_min int;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  v_min := greatest(p_turn_timer_min, 15);  -- hard floor, see comment above
  if p_turn_timer_max < v_min then
    raise exception 'Maximum turn timer must be greater than or equal to the minimum';
  end if;
  if p_turn_timer_max > 600 then
    raise exception 'Maximum turn timer cannot exceed 600 seconds';
  end if;
  if p_default_invite_limit < 1 or p_default_invite_limit > 1000 then
    raise exception 'Default invite limit must be between 1 and 1000';
  end if;

  update app_settings
  set turn_timer_min_seconds = v_min,
      turn_timer_max_seconds = p_turn_timer_max,
      default_invite_code_limit = p_default_invite_limit,
      updated_at = now()
  where id = 1;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_active_map_ids — everyone (even logged out) checks which maps are
-- currently active, to filter the map picker. A map with no row here yet
-- is treated as active by default (map_settings only needs a row once
-- someone actually deactivates it) -- so this returns the set of map_ids
-- that are EXPLICITLY inactive, and the client treats "not in this list"
-- as active, rather than requiring every map to have a row up front.
-- -----------------------------------------------------------------------------
drop function if exists get_inactive_map_ids();
create or replace function get_inactive_map_ids()
returns table (out_map_id text)
language sql
security definer
as $$
  select map_id from map_settings where is_active = false;
$$;


-- -----------------------------------------------------------------------------
-- set_map_active — owner-only: activate or deactivate a map by id. Upserts
-- the row (most maps won't have one until first touched here).
-- -----------------------------------------------------------------------------
drop function if exists set_map_active(uuid, text, boolean);
create or replace function set_map_active(
  p_caller_account_id uuid,
  p_map_id text,
  p_is_active boolean
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  insert into map_settings (map_id, is_active, updated_at)
  values (p_map_id, p_is_active, now())
  on conflict (map_id) do update set is_active = excluded.is_active, updated_at = excluded.updated_at;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_timing_config — anyone (even logged out) can read the timing/room-
-- size bounds that affect what they see: nomination/poll windows (shown
-- during a takeover flow), detective/player count bounds (shown in the
-- Create Room form), presence grace period, and pause resume deadline.
-- -----------------------------------------------------------------------------
drop function if exists get_timing_config();
create or replace function get_timing_config()
returns table (
  out_nomination_window_seconds int, out_poll_window_seconds int,
  out_min_detectives int, out_max_detectives int,
  out_min_total_players int, out_max_total_players int,
  out_presence_grace_period_seconds int, out_pause_resume_deadline_hours int
)
language sql
security definer
as $$
  select nomination_window_seconds, poll_window_seconds,
         min_detectives, max_detectives,
         min_total_players, max_total_players,
         presence_grace_period_seconds, pause_resume_deadline_hours
  from app_settings where id = 1;
$$;


-- -----------------------------------------------------------------------------
-- set_timing_config — admin-only: adjust the nomination/poll windows,
-- detective/player count bounds, presence grace period, and pause resume
-- deadline. Kept as a separate function from set_app_config (which
-- covers turn-timer bounds and invite limits) so each function stays
-- focused on one related group of settings rather than one giant
-- do-everything config call.
--
-- Sanity bounds are enforced here regardless of what's requested, same
-- spirit as set_app_config's 15-second turn-timer floor: these prevent
-- an admin from accidentally configuring something that would break the
-- game (e.g. max_detectives < min_detectives, or a 0-second nomination
-- window that nobody could ever respond within).
-- -----------------------------------------------------------------------------
drop function if exists set_timing_config(uuid, int, int, int, int, int, int, int, int);
create or replace function set_timing_config(
  p_caller_account_id uuid,
  p_nomination_window_seconds int,
  p_poll_window_seconds int,
  p_min_detectives int,
  p_max_detectives int,
  p_min_total_players int,
  p_max_total_players int,
  p_presence_grace_period_seconds int,
  p_pause_resume_deadline_hours int
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
  v_nomination int;
  v_poll int;
  v_grace int;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  v_nomination := greatest(p_nomination_window_seconds, 10);   -- floor: needs to be respondable
  v_poll := greatest(p_poll_window_seconds, 15);
  v_grace := greatest(p_presence_grace_period_seconds, 5);     -- floor: avoid false positives from normal blips

  if p_min_detectives < 3 then
    raise exception 'Minimum detectives cannot go below 3 (base game rule)';
  end if;
  if p_max_detectives < p_min_detectives then
    raise exception 'Maximum detectives must be greater than or equal to the minimum';
  end if;
  if p_min_total_players < 2 then
    raise exception 'Minimum total players cannot go below 2';
  end if;
  if p_max_total_players < p_min_total_players then
    raise exception 'Maximum total players must be greater than or equal to the minimum';
  end if;
  if p_pause_resume_deadline_hours < 1 or p_pause_resume_deadline_hours > 336 then
    raise exception 'Pause resume deadline must be between 1 and 336 hours (2 weeks)';
  end if;

  update app_settings
  set nomination_window_seconds = v_nomination,
      poll_window_seconds = v_poll,
      min_detectives = p_min_detectives,
      max_detectives = p_max_detectives,
      min_total_players = p_min_total_players,
      max_total_players = p_max_total_players,
      presence_grace_period_seconds = v_grace,
      pause_resume_deadline_hours = p_pause_resume_deadline_hours,
      updated_at = now()
  where id = 1;
end;
$$;


-- -----------------------------------------------------------------------------
-- login — username + password, returns a session token on success.
-- -----------------------------------------------------------------------------
drop function if exists login(text, text);
create or replace function login(
  p_username text,
  p_password text
) returns table (out_session_token text, out_account_id uuid, out_display_name text)
language plpgsql
security definer
as $$
declare
  v_account accounts%rowtype;
  v_token text;
begin
  select * into v_account from accounts a where a.username = lower(trim(p_username));
  if v_account.id is null or v_account.password_hash <> crypt(p_password, v_account.password_hash) then
    raise exception 'Incorrect username or password';
  end if;

  update accounts set last_login_at = now() where id = v_account.id;
  insert into sessions (account_id) values (v_account.id) returning token into v_token;

  return query select v_token, v_account.id, v_account.display_name;
end;
$$;


-- -----------------------------------------------------------------------------
-- validate_session — checks a stored session token is still valid.
-- Called once when the app loads, to silently restore a logged-in state
-- without asking for a password again.
-- -----------------------------------------------------------------------------
drop function if exists validate_session(text);
create or replace function validate_session(p_token text)
returns table (out_account_id uuid, out_display_name text)
language plpgsql
security definer
as $$
declare
  v_session sessions%rowtype;
  v_account accounts%rowtype;
begin
  select * into v_session from sessions s where s.token = p_token and s.expires_at > now();
  if v_session.token is null then
    return;
  end if;
  select * into v_account from accounts a where a.id = v_session.account_id;
  return query select v_account.id, v_account.display_name;
end;
$$;


-- -----------------------------------------------------------------------------
-- logout — invalidates a session token.
-- -----------------------------------------------------------------------------
drop function if exists logout(text);
create or replace function logout(p_token text) returns void
language sql
security definer
as $$
  delete from sessions where token = p_token;
$$;


-- -----------------------------------------------------------------------------
-- GRANTS — get_app_public_status must be callable by logged-out visitors
-- (the login screen needs to know whether to show "Continue as Guest"
-- before anyone has authenticated). Supabase's anon role can call any
-- RPC by default unless explicitly revoked, so no special grant should be
-- needed here -- but this is left as an explicit statement for clarity
-- and to guard against a future project-wide default-privilege change.
-- -----------------------------------------------------------------------------
grant execute on function get_app_public_status() to anon, authenticated;
grant execute on function get_public_config() to anon, authenticated;
grant execute on function get_inactive_map_ids() to anon, authenticated;
grant execute on function get_timing_config() to anon, authenticated;


-- -----------------------------------------------------------------------------
-- get_feature_config -- anyone (even logged out) reads the full feature
-- config: each feature's global on/off state, AND whether the admin has
-- permitted hosts to override it per-room. The Create Room form uses this
-- to decide which override toggles to even show the host -- if a feature
-- isn't overridable, the host never sees a choice for it at all, and the
-- admin's global setting simply applies.
-- -----------------------------------------------------------------------------
drop function if exists get_feature_config();
create or replace function get_feature_config()
returns table (
  out_takeovers_enabled boolean, out_takeovers_overridable boolean,
  out_takeover_reversal_enabled boolean, out_takeover_reversal_overridable boolean,
  out_end_game_vote_enabled boolean, out_end_game_vote_overridable boolean,
  out_pause_resume_enabled boolean, out_pause_resume_overridable boolean,
  out_redistribute_roles_enabled boolean, out_redistribute_roles_overridable boolean,
  out_position_highlight_style text, out_position_highlight_style_overridable boolean,
  out_destination_highlight_style text, out_destination_highlight_style_overridable boolean,
  out_route_explorer_enabled boolean, out_route_explorer_overridable boolean,
  out_round_scaling_ratio numeric, out_round_scaling_overridable boolean,
  out_public_rooms_enabled boolean
)
language sql
security definer
as $$
  select
    takeovers_enabled, takeovers_overridable_by_host,
    takeover_reversal_enabled, takeover_reversal_overridable_by_host,
    end_game_vote_enabled, end_game_vote_overridable_by_host,
    pause_resume_enabled, pause_resume_overridable_by_host,
    redistribute_roles_enabled, redistribute_roles_overridable_by_host,
    position_highlight_style, position_highlight_style_overridable_by_host,
    destination_highlight_style, destination_highlight_style_overridable_by_host,
    route_explorer_enabled, route_explorer_overridable_by_host,
    round_scaling_ratio, round_scaling_overridable_by_host,
    public_rooms_enabled
  from app_settings where id = 1;
$$;


grant execute on function get_feature_config() to anon, authenticated;


-- -----------------------------------------------------------------------------
-- set_feature_toggles -- admin-only: set each feature's global on/off
-- state AND whether it's overridable by hosts, in one call.
-- -----------------------------------------------------------------------------
drop function if exists set_feature_toggles(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean);
drop function if exists set_feature_toggles(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, boolean);
drop function if exists set_feature_toggles(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, boolean, boolean, boolean);
drop function if exists set_feature_toggles(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, boolean, boolean, boolean, numeric, boolean);
drop function if exists set_feature_toggles(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, boolean, boolean, boolean, numeric, boolean, boolean);
drop function if exists set_feature_toggles(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, boolean, text, boolean, boolean, boolean, numeric, boolean, boolean);
create or replace function set_feature_toggles(
  p_caller_account_id uuid,
  p_takeovers_enabled boolean, p_takeovers_overridable boolean,
  p_takeover_reversal_enabled boolean, p_takeover_reversal_overridable boolean,
  p_end_game_vote_enabled boolean, p_end_game_vote_overridable boolean,
  p_pause_resume_enabled boolean, p_pause_resume_overridable boolean,
  p_redistribute_roles_enabled boolean, p_redistribute_roles_overridable boolean,
  p_position_highlight_style text default 'ring', p_position_highlight_style_overridable boolean default true,
  p_destination_highlight_style text default 'rotating', p_destination_highlight_style_overridable boolean default true,
  p_route_explorer_enabled boolean default true, p_route_explorer_overridable boolean default true,
  p_round_scaling_ratio numeric default 1.0, p_round_scaling_overridable boolean default true,
  p_public_rooms_enabled boolean default true
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
  v_valid_styles text[] := array['ring', 'rotating', 'blink', 'static', 'none'];
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  if not (p_position_highlight_style = any(v_valid_styles)) then
    raise exception 'position_highlight_style must be one of: ring, rotating, blink, static, none';
  end if;
  if not (p_destination_highlight_style = any(v_valid_styles)) then
    raise exception 'destination_highlight_style must be one of: ring, rotating, blink, static, none';
  end if;
  if p_round_scaling_ratio < 0.3 or p_round_scaling_ratio > 3.0 then
    raise exception 'round_scaling_ratio must be between 0.3 and 3.0';
  end if;

  update app_settings
  set takeovers_enabled = p_takeovers_enabled,
      takeovers_overridable_by_host = p_takeovers_overridable,
      takeover_reversal_enabled = p_takeover_reversal_enabled,
      takeover_reversal_overridable_by_host = p_takeover_reversal_overridable,
      end_game_vote_enabled = p_end_game_vote_enabled,
      end_game_vote_overridable_by_host = p_end_game_vote_overridable,
      pause_resume_enabled = p_pause_resume_enabled,
      pause_resume_overridable_by_host = p_pause_resume_overridable,
      redistribute_roles_enabled = p_redistribute_roles_enabled,
      redistribute_roles_overridable_by_host = p_redistribute_roles_overridable,
      position_highlight_style = p_position_highlight_style,
      position_highlight_style_overridable_by_host = p_position_highlight_style_overridable,
      destination_highlight_style = p_destination_highlight_style,
      destination_highlight_style_overridable_by_host = p_destination_highlight_style_overridable,
      route_explorer_enabled = p_route_explorer_enabled,
      route_explorer_overridable_by_host = p_route_explorer_overridable,
      round_scaling_ratio = p_round_scaling_ratio,
      round_scaling_overridable_by_host = p_round_scaling_overridable,
      public_rooms_enabled = p_public_rooms_enabled,
      updated_at = now()
  where id = 1;
end;
$$;


-- -----------------------------------------------------------------------------
-- get_map_overrides -- anyone (even logged out) reads per-map overrides
-- for detective density ratio and ticket counts, so the client can apply
-- them on top of (or instead of) the computed defaults from
-- src/maps/mapSchema.js. Returns one row per map that HAS an override
-- set -- a map with no row here simply uses its computed defaults.
-- -----------------------------------------------------------------------------
drop function if exists get_map_overrides();
create or replace function get_map_overrides()
returns table (
  out_map_id text,
  out_detective_density_ratio_override numeric,
  out_ticket_counts_override jsonb,
  out_round_scaling_ratio_override numeric,
  -- Added for the in-UI map editor -- see curve_offset_overrides /
  -- station_overrides column comments in access_control_schema.sql.
  out_curve_offset_overrides jsonb,
  out_station_overrides jsonb
)
language sql
security definer
as $$
  select map_id, detective_density_ratio_override, ticket_counts_override, round_scaling_ratio_override,
         curve_offset_overrides, station_overrides
  from map_settings
  where detective_density_ratio_override is not null or ticket_counts_override is not null
     or round_scaling_ratio_override is not null or curve_offset_overrides is not null
     or station_overrides is not null;
$$;
grant execute on function get_map_overrides() to anon, authenticated;


-- -----------------------------------------------------------------------------
-- set_map_visual_overrides -- admin-only: set (or clear, by passing null)
-- a specific map's curve-shape and station-appearance overrides, from
-- the in-UI map editor. Deliberately a SEPARATE function from
-- set_map_ticket_overrides (rather than folding these into it) since
-- these two override groups are edited from genuinely different UI
-- flows (a visual drag-editor vs a numeric settings form) and have
-- different validation needs -- keeping them separate means a bug in
-- one save path can't corrupt the other's data.
--
-- Validation here is deliberately modest: this can only ever change how
-- the map LOOKS (curve bend amount, station position/label/name/
-- prominence), never which stations exist, which edges connect them, or
-- any ticket/round-timing value -- so there's no way for an admin
-- (accidentally or otherwise) to break actual game balance through this
-- function, only to make the map render oddly, which is low-stakes and
-- immediately visible + reversible (every value can be cleared back to
-- null = "use the map's own default"). Position/offset magnitudes are
-- still clamped to a generous sanity range as a defensive backstop
-- against a corrupted payload, but the REAL "keep nudges small" limit is
-- enforced client-side in the editor itself (it won't let a drag travel
-- far from the station's starting position), since the server has no
-- independent knowledge of any map's actual layout to check against
-- (maps are defined in code, not the database -- see the map_settings
-- table comment above).
-- -----------------------------------------------------------------------------
drop function if exists set_map_visual_overrides(uuid, text, jsonb, jsonb);
create or replace function set_map_visual_overrides(
  p_caller_account_id uuid,
  p_map_id text,
  p_curve_offset_overrides jsonb,
  p_station_overrides jsonb
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
  v_clamped_curves jsonb := '{}'::jsonb;
  v_clamped_stations jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_station_key text;
  v_station_val jsonb;
  v_clamped_station jsonb;
  v_x numeric;
  v_y numeric;
  v_label_dir text;
  v_name text;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  -- Clamp every curve offset magnitude to a generous sanity range --
  -- this is a defensive backstop only; the editor's own math (offset =
  -- projected drag distance) never produces values anywhere near this
  -- range in normal use.
  if p_curve_offset_overrides is not null then
    for v_key, v_val in select * from jsonb_each(p_curve_offset_overrides) loop
      v_clamped_curves := v_clamped_curves || jsonb_build_object(
        v_key, greatest(-150, least(150, (v_val#>>'{}')::numeric))
      );
    end loop;
  end if;

  -- Same defensive clamping per station field: label direction must be
  -- one of the 8 real compass values (or null/absent), name capped at a
  -- sane length, x/y clamped to a generous coordinate range covering
  -- every current map's viewBox with room to spare.
  if p_station_overrides is not null then
    for v_station_key, v_station_val in select * from jsonb_each(p_station_overrides) loop
      v_clamped_station := '{}'::jsonb;

      if v_station_val ? 'x' and v_station_val ? 'y' then
        v_x := greatest(-20, least(300, (v_station_val->>'x')::numeric));
        v_y := greatest(-20, least(300, (v_station_val->>'y')::numeric));
        v_clamped_station := v_clamped_station || jsonb_build_object('x', v_x, 'y', v_y);
      end if;

      if v_station_val ? 'labelDir' then
        v_label_dir := v_station_val->>'labelDir';
        if v_label_dir is null or v_label_dir = any(array['N','S','E','W','NE','NW','SE','SW']) then
          v_clamped_station := v_clamped_station || jsonb_build_object('labelDir', v_label_dir);
        end if;
      end if;

      if v_station_val ? 'name' then
        v_name := left(v_station_val->>'name', 60);
        v_clamped_station := v_clamped_station || jsonb_build_object('name', v_name);
      end if;

      if v_station_val ? 'isMajor' then
        v_clamped_station := v_clamped_station || jsonb_build_object('isMajor', (v_station_val->>'isMajor')::boolean);
      end if;

      v_clamped_stations := v_clamped_stations || jsonb_build_object(v_station_key, v_clamped_station);
    end loop;
  end if;

  insert into map_settings (map_id, curve_offset_overrides, station_overrides, updated_at)
  values (
    p_map_id,
    case when p_curve_offset_overrides is null then null else v_clamped_curves end,
    case when p_station_overrides is null then null else v_clamped_stations end,
    now()
  )
  on conflict (map_id) do update set
    curve_offset_overrides = case when p_curve_offset_overrides is null then null else v_clamped_curves end,
    station_overrides = case when p_station_overrides is null then null else v_clamped_stations end,
    updated_at = now();
end;
$$;
grant execute on function set_map_visual_overrides(uuid, text, jsonb, jsonb) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- set_map_ticket_overrides -- admin-only: set (or clear, by passing null)
-- a specific map's detective-density-ratio and/or ticket-count overrides.
-- Creates the map_settings row if it doesn't exist yet (a map that's
-- never been touched in the admin panel has no row at all until its
-- first override is set).
-- -----------------------------------------------------------------------------
drop function if exists set_map_ticket_overrides(uuid, text, numeric, jsonb);
drop function if exists set_map_ticket_overrides(uuid, text, numeric, jsonb, numeric);
create or replace function set_map_ticket_overrides(
  p_caller_account_id uuid,
  p_map_id text,
  p_detective_density_ratio_override numeric,
  p_ticket_counts_override jsonb,
  p_round_scaling_ratio_override numeric default null
) returns void
language plpgsql
security definer
as $$
declare
  v_caller accounts%rowtype;
  v_ratio numeric;
  v_round_ratio numeric;
begin
  select * into v_caller from accounts a where a.id = p_caller_account_id;
  if v_caller.id is null or not v_caller.is_admin then
    raise exception 'Only an app admin can change this setting';
  end if;

  -- same hard ceiling as the global default (0.20) -- an admin can't
  -- misconfigure an individual map's detective density any more than
  -- the global setting, for the same reason: too-dense games break the
  -- intended play experience regardless of which map it happens on.
  if p_detective_density_ratio_override is not null then
    v_ratio := greatest(0.01, least(0.20, p_detective_density_ratio_override));
  else
    v_ratio := null;
  end if;

  -- same 0.3-3.0 ceiling as the global round-scaling default, per-map
  if p_round_scaling_ratio_override is not null then
    v_round_ratio := greatest(0.3, least(3.0, p_round_scaling_ratio_override));
  else
    v_round_ratio := null;
  end if;

  insert into map_settings (map_id, detective_density_ratio_override, ticket_counts_override, round_scaling_ratio_override, updated_at)
  values (p_map_id, v_ratio, p_ticket_counts_override, v_round_ratio, now())
  on conflict (map_id) do update set
    detective_density_ratio_override = v_ratio,
    ticket_counts_override = p_ticket_counts_override,
    round_scaling_ratio_override = v_round_ratio,
    updated_at = now();
end;
$$;
