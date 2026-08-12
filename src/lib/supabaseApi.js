import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// SUPABASE API — one function per RPC defined in supabase/functions.sql.
// Every function here does exactly one job: call the RPC, unwrap Supabase's
// {data, error} response shape into "return data, or throw the error" so
// calling code can use plain try/catch instead of checking .error on every
// call site.
// ---------------------------------------------------------------------------

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || `RPC ${name} failed`);
  return data;
}

export async function createRoom({
  mapId,
  numDetectives,
  totalPlayers,
  hostDisplayName,
  hostRole,
  mapStationCount,
  turnTimerSeconds,
  planningTimeSeconds,
  featureOverrides = {},
  isPublic = false,
  roomName = null,
}) {
  const rows = await callRpc("create_room", {
    p_map_id: mapId,
    p_num_detectives: numDetectives,
    p_total_players: totalPlayers,
    p_host_display_name: hostDisplayName,
    p_host_role: hostRole || "mrx",
    p_takeovers_override: featureOverrides.takeovers ?? null,
    p_takeover_reversal_override: featureOverrides.takeoverReversal ?? null,
    p_end_game_vote_override: featureOverrides.endGameVote ?? null,
    p_pause_resume_override: featureOverrides.pauseResume ?? null,
    p_redistribute_roles_override: featureOverrides.redistributeRoles ?? null,
    p_turn_timer_seconds: turnTimerSeconds ?? null,
    p_planning_time_seconds: planningTimeSeconds ?? null,
    p_map_station_count: mapStationCount ?? null,
    p_position_highlight_style_override: featureOverrides.positionHighlightStyle ?? null,
    p_destination_highlight_style_override: featureOverrides.destinationHighlightStyle ?? null,
    p_route_explorer_override: featureOverrides.routeExplorer ?? null,
    p_round_scaling_ratio_override: featureOverrides.roundScalingRatio ?? null,
    p_is_public: isPublic,
    p_room_name: roomName,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to create room");
  // out_host_secret -- the host's session secret, returned ONLY here (at
  // creation time) and never retrievable again except by re-authenticating
  // via the room-code-based rejoin flow. Every subsequent action RPC now
  // requires it alongside the player_id, since player_id alone sits in a
  // deliberately-public table (see verify_player_secret in functions.sql
  // for the full reasoning) and can no longer prove identity by itself.
  return {
    roomId: row.out_room_id,
    roomCode: row.out_room_code,
    hostPlayerId: row.out_host_player_id,
    hostSecret: row.out_host_secret,
  };
}

export async function lookupRoom(roomCode) {
  const rows = await callRpc("lookup_room", { p_room_code: roomCode });
  const row = rows?.[0];
  if (!row) throw new Error("Room not found");
  return {
    roomId: row.out_room_id,
    mapId: row.out_map_id,
    numDetectives: row.out_num_detectives,
    totalPlayers: row.out_total_players,
    status: row.out_status,
    takenRoles: row.out_taken_roles || [],
    availableRoles: row.out_available_roles || [],
  };
}

export async function joinRoom({ roomCode, role, displayName }) {
  const rows = await callRpc("join_room", {
    p_room_code: roomCode,
    p_role: role,
    p_display_name: displayName,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to join room");
  return { roomId: row.out_room_id, playerId: row.out_player_id, playerSecret: row.out_player_secret };
}

export async function switchSeat({ roomId, playerId, newRole }) {
  await callRpc("switch_seat", { p_room_id: roomId, p_player_id: playerId, p_new_role: newRole });
}

export async function computeSeatLayout({ numDetectives, totalPlayers }) {
  const rows = await callRpc("compute_seat_layout", {
    p_num_detectives: numDetectives,
    p_total_players: totalPlayers,
  });
  return (rows || []).map((r) => ({ seatRole: r.out_seat_role, detectiveCount: r.out_detective_count }));
}

export async function startGameRpc({
  roomId,
  callerPlayerId,
  callerSecret,
  startPool,
  mrxStartingTickets,
  detectiveStartingTickets,
  detectiveColors,
  maxRounds,
  revealRounds,
  detectiveNames,
}) {
  const args = {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_start_pool: startPool,
    p_mrx_starting_tickets: mrxStartingTickets,
    p_detective_starting_tickets: detectiveStartingTickets,
    p_detective_colors: detectiveColors,
  };
  // Same omit-rather-than-null reasoning as maxRounds/revealRounds below
  // -- only send it when there's actually a roster to send.
  if (detectiveNames != null) args.p_detective_names = detectiveNames;
  // Only include these when actually provided -- explicitly passing null
  // would OVERRIDE the SQL function's defaults (22 / [3,8,13,18,22])
  // with null, not fall back to them; Postgres only applies a parameter
  // default when the argument is OMITTED entirely, never when it's
  // explicitly null. Omitting the key here is what actually triggers
  // the SQL-side fallback correctly.
  if (maxRounds != null) args.p_max_rounds = maxRounds;
  if (revealRounds != null) args.p_reveal_rounds = revealRounds;
  await callRpc("start_game", args);
}

export async function getMrxPosition({ roomId, callerPlayerId, callerSecret }) {
  const rows = await callRpc("get_mrx_position", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
  const row = rows?.[0];
  if (!row) return null; // not Mr. X, or game not started yet
  return { pos: row.out_mrx_pos, positionLog: row.out_mrx_position_log };
}

export async function makeDetectiveMove({ roomId, callerPlayerId, callerSecret, detId, to, mode }) {
  await callRpc("make_detective_move", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_det_id: detId,
    p_to_station: to,
    p_mode: mode,
  });
}

export async function makeMrxMove({ roomId, callerPlayerId, callerSecret, to, edgeMode, ticketUsed }) {
  await callRpc("make_mrx_move", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_to_station: to,
    p_edge_mode: edgeMode,
    p_ticket_used: ticketUsed,
  });
}

export async function activateDoubleMoveRpc({ roomId, callerPlayerId, callerSecret }) {
  await callRpc("activate_double_move", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
}

export async function sendMessage({ roomId, callerPlayerId, callerSecret, channel, body }) {
  await callRpc("send_message", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_channel: channel,
    p_body: body,
  });
}

export async function getDetectiveMessages({ roomId, callerPlayerId, callerSecret, after }) {
  const rows = await callRpc("get_detective_messages", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_after: after || "1970-01-01",
  });
  return (rows || []).map((r) => ({
    id: r.out_id,
    senderName: r.out_sender_name,
    senderRole: r.out_sender_role,
    body: r.out_body,
    createdAt: r.out_created_at,
  }));
}

export async function getAllChannelMessages({ roomId, after }) {
  const rows = await callRpc("get_all_channel_messages", {
    p_room_id: roomId,
    p_after: after || "1970-01-01",
  });
  return (rows || []).map((r) => ({
    id: r.out_id,
    senderName: r.out_sender_name,
    senderRole: r.out_sender_role,
    body: r.out_body,
    createdAt: r.out_created_at,
  }));
}

export async function reassignHost({ roomId, callerPlayerId, callerSecret, newHostPlayerId }) {
  await callRpc("reassign_host", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_new_host_player_id: newHostPlayerId,
  });
}

// Expanded to the full feature-override surface create_room accepts
// (previously just map/detective count/turn timer) -- see
// update_room_settings in functions.sql for the matching server-side
// expansion and the overridable-by-host re-validation.
export async function updateRoomSettings({
  roomId,
  callerPlayerId,
  callerSecret,
  mapId,
  numDetectives,
  totalPlayers,
  mapStationCount,
  turnTimerSeconds,
  planningTimeSeconds,
  featureOverrides = {},
  isPublic = false,
  roomName = null,
}) {
  await callRpc("update_room_settings", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_map_id: mapId,
    p_num_detectives: numDetectives,
    p_total_players: totalPlayers,
    p_map_station_count: mapStationCount ?? null,
    p_turn_timer_seconds: turnTimerSeconds ?? null,
    p_planning_time_seconds: planningTimeSeconds ?? null,
    p_takeovers_override: featureOverrides.takeovers ?? null,
    p_takeover_reversal_override: featureOverrides.takeoverReversal ?? null,
    p_end_game_vote_override: featureOverrides.endGameVote ?? null,
    p_pause_resume_override: featureOverrides.pauseResume ?? null,
    p_redistribute_roles_override: featureOverrides.redistributeRoles ?? null,
    p_position_highlight_style_override: featureOverrides.positionHighlightStyle ?? null,
    p_destination_highlight_style_override: featureOverrides.destinationHighlightStyle ?? null,
    p_route_explorer_override: featureOverrides.routeExplorer ?? null,
    p_round_scaling_ratio_override: featureOverrides.roundScalingRatio ?? null,
    p_is_public: isPublic,
    p_room_name: roomName,
  });
}

