// ---------------------------------------------------------------------------
// Converts a Supabase `game_state_public` row (+ optionally Mr. X's own
// secret position, if the caller IS Mr. X) into the exact same `match`
// object shape that gameEngine.js / localGameStore.js produce. This is
// what lets every rendering component in App.jsx stay store-agnostic —
// they read match.round, match.detectives, match.mrX.tickets, etc.
// identically regardless of which store produced the object.
// ---------------------------------------------------------------------------
export function rowToMatch(gsRow, myMrxPosition) {
  if (!gsRow) return null;
  return {
    phase: gsRow.phase,
    round: gsRow.round,
    // CRITICAL FIX: these two were missing entirely until now -- without
    // them, match.maxRounds/match.revealRounds were undefined on every
    // multiplayer client, meaning any UI reading them directly (rather
    // than through the server, which enforces its OWN copy of these
    // values independently) would show "undefined" or crash. The actual
    // enforcement (round limit, reveal-round detection) happens
    // server-side in advance_turn_internal/make_mrx_move, which had
    // their OWN separate hardcoded-values bug, fixed alongside this one.
    maxRounds: gsRow.max_rounds ?? 22,
    revealRounds: gsRow.reveal_rounds ?? [3, 8, 13, 18, 22],
    turnOrder: gsRow.turn_order,
    turnIdx: gsRow.turn_idx,
    detectives: gsRow.detectives, // already the right shape: [{id,color,pos,startPos,tickets,history}]
    mrX: {
      // `pos` is only ever populated here if the CALLER is Mr. X (passed
      // in as myMrxPosition, fetched via the get_mrx_position RPC, which
      // itself enforces that only Mr. X's own client gets a real value).
      // Detective clients get `pos: null` — this is intentional and is
      // what keeps Mr. X's position out of their state entirely, not
      // just out of their rendering.
      pos: myMrxPosition?.pos ?? null,
      tickets: gsRow.mrx_tickets,
      revealedPos: gsRow.mrx_revealed_pos,
      lastRevealRound: gsRow.mrx_last_reveal_round,
      travelLog: gsRow.mrx_travel_log,
      positionLog: myMrxPosition?.positionLog ?? extractRevealedPositionLog(gsRow.log),
      doubleMoveActive: gsRow.mrx_double_move_active,
      doubleMoveLegsRemaining: gsRow.mrx_double_move_legs_remaining,
    },
    winner: gsRow.winner,
    log: gsRow.log || [],
    // Needed for post-game replay's ticket reconstruction (see
    // buildReplayTimeline in gameEngine.js) -- these are the STARTING
    // ticket counts, retained separately from the live, constantly-
    // changing ones above.
    startingMrxTickets: gsRow.starting_mrx_tickets,
    startingDetectiveTickets: gsRow.starting_detective_tickets,
    turnStartedAt: gsRow.turn_started_at,
  };
}

// At game end, the server appends a `reveal_full_route` log entry
// containing Mr. X's full position log — this is the ONE case where a
// detective client is allowed to see Mr. X's positions, because the game
// has already ended and the server explicitly chose to reveal it. This
// pulls that out of the log for the "full route revealed" end screen.
function extractRevealedPositionLog(log) {
  if (!log) return [];
  const entry = [...log].reverse().find((e) => e.kind === "reveal_full_route");
  return entry?.payload?.positionLog || [];
}
