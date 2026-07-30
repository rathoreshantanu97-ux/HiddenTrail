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

export async function createRoom({ mapId, numDetectives, totalPlayers, hostDisplayName, hostRole }) {
  const rows = await callRpc("create_room", {
    p_map_id: mapId,
    p_num_detectives: numDetectives,
    p_total_players: totalPlayers,
    p_host_display_name: hostDisplayName,
    p_host_role: hostRole || "mrx",
  });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to create room");
  return { roomId: row.out_room_id, roomCode: row.out_room_code, hostPlayerId: row.out_host_player_id };
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
  return { roomId: row.out_room_id, playerId: row.out_player_id };
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
  startPool,
  mrxStartingTickets,
  detectiveStartingTickets,
  detectiveColors,
}) {
  await callRpc("start_game", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_start_pool: startPool,
    p_mrx_starting_tickets: mrxStartingTickets,
    p_detective_starting_tickets: detectiveStartingTickets,
    p_detective_colors: detectiveColors,
  });
}

export async function getMrxPosition({ roomId, callerPlayerId }) {
  const rows = await callRpc("get_mrx_position", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
  });
  const row = rows?.[0];
  if (!row) return null; // not Mr. X, or game not started yet
  return { pos: row.out_mrx_pos, positionLog: row.out_mrx_position_log };
}

export async function makeDetectiveMove({ roomId, callerPlayerId, detId, to, mode }) {
  await callRpc("make_detective_move", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_det_id: detId,
    p_to_station: to,
    p_mode: mode,
  });
}

export async function makeMrxMove({ roomId, callerPlayerId, to, edgeMode, ticketUsed }) {
  await callRpc("make_mrx_move", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_to_station: to,
    p_edge_mode: edgeMode,
    p_ticket_used: ticketUsed,
  });
}

export async function activateDoubleMoveRpc({ roomId, callerPlayerId }) {
  await callRpc("activate_double_move", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
  });
}

export async function sendMessage({ roomId, callerPlayerId, channel, body }) {
  await callRpc("send_message", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_channel: channel,
    p_body: body,
  });
}

export async function getDetectiveMessages({ roomId, callerPlayerId, after }) {
  const rows = await callRpc("get_detective_messages", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
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

export async function reassignHost({ roomId, newHostPlayerId }) {
  await callRpc("reassign_host", { p_room_id: roomId, p_new_host_player_id: newHostPlayerId });
}

export async function leaveLobby({ roomId, playerId }) {
  await callRpc("leave_lobby", { p_room_id: roomId, p_player_id: playerId });
}

export async function proposeEndGame({ roomId, callerPlayerId }) {
  const rows = await callRpc("propose_end_game", { p_room_id: roomId, p_caller_player_id: callerPlayerId });
  const row = rows?.[0];
  if (!row) throw new Error("Failed to propose ending the game");
  return { proposalId: row.out_proposal_id };
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

export async function voteEndGame({ roomId, callerPlayerId, proposalId, vote }) {
  await callRpc("vote_end_game", {
    p_room_id: roomId,
    p_caller_player_id: callerPlayerId,
    p_proposal_id: proposalId,
    p_vote: vote,
  });
}

export async function heartbeat({ playerId }) {
  await callRpc("heartbeat", { p_player_id: playerId });
}

export async function fetchRoom(roomId) {
  const { data, error } = await supabase.from("rooms").select("*").eq("id", roomId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchPlayers(roomId) {
  const { data, error } = await supabase.from("players").select("*").eq("room_id", roomId);
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
