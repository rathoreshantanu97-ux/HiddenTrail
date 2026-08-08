// ---------------------------------------------------------------------------
// GAME ENGINE — pure functions only. No useState, no Supabase calls, no
// side effects. Takes a match state + an action, returns a new match state.
//
// This is the ONE place game rules live. Both stores/localGameStore.js
// (same-device pass-and-play) and stores/supabaseGameStore.js (online
// multiplayer) call these same functions, so a rule change — a new ticket
// type, a different reveal schedule, a new win condition — is written once
// and automatically correct in both modes.
//
// Match state shape (the thing this file reads/writes):
// {
//   phase: "setup" | "handoff" | "playing" | "ended",
//   mapId, numDetectives,
//   round, turnOrder, turnIdx,
//   detectives: [{ id, color, pos, tickets, history }],
//   mrX: { pos, tickets, revealedPos, lastRevealRound, travelLog,
//          positionLog, doubleMoveActive, doubleMoveLegsRemaining },
//   winner, log,
// }
// ---------------------------------------------------------------------------

export const DETECTIVE_COLORS = ["#3b82f6", "#f97316", "#a855f7", "#10b981", "#ec4899"];
import { computeRoundsAndRevealSchedule, computeStartPool } from "../maps/mapSchema.js";

export const REVEAL_ROUNDS = new Set([3, 8, 13, 18, 22]);
export const MAX_ROUNDS = 22;
export const MAX_MOVES = 24;

export const TICKET_STARTS = {
  detective: { taxi: 10, bus: 8, underground: 4 },
  mrx: { taxi: 4, bus: 3, underground: 3, black: 5, double: 2 },
};

export function randomDistinctStarts(pool, n) {
  const p = [...pool];
  const picks = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * p.length);
    picks.push(p[idx]);
    p.splice(idx, 1);
  }
  return picks;
}

export function occupiedByDetective(detectives, station) {
  return detectives.some((d) => d.pos === station);
}

// Log entries are stored as { kind, payload } data, not plain strings,
// because rendering them needs theme context (Mr. X is "The Night King"
// on the Westeros map, detective names are GoT characters). This helper
// turns a data entry into display text using the active theme's naming
// functions, called at render time — the engine itself stays theme-agnostic.
export function formatLogEntry(entry, theme) {
  const { mrxName, detectiveName, stationLabel, modeLabel } = theme;
  const { kind, payload = {} } = entry;
  switch (kind) {
    case "game_started":
      return `Game started. ${payload.numDetectives} detective(s) vs ${mrxName()}.`;
    case "detective_move":
      return `${detectiveName(payload.detId)} \u2192 ${stationLabel(payload.to)} (${modeLabel(payload.mode)}). Ticket passed to ${mrxName()}.`;
    case "detective_capture":
      return `${mrxName()} captured at ${stationLabel(payload.to)}! Detectives win.`;
    case "mrx_move":
      return `${mrxName()} moved (${modeLabel(payload.mode)} ticket)${payload.revealedAt != null ? ` \u2014 REVEALED at station ${payload.revealedAt}` : ""}.`;
    case "mrx_walked_into_detective":
      return `${mrxName()} moved onto a detective's station! Detectives win.`;
    case "double_move_activated":
      return `${mrxName()} played a 2x (double move) card.`;
    case "turn_passed": {
      const label = payload.actor === "mrx" ? mrxName() : detectiveName(parseInt(String(payload.actor).slice(1), 10));
      return `${label} had no legal moves and passed their turn.`;
    }
    case "round_limit_reached":
      return `Round limit reached \u2014 ${mrxName()} wins by evasion!`;
    case "ended_by_vote":
      return `All players voted to end the game.`;
    case "ended_early":
      return `The game was ended early.`;
    case "game_paused":
      return `The game was paused.`;
    case "game_resumed":
      return `The game was resumed${payload.by ? ` by ${payload.by}` : ""}.`;
    case "ended_no_takeover":
      return `The game ended — nobody volunteered to take over ${mrxName()}.`;
    case "ended_pause_expired":
      return `The game ended automatically after being paused too long.`;
    default:
      return "";
  }
}

