import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// ACCESS CONTROL API — wraps the RPCs in access_control_functions.sql, plus
// the notify-access-request Edge Function that emails the owner an OTP.
// ---------------------------------------------------------------------------

const SESSION_TOKEN_KEY = "scotlandyard_session_token";

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || `RPC ${name} failed`);
  return data;
}

export async function requestAccess({ username, displayName }) {
  const rows = await callRpc("request_access", {
    p_requested_username: username,
    p_requester_display_name: displayName,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to submit request");

  // Fire the notification email. This is separate from the RPC call above
  // on purpose: the RPC's job is "create the request + generate the OTP",
  // the Edge Function's job is "send an email" -- keeping them separate
  // means a flaky email provider can't prevent the request from being
  // recorded. If the email call fails, we still return success to the
  // requester (their request IS recorded), but log the failure so it's
  // debuggable from the browser console during setup/testing.
  try {
    const { error: fnError } = await supabase.functions.invoke("notify-access-request", {
      body: { username, displayName, otp: row.out_otp },
    });
    if (fnError) console.error("notify-access-request failed:", fnError);
  } catch (e) {
    console.error("notify-access-request failed:", e);
  }

  return { requestId: row.out_request_id };
}

export async function verifyOtp({ username, otp }) {
  const rows = await callRpc("verify_access_otp", { p_requested_username: username, p_otp: otp });
  const row = rows?.[0];
  if (!row) throw new Error("Verification failed");
  return { requestId: row.out_request_id, displayName: row.out_display_name };
}

export async function completeSignup({ requestId, password }) {
  const rows = await callRpc("complete_signup", { p_request_id: requestId, p_password: password });
  const row = rows?.[0];
  if (!row) throw new Error("Signup failed");
  localStorage.setItem(SESSION_TOKEN_KEY, row.out_session_token);
  return { accountId: row.out_account_id, displayName: row.out_display_name };
}

export async function login({ username, password }) {
  const rows = await callRpc("login", { p_username: username, p_password: password });
  const row = rows?.[0];
  if (!row) throw new Error("Login failed");
  localStorage.setItem(SESSION_TOKEN_KEY, row.out_session_token);
  return { accountId: row.out_account_id, displayName: row.out_display_name };
}

export async function signupWithInviteCode({ inviteCode, username, displayName, password }) {
  const rows = await callRpc("signup_with_invite_code", {
    p_invite_code: inviteCode,
    p_username: username,
    p_display_name: displayName,
    p_password: password,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Signup failed");
  localStorage.setItem(SESSION_TOKEN_KEY, row.out_session_token);
  return { accountId: row.out_account_id, displayName: row.out_display_name };
}

export async function getMyInviteInfo(accountId) {
  const rows = await callRpc("get_my_invite_info", { p_account_id: accountId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    inviteCode: row.out_invite_code,
    inviteCodeLimit: row.out_invite_code_limit,
    inviteCodeUses: row.out_invite_code_uses,
    isInviteCreated: row.out_is_invite_created,
  };
}

export async function requestInviteUpgrade(accountId) {
  const rows = await callRpc("request_invite_upgrade", { p_account_id: accountId });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to request upgrade");

  try {
    const { error: fnError } = await supabase.functions.invoke("notify-access-request", {
      body: { username: "(upgrade request)", displayName: `Upgrade request for account ${accountId}`, otp: row.out_otp },
    });
    if (fnError) console.error("notify-access-request (upgrade) failed:", fnError);
  } catch (e) {
    console.error("notify-access-request (upgrade) failed:", e);
  }

  return { requestId: row.out_request_id };
}

export async function verifyInviteUpgradeOtp({ accountId, otp }) {
  const rows = await callRpc("verify_invite_upgrade_otp", { p_account_id: accountId, p_otp: otp });
  const row = rows?.[0];
  if (!row) throw new Error("Verification failed");
  return { inviteCode: row.out_invite_code };
}

export async function regenerateInviteCode({ callerAccountId, targetAccountId }) {
  const rows = await callRpc("regenerate_invite_code", {
    p_caller_account_id: callerAccountId,
    p_target_account_id: targetAccountId,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to regenerate code");
  return { inviteCode: row.out_invite_code };
}

export async function setInviteCodeLimit({ callerAccountId, targetAccountId, newLimit }) {
  await callRpc("set_invite_code_limit", {
    p_caller_account_id: callerAccountId,
    p_target_account_id: targetAccountId,
    p_new_limit: newLimit,
  });
}

export async function listAccountsForOwner(callerAccountId) {
  const rows = await callRpc("list_accounts_for_owner", { p_caller_account_id: callerAccountId });
  return (rows || []).map((r) => ({
    id: r.out_id,
    username: r.out_username,
    displayName: r.out_display_name,
    isOwner: r.out_is_owner,
    isInviteCreated: r.out_is_invite_created,
    invitedByUsername: r.out_invited_by_username,
    inviteCode: r.out_invite_code,
    inviteCodeLimit: r.out_invite_code_limit,
    inviteCodeUses: r.out_invite_code_uses,
    createdAt: r.out_created_at,
    lastLoginAt: r.out_last_login_at,
  }));
}

export async function listPendingRequestsForOwner(callerAccountId) {
  const rows = await callRpc("list_pending_requests_for_owner", { p_caller_account_id: callerAccountId });
  return (rows || []).map((r) => ({
    id: r.out_id,
    requestType: r.out_request_type,
    requestedUsername: r.out_requested_username,
    requesterDisplayName: r.out_requester_display_name,
    expiresAt: r.out_expires_at,
    createdAt: r.out_created_at,
  }));
}

export async function getAppPublicStatus() {
  return callRpc("get_app_public_status", {});
}

export async function getPublicConfig() {
  const rows = await callRpc("get_public_config", {});
  const row = rows?.[0];
  if (!row) return { turnTimerMin: 30, turnTimerMax: 300, defaultInviteLimit: 20 };
  return {
    turnTimerMin: row.out_turn_timer_min,
    turnTimerMax: row.out_turn_timer_max,
    defaultInviteLimit: row.out_default_invite_limit,
  };
}

export async function setAppConfig({ callerAccountId, turnTimerMin, turnTimerMax, defaultInviteLimit }) {
  await callRpc("set_app_config", {
    p_caller_account_id: callerAccountId,
    p_turn_timer_min: turnTimerMin,
    p_turn_timer_max: turnTimerMax,
    p_default_invite_limit: defaultInviteLimit,
  });
}

export async function getInactiveMapIds() {
  const rows = await callRpc("get_inactive_map_ids", {});
  return (rows || []).map((r) => r.out_map_id);
}

export async function setMapActive({ callerAccountId, mapId, isActive }) {
  await callRpc("set_map_active", { p_caller_account_id: callerAccountId, p_map_id: mapId, p_is_active: isActive });
}

export async function setAppPublic({ callerAccountId, isPublic }) {
  await callRpc("set_app_public", { p_caller_account_id: callerAccountId, p_is_public: isPublic });
}

export async function validateStoredSession() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!token) return null;
  try {
    const rows = await callRpc("validate_session", { p_token: token });
    const row = rows?.[0];
    if (!row) {
      localStorage.removeItem(SESSION_TOKEN_KEY);
      return null;
    }
    return { accountId: row.out_account_id, displayName: row.out_display_name };
  } catch (e) {
    console.error("Session validation failed:", e);
    return null;
  }
}

const GUEST_FLAG_KEY = "scotlandyard_guest";

// Guest mode is deliberately NOT a server-side concept -- no accounts row,
// no session token, nothing persisted in Supabase. It's a local flag this
// browser sets after the visitor picks "Continue as Guest" on a public-
// mode app. If the app is later switched back to private mode, existing
// guest flags simply stop being honored on next load (see AuthGate.jsx).
export function startGuestSession(displayName) {
  localStorage.setItem(GUEST_FLAG_KEY, JSON.stringify({ displayName, startedAt: Date.now() }));
}

export function getGuestSession() {
  const raw = localStorage.getItem(GUEST_FLAG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearGuestSession() {
  localStorage.removeItem(GUEST_FLAG_KEY);
}

export async function logout() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_TOKEN_KEY);
  clearGuestSession();
  if (token) {
    try {
      await callRpc("logout", { p_token: token });
    } catch {
      // best-effort; local session is already cleared either way
    }
  }
}