// setSeatColor -- pass color: null to clear a seat's override back to
// its default DETECTIVE_COLORS[seatIndex] assignment. See set_seat_color
// in functions.sql for the full validation (ownership, allow-list,
// duplicate-color rejection) -- this is a thin passthrough, all real
// rules live server-side.
export async function setSeatColor({ roomId, callerPlayerId, callerSecret, detectiveId, color }) {
  await callRpc("set_seat_color", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_detective_id: detectiveId,
    p_color: color ?? null,
  });
}

// setSeatName -- pass name: null to clear a seat's override back to its
// default map.characterNames[seatIndex] assignment. mapCharacterNames
// is the FULL roster for whichever map this room uses -- the server
// can't look this up itself (map data is client-side only), so it's
// passed on every call for validation/default-collision checking, same
// reasoning as p_map_station_count elsewhere. See set_seat_name in
// functions.sql for the full validation.
export async function setSeatName({ roomId, callerPlayerId, callerSecret, detectiveId, name, mapCharacterNames }) {
  await callRpc("set_seat_name", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_detective_id: detectiveId,
    p_name: name ?? null,
    p_map_character_names: mapCharacterNames ?? null,
  });
}

// passMrxTurn -- mrx-only now (see pass_turn's own comment server-side).
// Detectives use passDetectiveTurn instead, since the acting phase has no
// single "current actor" to pass anymore.
export async function passMrxTurn({ roomId, callerPlayerId, callerSecret }) {
  await callRpc("pass_turn", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_actor: "mrx",
  });
}