export function validMovesFor(map, pos, tickets, isMrX) {
  const moves = map.graph[pos] || [];
  return moves.filter((m) => {
    if (m.mrxOnly && !isMrX) return false; // ferries: Mr. X only
    if (isMrX) {
      if (m.mode === "ferry") return tickets.black > 0; // ferry always costs a black ticket
      return tickets[m.mode] > 0 || tickets.black > 0; // any move can be camouflaged with black
    }
    return tickets[m.mode] > 0;
  });
}

// Builds a fresh match state for a new game. Mirrors the old startGame().
export function initMatch({ map, mapId, numDetectives, roundScalingRatio }) {
  // Generate a FRESH, randomly-seeded starting pool for this specific
  // game, rather than reusing the map's one static pool every time.
  // Real board comparison: printed starting-position cards are a fixed
  // deck, so a fixed pool is the closer analog -- but since ours is
  // cheap to recompute, this gives more long-run variety (different
  // games use different regions of the map as starting zones) while the
  // greedy farthest-point algorithm still guarantees the same spacing
  // quality regardless of which random seed produced this particular
  // pool. Falls back to the map's static pool if stations data is
  // somehow unavailable (shouldn't happen for any real map).
  const gameStartPool = map.stations ? computeStartPool(map.stations, true) : map.startPool;
  const starts = randomDistinctStarts(gameStartPool, numDetectives + 1);
  const mrxStart = starts[0];
  const detStarts = starts.slice(1);
  // Ticket counts are computed per-map from actual graph connectivity
  // (see computeTicketCounts in mapSchema.js) rather than a single fixed
  // value for every map -- falls back to the original calibration
  // constants if a map somehow lacks this (shouldn't happen for any map
  // built via deriveMap, but keeps this defensive).
  const ticketCounts = map.ticketCounts || TICKET_STARTS;
  const dets = detStarts.map((pos, i) => ({
    id: i,
    color: DETECTIVE_COLORS[i],
    pos,
    startPos: pos, // retained separately from `pos` (which changes as they move) specifically so post-game replay can show where they began, not just their move history
    tickets: { ...ticketCounts.detective },
    history: [],
  }));
  const mrX = {
    pos: mrxStart,
    tickets: { ...ticketCounts.mrx },
    revealedPos: null,
    lastRevealRound: 0,
    travelLog: [],
    positionLog: [{ round: 0, pos: mrxStart, mode: null }],
    doubleMoveActive: false,
    doubleMoveLegsRemaining: 0,
  };
  const turnOrder = ["mrx", ...dets.map((d) => `d${d.id}`)];
  // Round count and reveal schedule are computed per-map from actual
  // graph connectivity (see computeRoundsAndRevealSchedule in
  // mapSchema.js), same reasoning as ticket counts -- stored directly on
  // match state (rather than as a fixed module-level constant) since
  // different maps now genuinely have different values. Falls back to
  // the original fixed 22/[3,8,13,18,22] if a map somehow lacks this
  // (shouldn't happen for any map built via deriveMap, but kept
  // defensive, same pattern as the ticketCounts fallback above).
  // Round count and reveal schedule: if the player explicitly chose a
  // non-default scaling ratio (Shorter/Standard/Longer), recompute the
  // schedule live using THAT ratio -- this is the actual fix for the
  // reported bug where choosing "Shorter" had no effect: the map's
  // PRECOMPUTED default (always ratio=1.0) was being used unconditionally
  // regardless of what was selected. Falls back to the map's own default
  // (or the original fixed constants) when no ratio was explicitly given.
  const roundsAndReveal =
    roundScalingRatio != null
      ? computeRoundsAndRevealSchedule(map.graph, Object.keys(map.stations).map(Number), roundScalingRatio)
      : map.roundsAndReveal || { totalRounds: MAX_ROUNDS, revealRounds: [...REVEAL_ROUNDS] };
  return {
    phase: "handoff",
    mapId,
    numDetectives,
    round: 1,
    maxRounds: roundsAndReveal.totalRounds,
    revealRounds: roundsAndReveal.revealRounds,
    turnOrder,
    turnIdx: 0,
    detectives: dets,
    mrX,
    winner: null,
    // Retained separately from the (constantly-changing) live tickets,
    // same reasoning as detectives' startPos above -- specifically so
    // post-game replay can reconstruct ticket counts at any point in the
    // game by walking forward from a known starting point, rather than
    // trying to reverse-engineer it from the final counts (which isn't
    // reliably possible, since ticket exchanges between Mr.X and
    // detectives during play make a simple reversal ambiguous).
    startingMrxTickets: { ...ticketCounts.mrx },
    startingDetectiveTickets: { ...ticketCounts.detective },
    log: [{ kind: "game_started", payload: { numDetectives } }],
  };
}

