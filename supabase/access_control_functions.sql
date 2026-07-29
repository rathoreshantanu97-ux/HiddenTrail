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
-- account owner themselves, or by an app owner on anyone's behalf.
-- -----------------------------------------------------------------------------
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
  if p_caller_account_id <> p_target_account_id and not v_caller.is_owner then
    raise exception 'Only the account owner or an app owner can regenerate this code';
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
  if v_caller.id is null or not v_caller.is_owner then
    raise exception 'Only an app owner can change invite limits';
  end if;
  if p_new_limit < 0 then
    raise exception 'Limit cannot be negative';
  end if;

  update accounts set invite_code_limit = p_new_limit where id = p_target_account_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- list_accounts_for_owner — owner-only overview: every account, their
-- invite usage, who invited them. Used by the owner-only admin panel.
-- -----------------------------------------------------------------------------
create or replace function list_accounts_for_owner(p_caller_account_id uuid)
returns table (
  out_id uuid, out_username text, out_display_name text, out_is_owner boolean,
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
  if v_caller.id is null or not v_caller.is_owner then
    raise exception 'Only an app owner can view this';
  end if;

  return query
    select a.id, a.username, a.display_name, a.is_owner, a.is_invite_created,
           inviter.username, a.invite_code, a.invite_code_limit, a.invite_code_uses,
           a.created_at, a.last_login_at
    from accounts a
    left join accounts inviter on inviter.id = a.invited_by_account_id
    order by a.created_at desc;
end;
$$;


-- -----------------------------------------------------------------------------
-- list_pending_requests_for_owner — owner-only: see pending access
-- requests and upgrade requests awaiting an OTP relay. Does NOT return
-- the OTP itself (it was only ever returned once, to the request-time
-- caller, and emailed) -- this is just for visibility into what's pending.
-- -----------------------------------------------------------------------------
create or replace function list_pending_requests_for_owner(p_caller_account_id uuid)
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
  if v_caller.id is null or not v_caller.is_owner then
    raise exception 'Only an app owner can view this';
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
create or replace function get_app_public_status() returns boolean
language sql
security definer
as $$
  select is_public from app_settings where id = 1;
$$;


-- -----------------------------------------------------------------------------
-- set_app_public — owner-only: flips public/private mode.
-- -----------------------------------------------------------------------------
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
  if v_caller.id is null or not v_caller.is_owner then
    raise exception 'Only an app owner can change this setting';
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
  if v_caller.id is null or not v_caller.is_owner then
    raise exception 'Only an app owner can change this setting';
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
  if v_caller.id is null or not v_caller.is_owner then
    raise exception 'Only an app owner can change this setting';
  end if;

  insert into map_settings (map_id, is_active, updated_at)
  values (p_map_id, p_is_active, now())
  on conflict (map_id) do update set is_active = excluded.is_active, updated_at = excluded.updated_at;
end;
$$;


-- -----------------------------------------------------------------------------
-- login — username + password, returns a session token on success.
-- -----------------------------------------------------------------------------
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