// passDetectiveTurn -- a detective with genuinely zero legal moves (or
// who simply doesn't want to move) marks themselves done for this
// round's acting phase, independent of everyone else.
export async function passDetectiveTurn({ roomId, callerPlayerId, callerSecret, detId }) {
  await callRpc("pass_detective_turn", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_det_id: detId,
  });
}

// beginActingPhase -- called once every detective player has signaled
// "ready" (see GameBoard.jsx's readiness UI), OR automatically when the
// planning countdown reaches zero (see useTurnTimer.js) -- ends the
// shared planning window and opens the simultaneous acting phase, where
// every detective may move independently.
export async function beginActingPhase({ roomId, callerPlayerId, callerSecret }) {
  await callRpc("begin_acting_phase", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
}

// forceEndActingPhase -- called by any connected client when the shared
// acting-phase timer reaches zero, so the round doesn't hang forever
// waiting on a detective who never acted. Un-acted detectives simply
// stay where they are for this round.
export async function forceEndActingPhase({ roomId, callerPlayerId, callerSecret }) {
  await callRpc("force_end_acting_phase", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
}

export async function leaveRoomPermanently({ roomId, playerId, callerSecret }) {
  await callRpc("leave_room_permanently", { p_room_id: roomId, p_player_id: playerId, p_caller_secret: callerSecret });
}

export async function leaveLobby({ roomId, playerId, callerSecret }) {
  await callRpc("leave_lobby", { p_room_id: roomId, p_player_id: playerId, p_caller_secret: callerSecret });
}

export async function proposeEndGame({ roomId, callerPlayerId, callerSecret }) {
  const rows = await callRpc("propose_end_game", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to propose ending the game");
  return { proposalId: row.out_proposal_id };
}

export async function getVoteStatusList({ roomId, voteTable, proposalId }) {
  const rows = await callRpc("get_vote_status_list", {
    p_room_id: roomId,
    p_vote_table: voteTable,
    p_proposal_id: proposalId,
  });
  return (rows || []).map((r) => ({
    playerId: r.out_player_id,
    displayName: r.out_display_name,
    status: r.out_status, // 'yes' | 'no' | 'pending'
  }));
}

export async function getActiveEndGameProposal(roomId) {
  const rows = await callRpc("get_active_end_game_proposal", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    proposalId: row.out_proposal_id,
    proposedByName: row.out_proposed_by_name,
    expiresAt: row.out_expires_at,
    totalPlayers: row.out_total_players,
    yesVotes: row.out_yes_votes,
    noVotes: row.out_no_votes,
    votedPlayerIds: row.out_voted_player_ids || [],
  };
}

export async function voteEndGame({ roomId, callerPlayerId, callerSecret, proposalId, vote }) {
  await callRpc("vote_end_game", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_proposal_id: proposalId,
    p_vote: vote,
  });
}

export async function flagInactivePlayer({ roomId, targetRole }) {
  const rows = await callRpc("flag_inactive_player", { p_room_id: roomId, p_target_role: targetRole });
  const row = rows?.[0];
  return row ? { eventId: row.out_event_id } : null;
}

export async function getActiveTakeoverEvent(roomId) {
  const rows = await callRpc("get_active_takeover_event", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    eventId: row.out_event_id,
    targetRole: row.out_target_role,
    targetDisplayName: row.out_target_display_name,
    status: row.out_status,
    decisionDeadline: row.out_decision_deadline,
    nomineeIds: row.out_nominee_ids || [],
    nomineeNames: row.out_nominee_names || [],
    voteCounts: row.out_vote_counts || {},
  };
}

export async function hostDecideTakeover({ roomId, callerPlayerId, callerSecret, eventId, decision }) {
  await callRpc("host_decide_takeover", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_event_id: eventId,
    p_decision: decision,
  });
}

export async function startTakeoverFromWaiting({ roomId, callerPlayerId, callerSecret, eventId }) {
  await callRpc("start_takeover_from_waiting", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_event_id: eventId,
  });
}