export function currentActor(match) {
  return match.turnOrder[match.turnIdx];
}

// Advances to the next turn/round, or ends the game if the round limit is
// hit. Returns a NEW match object (never mutates the input).
export function advanceTurn(match) {
  let nextIdx = match.turnIdx + 1;
  let nextRound = match.round;
  if (nextIdx >= match.turnOrder.length) {
    nextIdx = 0;
    nextRound = match.round + 1;
  }
  let next = { ...match, turnIdx: nextIdx, round: nextRound, phase: "handoff" };
  if (nextRound > match.maxRounds) {
    next = {
      ...next,
      winner: "mrx",
      phase: "ended",
      log: [...next.log, { kind: "round_limit_reached" }],
    };
  }
  return next;
}

// applyPassTurn — fixes a real, severe bug: a player whose relevant
// tickets are all exhausted (so validMovesFor returns an empty array
// for their current position) had NO way to skip their turn at all,
// permanently soft-locking the game for everyone. This applies no
// position/ticket change (there's nothing legal to do), just logs the
// pass and advances the turn exactly like a real move would. The
// CALLER is responsible for verifying validMovesFor is genuinely empty
// before offering this -- it's not a general "give up your turn"
// button, only a real last-resort when no legal move exists.
export function applyPassTurn(match, actorLabel) {
  const next = {
    ...match,
    log: [...match.log, { kind: "turn_passed", payload: { actor: actorLabel } }],
  };
  return advanceTurn(next);
}

// Applies a detective's move. `mode` must already be a validated legal
// move (validMovesFor should be checked by the caller before submitting).
export function applyDetectiveMove(map, match, detId, to, mode) {
  const detectives = match.detectives.map((d) => {
    if (d.id !== detId) return d;
    return {
      ...d,
      pos: to,
      tickets: { ...d.tickets, [mode]: d.tickets[mode] - 1 },
      history: [...d.history, { round: match.round, to, mode }],
    };
  });
  // The spent ticket doesn't vanish — it goes to Mr. X's pool, same as the
  // physical board game.
  const mrX = match.mrX
    ? { ...match.mrX, tickets: { ...match.mrX.tickets, [mode]: match.mrX.tickets[mode] + 1 } }
    : match.mrX;

  let next = {
    ...match,
    detectives,
    mrX,
    log: [...match.log, { kind: "detective_move", payload: { detId, to, mode } }],
  };

  if (mrX && to === mrX.pos) {
    next = {
      ...next,
      winner: "detectives",
      phase: "ended",
      log: [...next.log, { kind: "detective_capture", payload: { to, detId } }],
    };
    return next;
  }
  return advanceTurn(next);
}

