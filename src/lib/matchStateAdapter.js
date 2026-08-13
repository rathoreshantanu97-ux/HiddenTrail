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
      // Was missing entirely -- GameBoard.jsx gates the reveal marker
      // and "Last confirmed sighting" text on
      // lastRevealMove === travelLog.length (see comments there), so
      // without this the reveal never actually rendered on any
      // multiplayer client, even when revealedPos/lastRevealRound were
      // set correctly server-side.
      lastRevealMove: gsRow.mrx_last_reveal_move,
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
    // detectivePhaseStartedAt -- stamped by advance_turn_internal ONLY on
    // the mrx -> first-detective-seat transition (see the SQL comment
    // there), i.e. the instant the shared pre-think buffer for this
    // round begins. null until Mr. X has made at least one move. See
    // turnSchedule.js / useTurnTimer.js for how this anchors the buffer
    // countdown.
    detectivePhaseStartedAt: gsRow.detective_phase_started_at,
    // roundPhase / actingPhaseStartedAt / detectivesActed -- the NEW
    // 3-phase model (mrx -> planning -> acting), multiplayer only. Local
    // pass-and-play never sets these (single shared device, still fully
    // sequential -- simultaneous action makes no sense with one device),
    // so GameBoard.jsx branches its interaction model on myRole === null
    // vs not, not on the presence of these fields alone.
    roundPhase: gsRow.round_phase,
    actingPhaseStartedAt: gsRow.acting_phase_started_at,
    detectivesActed: gsRow.detectives_acted || [],
    // planningReadyPlayers -- player ids (as strings) who've ticked
    // "ready" during the current planning phase. Server-owned: the
    // server, not the client, decides when this constitutes unanimity
    // and flips the phase (see the set_planning_ready RPC). The client
    // only reads it to render "Ready (X of Y)".
    planningReadyPlayers: gsRow.planning_ready_players || [],
    // v3.28 -- CUMULATIVE DETECTIVE-STAY TALLY. Every detective stay
    // action of the whole game, summed server-side (see
    // pass_detective_turn / expire_acting_pools / force_end_acting_phase).
    // Fully public on purpose: it is a game-mechanic counter, not
    // position information, so detectives AND Mr.X both read it.
    detectiveStayTally: gsRow.detective_stay_tally ?? 0,
    // lastStayBonus -- {type, types?, tally, round, x, y, seq} for the
    // most recent bonus grant, or null if none has happened yet. Drives
    // the one-round flash banner. `seq` is the tally value at grant time,
    // which is strictly monotonic, so the client can tell "a NEW bonus"
    // from "the same old one re-rendered" without any extra bookkeeping.
    lastStayBonus: gsRow.last_stay_bonus ?? null,
  };
}

// ---------------------------------------------------------------------------
// STAY-BONUS CONFIG + PROGRESS (v3.28)
//
// The two thresholds live on the ROOM (rooms.stay_black_threshold /
// stay_double_threshold), not on the game state, because they are
// admin-configurable settings rather than per-game progress. Both are
// nullable, meaning "use the default" -- and the defaults are resolved
// here EXACTLY as the server's resolve_stay_thresholds() does, so the
// widget can never disagree with what the server will actually grant.
//
// X and Y are INDEPENDENT arbitrary integers. Nothing here assumes Y is
// a multiple of X, or larger than X, or related to it in any way:
// X=2,Y=7 is a valid configuration and is handled by the same modulo
// walk the server uses.
// ---------------------------------------------------------------------------
export function resolveStayThresholds(room) {
  const numDet = room?.num_detectives ?? 3;
  const x = Math.max(1, room?.stay_black_threshold ?? numDet);
  const y = Math.max(1, room?.stay_double_threshold ?? x * 3);
  return { x, y };
}

// bonusForTally: what a stay landing on exactly `tally` would grant, or
// null. Mirrors stay_tally_bonuses() in SQL: a reward happens ONLY at a
// multiple of X, and such a multiple grants "double" instead of "black"
// when it is also a multiple of Y. A multiple of Y that is not a
// multiple of X grants nothing at all.
export function bonusForTally(tally, x, y) {
  if (!(x >= 1) || tally < 1) return null;
  if (tally % x !== 0) return null;
  if (y >= 1 && tally % y === 0) return "double";
  return "black";
}

// stayBonusInfo: everything the tally widget needs, derived rather than
// hardcoded, so it adapts to whatever X/Y the room is configured with.
export function stayBonusInfo(match, room) {
  const { x, y } = resolveStayThresholds(room);
  const tally = match?.detectiveStayTally ?? 0;
  // Scan forward for the next tally value that grants anything. Bounded
  // by 2*x*y + x, which is comfortably past the first common multiple of
  // any valid X/Y pair, so this always terminates and always finds one.
  let next = null;
  for (let t = tally + 1; t <= tally + 2 * x * y + x; t++) {
    const b = bonusForTally(t, x, y);
    if (b) {
      next = { at: t, type: b, staysAway: t - tally };
      break;
    }
  }
  return { x, y, tally, next };
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