export async function nominateSelf({ roomId, callerPlayerId, callerSecret, eventId }) {
  await callRpc("nominate_self", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_event_id: eventId,
  });
}

export async function voteTakeoverNominee({ roomId, callerPlayerId, callerSecret, eventId, nomineePlayerId }) {
  await callRpc("vote_takeover_nominee", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_event_id: eventId,
    p_nominee_player_id: nomineePlayerId,
  });
}

export async function cancelTakeoverEvent({ roomId, eventId }) {
  await callRpc("cancel_takeover_event", { p_room_id: roomId, p_event_id: eventId });
}

export async function reassignVacatedSeat({ roomId, callerPlayerId, callerSecret, vacatedRole, recipientPlayerId }) {
  await callRpc("reassign_vacated_seat", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_vacated_role: vacatedRole,
    p_recipient_player_id: recipientPlayerId,
  });
}

export async function proposePause({ roomId, callerPlayerId, callerSecret }) {
  const rows = await callRpc("propose_pause", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to propose pausing");
  return { proposalId: row.out_proposal_id };
}

export async function getActivePauseProposal(roomId) {
  const rows = await callRpc("get_active_pause_proposal", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    proposalId: row.out_proposal_id,
    proposedByName: row.out_proposed_by_name,
    expiresAt: row.out_expires_at,
    totalPlayers: row.out_total_players,
    yesVotes: row.out_yes_votes,
    noVotes: row.out_no_votes,
    votedPlayerIds: row.out_voted_player_ids || [],
  };
}

export async function votePause({ roomId, callerPlayerId, callerSecret, proposalId, vote }) {
  await callRpc("vote_pause", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_proposal_id: proposalId,
    p_vote: vote,
  });
}