// Applies Mr. X's move (one leg — double-move calls this twice in a row
// without an intervening advanceTurn, same as the original logic).
export function applyMrXMove(map, match, to, edgeMode, ticketUsed) {
  const isReveal = match.revealRounds.includes(match.round);
  const spent = edgeMode === "ferry" ? "black" : ticketUsed;
  const loggedMode = spent === "black" ? "black" : edgeMode;
  const prevMrX = match.mrX;
  const continuingDouble = prevMrX.doubleMoveActive && prevMrX.doubleMoveLegsRemaining > 1;

  const mrX = {
    ...prevMrX,
    pos: to,
    tickets: { ...prevMrX.tickets, [spent]: prevMrX.tickets[spent] - 1 },
    revealedPos: isReveal ? to : prevMrX.revealedPos,
    lastRevealRound: isReveal ? match.round : prevMrX.lastRevealRound,
    travelLog: [...prevMrX.travelLog, { round: match.round, move: prevMrX.travelLog.length + 1, mode: loggedMode }],
    positionLog: [...prevMrX.positionLog, { round: match.round, pos: to, mode: loggedMode }],
    doubleMoveActive: continuingDouble,
    doubleMoveLegsRemaining: continuingDouble ? prevMrX.doubleMoveLegsRemaining - 1 : 0,
  };

  let next = {
    ...match,
    mrX,
    log: [...match.log, { kind: "mrx_move", payload: { mode: loggedMode, revealedAt: isReveal ? to : null } }],
  };

  if (occupiedByDetective(match.detectives, to)) {
    return {
      ...next,
      winner: "detectives",
      phase: "ended",
      log: [...next.log, { kind: "mrx_walked_into_detective" }],
    };
  }

  if (continuingDouble) {
    // stay on Mr. X's turn for the second leg — no advanceTurn, no phase change
    return next;
  }
  return advanceTurn(next);
}

export function applyActivateDoubleMove(match) {
  if (!match.mrX || match.mrX.tickets.double <= 0 || match.mrX.doubleMoveActive) return match;
  return {
    ...match,
    mrX: {
      ...match.mrX,
      tickets: { ...match.mrX.tickets, double: match.mrX.tickets.double - 1 },
      doubleMoveActive: true,
      doubleMoveLegsRemaining: 2,
    },
    log: [...match.log, { kind: "double_move_activated" }],
  };
}

// Ends a pass-and-play game immediately, no vote needed (unlike
// multiplayer's end-game vote, a single device has one decision-maker at
// the keyboard, so a confirm step in the UI is enough safety). Reuses the
// same winner:null convention multiplayer's "ended by vote" case uses --
// EndedScreen and formatLogEntry already handle this correctly.
export function applyEndGameEarly(match) {
  if (match.phase === "ended") return match;
  return {
    ...match,
    phase: "ended",
    winner: null,
    log: [...match.log, { kind: "ended_early" }],
  };
}

