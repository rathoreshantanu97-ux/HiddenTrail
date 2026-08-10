import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// ACCESS CONTROL API — wraps the RPCs in access_control_functions.sql, plus
// the notify-access-request Edge Function that emails the admin an OTP.
// ---------------------------------------------------------------------------

const SESSION_TOKEN_KEY = "scotlandyard_session_token";

async function callRpc(name, args) {
  if (!supabase) {
    // Supabase isn't configured -- this is a NORMAL, supported state
    // (pass-and-play is explicitly designed to work without it). Throw
    // a clear, catchable error so callers' existing try/catch fallback
    // logic (e.g. getFeatureConfig returning sensible defaults) actually
    // runs, instead of a raw "Cannot read properties of null" TypeError
    // that looks the same to a catch block but is a worse signal for
    // debugging and was masking this exact class of gap.
    throw new Error(`Supabase not configured -- cannot call ${name}`);
  }
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

export async function listAccountsForAdmin(callerAccountId) {
  const rows = await callRpc("list_accounts_for_admin", { p_caller_account_id: callerAccountId });
  return (rows || []).map((r) => ({
    id: r.out_id,
    username: r.out_username,
    displayName: r.out_display_name,
    isAdmin: r.out_is_admin,
    isInviteCreated: r.out_is_invite_created,
    invitedByUsername: r.out_invited_by_username,
    inviteCode: r.out_invite_code,
    inviteCodeLimit: r.out_invite_code_limit,
    inviteCodeUses: r.out_invite_code_uses,
    createdAt: r.out_created_at,
    lastLoginAt: r.out_last_login_at,
  }));
}

export async function listPendingRequestsForAdmin(callerAccountId) {
  const rows = await callRpc("list_pending_requests_for_admin", { p_caller_account_id: callerAccountId });
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

export async function getTimingConfig() {
  const rows = await callRpc("get_timing_config", {});
  const row = rows?.[0];
  if (!row) {
    return {
      nominationWindowSeconds: 30,
      pollWindowSeconds: 60,
      minDetectives: 3,
      maxDetectives: 20,
      minTotalPlayers: 2,
      maxTotalPlayers: 21,
      presenceGracePeriodSeconds: 25,
      pauseResumeDeadlineHours: 36,
    };
  }
  return {
    nominationWindowSeconds: row.out_nomination_window_seconds,
    pollWindowSeconds: row.out_poll_window_seconds,
    minDetectives: row.out_min_detectives,
    maxDetectives: row.out_max_detectives,
    minTotalPlayers: row.out_min_total_players,
    maxTotalPlayers: row.out_max_total_players,
    presenceGracePeriodSeconds: row.out_presence_grace_period_seconds,
    pauseResumeDeadlineHours: row.out_pause_resume_deadline_hours,
  };
}

export async function setTimingConfig({ callerAccountId, config }) {
  await callRpc("set_timing_config", {
    p_caller_account_id: callerAccountId,
    p_nomination_window_seconds: config.nominationWindowSeconds,
    p_poll_window_seconds: config.pollWindowSeconds,
    p_min_detectives: config.minDetectives,
    p_max_detectives: config.maxDetectives,
    p_min_total_players: config.minTotalPlayers,
    p_max_total_players: config.maxTotalPlayers,
    p_presence_grace_period_seconds: config.presenceGracePeriodSeconds,
    p_pause_resume_deadline_hours: config.pauseResumeDeadlineHours,
  });
}

export async function getMapOverrides() {
  const rows = await callRpc("get_map_overrides", {});
  const result = {};
  for (const row of rows || []) {
    result[row.out_map_id] = {
      detectiveDensityRatioOverride: row.out_detective_density_ratio_override,
      ticketCountsOverride: row.out_ticket_counts_override,
      roundScalingRatioOverride: row.out_round_scaling_ratio_override,
      // Added for the in-UI map editor -- see MapEditorPanel.jsx.
      curveOffsetOverrides: row.out_curve_offset_overrides,
      stationOverrides: row.out_station_overrides,
      // Added for map beautification -- see DecorationsLayer.jsx.
      decorations: row.out_decorations,
      backgroundOverrideColor: row.out_background_override,
    };
  }
  return result;
}

// setMapVisualOverrides -- saves the in-UI map editor's changes (curve
// shapes + station position/label/name/prominence + decorations +
// background color). Kept as a separate call from setMapTicketOverrides
// below since it's a different form/flow with different data shape --
// see set_map_visual_overrides in access_control_functions.sql for the
// full reasoning and validation.
export async function setMapVisualOverrides({
  callerAccountId,
  mapId,
  curveOffsetOverrides,
  stationOverrides,
  decorations,
  backgroundOverrideColor,
}) {
  await callRpc("set_map_visual_overrides", {
    p_caller_account_id: callerAccountId,
    p_map_id: mapId,
    p_curve_offset_overrides: curveOffsetOverrides,
    p_station_overrides: stationOverrides,
    p_decorations: decorations,
    p_background_override: backgroundOverrideColor,
  });
}

export async function setMapTicketOverrides({
  callerAccountId,
  mapId,
  detectiveDensityRatioOverride,
  ticketCountsOverride,
  roundScalingRatioOverride,
}) {
  await callRpc("set_map_ticket_overrides", {
    p_caller_account_id: callerAccountId,
    p_map_id: mapId,
    p_detective_density_ratio_override: detectiveDensityRatioOverride,
    p_ticket_counts_override: ticketCountsOverride,
    p_round_scaling_ratio_override: roundScalingRatioOverride,
  });
}

export async function getFeatureConfig() {
  const defaults = {
    takeoversEnabled: true, takeoversOverridable: true,
    takeoverReversalEnabled: true, takeoverReversalOverridable: true,
    endGameVoteEnabled: true, endGameVoteOverridable: true,
    pauseResumeEnabled: true, pauseResumeOverridable: true,
    redistributeRolesEnabled: true, redistributeRolesOverridable: true,
    positionHighlightStyle: "ring", positionHighlightStyleOverridable: true,
    destinationHighlightStyle: "rotating", destinationHighlightStyleOverridable: true,
    routeExplorerEnabled: true, routeExplorerOverridable: true,
    roundScalingRatio: 1.0, roundScalingOverridable: true,
    publicRoomsEnabled: true,
  };
  let row;
  try {
    const rows = await callRpc("get_feature_config", {});
    row = rows?.[0];
  } catch (e) {
    // Includes the "Supabase not configured" case (pass-and-play works
    // without a server connection by design) as well as genuine network
    // failures -- either way, fall back to sensible defaults rather than
    // letting this propagate and silently break every UI that depends on
    // it (this was a real gap: pass-and-play's round-scaling selector
    // never appeared at all without a Supabase connection, since this
    // function used to just throw instead of falling back).
    console.error("getFeatureConfig failed, using defaults:", e.message);
    row = null;
  }
  if (!row) {
    return defaults;
  }
  return {
    takeoversEnabled: row.out_takeovers_enabled,
    takeoversOverridable: row.out_takeovers_overridable,
    takeoverReversalEnabled: row.out_takeover_reversal_enabled,
    takeoverReversalOverridable: row.out_takeover_reversal_overridable,
    endGameVoteEnabled: row.out_end_game_vote_enabled,
    endGameVoteOverridable: row.out_end_game_vote_overridable,
    pauseResumeEnabled: row.out_pause_resume_enabled,
    pauseResumeOverridable: row.out_pause_resume_overridable,
    redistributeRolesEnabled: row.out_redistribute_roles_enabled,
    redistributeRolesOverridable: row.out_redistribute_roles_overridable,
    positionHighlightStyle: row.out_position_highlight_style,
    positionHighlightStyleOverridable: row.out_position_highlight_style_overridable,
    destinationHighlightStyle: row.out_destination_highlight_style,
    destinationHighlightStyleOverridable: row.out_destination_highlight_style_overridable,
    routeExplorerEnabled: row.out_route_explorer_enabled,
    routeExplorerOverridable: row.out_route_explorer_overridable,
    roundScalingRatio: row.out_round_scaling_ratio,
    roundScalingOverridable: row.out_round_scaling_overridable,
    publicRoomsEnabled: row.out_public_rooms_enabled,
  };
}

export async function setFeatureToggles({ callerAccountId, config }) {
  await callRpc("set_feature_toggles", {
    p_caller_account_id: callerAccountId,
    p_takeovers_enabled: config.takeoversEnabled,
    p_takeovers_overridable: config.takeoversOverridable,
    p_takeover_reversal_enabled: config.takeoverReversalEnabled,
    p_takeover_reversal_overridable: config.takeoverReversalOverridable,
    p_end_game_vote_enabled: config.endGameVoteEnabled,
    p_end_game_vote_overridable: config.endGameVoteOverridable,
    p_pause_resume_enabled: config.pauseResumeEnabled,
    p_pause_resume_overridable: config.pauseResumeOverridable,
    p_redistribute_roles_enabled: config.redistributeRolesEnabled,
    p_redistribute_roles_overridable: config.redistributeRolesOverridable,
    p_position_highlight_style: config.positionHighlightStyle,
    p_position_highlight_style_overridable: config.positionHighlightStyleOverridable,
    p_destination_highlight_style: config.destinationHighlightStyle,
    p_destination_highlight_style_overridable: config.destinationHighlightStyleOverridable,
    p_route_explorer_enabled: config.routeExplorerEnabled,
    p_route_explorer_overridable: config.routeExplorerOverridable,
    p_round_scaling_ratio: config.roundScalingRatio,
    p_round_scaling_overridable: config.roundScalingOverridable,
    p_public_rooms_enabled: config.publicRoomsEnabled,
  });
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