export async function proposeResume({ roomId, callerPlayerId, callerSecret }) {
  const rows = await callRpc("propose_resume", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to propose resuming");
  return { proposalId: row.out_proposal_id };
}

export async function getActiveResumeProposal(roomId) {
  const rows = await callRpc("get_active_resume_proposal", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    proposalId: row.out_proposal_id,
    proposedByName: row.out_proposed_by_name,
    expiresAt: row.out_expires_at,
    totalPlayers: row.out_total_players,
    yesVotes: row.out_yes_votes,
    noVotes: row.out_no_votes,
    votedPlayerIds: row.out_voted_player_ids || [],
  };
}

export async function voteResume({ roomId, callerPlayerId, callerSecret, proposalId, vote }) {
  await callRpc("vote_resume", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_proposal_id: proposalId,
    p_vote: vote,
  });
}

export async function getPauseStatus(roomId) {
  const rows = await callRpc("get_pause_status", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return { pausedAt: row.out_paused_at, resumeDeadline: row.out_resume_deadline, pausedByName: row.out_paused_by_name };
}

export async function checkPlayerStillInRoom({ roomId, playerId }) {
  const rows = await callRpc("check_player_still_in_room", { p_room_id: roomId, p_player_id: playerId });
  const row = rows?.[0];
  if (!row) return { stillInRoom: true, replacedRole: null, takeoverEventId: null, takeoverCompletedAt: null };
  return {
    stillInRoom: row.out_still_in_room,
    replacedRole: row.out_replaced_role,
    takeoverEventId: row.out_takeover_event_id,
    takeoverCompletedAt: row.out_takeover_completed_at,
  };
}

export async function proposeTakeoverReversal({ roomId, callerPlayerId, callerSecret, takeoverEventId }) {
  const rows = await callRpc("propose_takeover_reversal", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_takeover_event_id: takeoverEventId,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to propose a reversal");
  return { proposalId: row.out_proposal_id };
}

export async function getActiveTakeoverReversal(roomId) {
  const rows = await callRpc("get_active_takeover_reversal", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    proposalId: row.out_proposal_id,
    proposedByName: row.out_proposed_by_name,
    originalRole: row.out_original_role,
    expiresAt: row.out_expires_at,
    totalActive: row.out_total_active,
    yesVotes: row.out_yes_votes,
  };
}

export async function voteTakeoverReversal({ roomId, callerPlayerId, callerSecret, proposalId, vote }) {
  await callRpc("vote_takeover_reversal", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_proposal_id: proposalId,
    p_vote: vote,
  });
}

export async function proposeRedistributeRoles({ roomId, callerPlayerId, callerSecret, newAssignments }) {
  const rows = await callRpc("propose_redistribute_roles", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_new_assignments: newAssignments,
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to propose redistributing roles");
  return { proposalId: row.out_proposal_id };
}

export async function getActiveRedistributeProposal(roomId) {
  const rows = await callRpc("get_active_redistribute_proposal", { p_room_id: roomId });
  const row = rows?.[0];
  if (!row) return null;
  return {
    proposalId: row.out_proposal_id,
    proposedByName: row.out_proposed_by_name,
    newAssignments: row.out_new_assignments,
    expiresAt: row.out_expires_at,
    totalActive: row.out_total_active,
    yesVotes: row.out_yes_votes,
  };
}

export async function voteRedistributeRoles({ roomId, callerPlayerId, callerSecret, proposalId, vote }) {
  await callRpc("vote_redistribute_roles", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_proposal_id: proposalId,
    p_vote: vote,
  });
}

export async function heartbeat({ playerId, callerSecret }) {
  await callRpc("heartbeat", { p_player_id: playerId, p_caller_secret: callerSecret });
}

export async function getPublicRooms() {
  const rows = await callRpc("get_public_rooms", {});
  return (rows || []).map((r) => ({
    roomId: r.out_room_id,
    roomCode: r.out_room_code,
    roomName: r.out_room_name,
    mapId: r.out_map_id,
    joinedCount: r.out_joined_count,
    totalPlayers: r.out_total_players,
  }));
}

export async function getReconnectableLobbySeats(roomCode) {
  const rows = await callRpc("get_reconnectable_lobby_seats", { p_room_code: roomCode });
  return (rows || []).map((r) => ({
    roomId: r.out_room_id,
    playerId: r.out_player_id,
    role: r.out_role,
    displayName: r.out_display_name,
  }));
}

export async function rejoinLobbySeat({ playerId, displayName }) {
  const rows = await callRpc("rejoin_lobby_seat", { p_player_id: playerId, p_display_name: displayName ?? null });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to rejoin.");
  // Every rejoin ROTATES the session secret server-side -- a fresh one is
  // issued and returned only here, invalidating whatever was in play
  // before. Callers must persist out_player_secret going forward.
  return { roomId: row.out_room_id, role: row.out_role, playerSecret: row.out_player_secret };
}

// rejoinActiveSeat -- the mid-game counterpart to rejoinLobbySeat, for a
// player reconnecting via room code to a seat that's already playing
// (not still in the lobby). Same "must currently be inactive" gate, same
// secret-rotation behavior. Previously there was no dedicated RPC for
// this at all -- the client just adopted a bare, publicly-readable
// player_id with no server-side handshake, which is exactly the gap the
// session-secret work closes.
export async function rejoinActiveSeat({ playerId, displayName }) {
  const rows = await callRpc("rejoin_active_seat", { p_player_id: playerId, p_display_name: displayName ?? null });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to rejoin.");
  return { roomId: row.out_room_id, role: row.out_role, playerSecret: row.out_player_secret };
}

export async function freeInactiveLobbySeat({ roomId, callerPlayerId, callerSecret, targetRole }) {
  await callRpc("free_inactive_lobby_seat", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_caller_secret: callerSecret,
    p_target_role: targetRole,
  });
}