// ---------------------------------------------------------------------------
// buildReplayTimeline — reconstructs the full move-by-move sequence of a
// FINISHED match, for the post-game replay feature. Rather than
// re-deriving history from match.log (which doesn't carry enough detail
// for Mr.X's moves -- his destination station is deliberately omitted
// from the shared log while hidden, per the game's whole secrecy design)
// this uses the two ALREADY-TRACKED, independent position histories that
// exist specifically for this purpose:
//   - match.mrX.positionLog: {round, pos, mode} per Mr.X move
//   - match.detectives[i].history: {round, to, mode} per detective move
// both of which are perfectly safe to use in full here, since a replay
// only ever happens on an ALREADY-ENDED game, where Mr.X's full route
// is no longer secret from anyone (the same principle the existing
// end-of-game route reveal already relies on).
//
// Interleaves these using match.turnOrder (the same fixed rotation used
// during live play: mrx, d0, d1, ..., repeating every round) so the
// replay steps through moves in the EXACT order they actually happened,
// not grouped by actor. Returns an array of steps, each one a complete,
// self-contained snapshot of "the board state immediately after this
// move" -- {round, actor, mrXPos, detectivePositions, ticketsSnapshot,
// logEntry} -- so the replay UI can jump to any step directly (for the
// scrub bar) without needing to replay everything before it first.
// ---------------------------------------------------------------------------
export function buildReplayTimeline(match) {
  const steps = [];

  // Build a flat, chronological list of every move from both sources,
  // each tagged with which "slot" in turnOrder it corresponds to (mrx,
  // d0, d1, ...) and its round number -- then sort by (round, turnOrder
  // index) to get the true chronological sequence.
  const rawMoves = [];
  for (const entry of match.mrX.positionLog) {
    if (entry.round === 0) continue; // the initial placement, not a move
    rawMoves.push({ round: entry.round, actor: "mrx", pos: entry.pos, mode: entry.mode });
  }
  for (const d of match.detectives) {
    for (const entry of d.history) {
      rawMoves.push({ round: entry.round, actor: `d${d.id}`, pos: entry.to, mode: entry.mode, detId: d.id });
    }
  }

  const turnOrderIndex = (actor) => match.turnOrder.indexOf(actor);
  rawMoves.sort((a, b) => a.round - b.round || turnOrderIndex(a.actor) - turnOrderIndex(b.actor));

  // Replay each move in order, maintaining a running snapshot of
  // positions AND tickets so every step is a complete, independently
  // jumpable state -- not just a diff from the previous step.
  //
  // Positions start from each actor's actual STARTING position
  // (mrX.positionLog's round-0 entry, and each detective's retained
  // startPos field -- see the startPos addition in initMatch/start_game
  // specifically for this purpose), so step 0 correctly shows everyone's
  // true starting positions, not a blank/unknown state.
  //
  // Tickets start from match.startingMrxTickets/startingDetectiveTickets
  // (added to match state specifically for replay -- see initMatch/
  // start_game) and are walked FORWARD, mirroring the exact exchange
  // rule the live game itself uses (applyDetectiveMove/applyMrXMove):
  // a detective's move spends one ticket of that mode from the moving
  // detective AND simultaneously adds one to Mr.X's pool of that same
  // mode (the "spent ticket doesn't vanish" rule); Mr.X's own moves
  // spend from his own pool (the mode actually used, which is "black"
  // when he camouflaged the move -- see positionLog's mode field, which
  // already records the TICKET TYPE spent, not just the edge's
  // transport type) and don't grant anything to anyone.
  let mrXPos = match.mrX.positionLog[0]?.pos ?? null;
  const detectivePositions = {};
  for (const d of match.detectives) {
    detectivePositions[d.id] = d.startPos ?? null;
  }

  let mrXTickets = { ...(match.startingMrxTickets || {}) };
  const detectiveTickets = {};
  for (const d of match.detectives) {
    detectiveTickets[d.id] = { ...(match.startingDetectiveTickets || {}) };
  }

  // The "round 0" starting snapshot, before any move has happened --
  // lets the replay UI show the initial board state as its own step,
  // same as how the live game shows starting positions before Round 1's
  // first move.
  steps.push({
    round: 0,
    actor: null,
    mode: null,
    mrXPos,
    detectivePositions: { ...detectivePositions },
    mrXTickets: { ...mrXTickets },
    detectiveTickets: Object.fromEntries(Object.entries(detectiveTickets).map(([id, t]) => [id, { ...t }])),
  });

  for (const move of rawMoves) {
    if (move.actor === "mrx") {
      mrXPos = move.pos;
      if (mrXTickets[move.mode] != null) {
        mrXTickets = { ...mrXTickets, [move.mode]: mrXTickets[move.mode] - 1 };
      }
    } else {
      detectivePositions[move.detId] = move.pos;
      const before = detectiveTickets[move.detId];
      detectiveTickets[move.detId] = { ...before, [move.mode]: (before[move.mode] ?? 0) - 1 };
      // the spent ticket transfers TO Mr.X's pool, same as live play
      mrXTickets = { ...mrXTickets, [move.mode]: (mrXTickets[move.mode] ?? 0) + 1 };
    }
    steps.push({
      round: move.round,
      actor: move.actor,
      mode: move.mode,
      mrXPos,
      detectivePositions: { ...detectivePositions },
      mrXTickets: { ...mrXTickets },
      detectiveTickets: Object.fromEntries(Object.entries(detectiveTickets).map(([id, t]) => [id, { ...t }])),
    });
  }

  return steps;
}