export async function getReconnectableSeats(roomCode) {
  const rows = await callRpc("get_reconnectable_seats", { p_room_code: roomCode });
  return (rows || []).map((r) => ({
    roomId: r.out_room_id,
    playerId: r.out_player_id,
    role: r.out_role,
    displayName: r.out_display_name,
  }));
}

export async function getActivePlayerIds(roomId) {
  const rows = await callRpc("get_active_player_ids", { p_room_id: roomId });
  return (rows || []).map((r) => r.out_player_id);
}

export async function fetchRoom(roomId) {
  const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function isFeatureEnabled({ featureName, roomId }) {
  // NOTE: is_feature_enabled returns a scalar boolean, not a table --
  // same shape consideration as getEffectivePositionHighlightStyle above.
  const value = await callRpc("is_feature_enabled", { p_feature_name: featureName, p_room_id: roomId || null });
  return value !== false; // fail open (missing/null treated as enabled) rather than silently hide a feature on a glitch
}

export async function getEffectivePositionHighlightStyle(roomId) {
  // NOTE: this Postgres function returns a scalar (text), not a table --
  // PostgREST shapes scalar-function responses as the raw value itself,
  // not wrapped in a rows array the way table-returning functions are.
  const value = await callRpc("get_effective_position_highlight_style", { p_room_id: roomId });
  return value || "ring";
}

export async function getEffectiveDestinationHighlightStyle(roomId) {
  const value = await callRpc("get_effective_destination_highlight_style", { p_room_id: roomId });
  return value || "rotating";
}

export async function fetchPlayers(roomId) {
  // Explicit column list, NOT select("*") -- players.session_secret is a
  // real column now (see functions.sql), and its column-level SELECT
  // privilege is deliberately revoked from anon/authenticated so it can
  // never be read this way, only ever returned inline by the specific
  // RPC that issues/rotates it for its own owner. select("*") against a
  // column this role has no privilege on fails outright, so this list
  // must be kept in sync with whatever the lobby/color/name pickers and
  // presence logic actually need.
  const { data, error } = await supabase
    .from("players")
    .select("id, room_id, role, display_name, connected_at, last_seen_at")
    .eq("room_id", roomId);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchGameStatePublic(roomId) {
  const { data, error } = await supabase
    .from("game_state_public")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
