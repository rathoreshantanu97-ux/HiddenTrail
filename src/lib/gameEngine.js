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
// because rendering them needs theme context (Mr. X is "The White Walker"
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
    case "round_limit_reached":
      return `Round limit reached \u2014 ${mrxName()} wins by evasion!`;
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
export function initMatch({ map, mapId, numDetectives }) {
  const starts = randomDistinctStarts(map.startPool, numDetectives + 1);
  const mrxStart = starts[0];
  const detStarts = starts.slice(1);
  const dets = detStarts.map((pos, i) => ({
    id: i,
    color: DETECTIVE_COLORS[i],
    pos,
    tickets: { ...TICKET_STARTS.detective },
    history: [],
  }));
  const mrX = {
    pos: mrxStart,
    tickets: { ...TICKET_STARTS.mrx },
    revealedPos: null,
    lastRevealRound: 0,
    travelLog: [],
    positionLog: [{ round: 0, pos: mrxStart, mode: null }],
    doubleMoveActive: false,
    doubleMoveLegsRemaining: 0,
  };
  const turnOrder = ["mrx", ...dets.map((d) => `d${d.id}`)];
  return {
    phase: "handoff",
    mapId,
    numDetectives,
    round: 1,
    turnOrder,
    turnIdx: 0,
    detectives: dets,
    mrX,
    winner: null,
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
  if (nextRound > MAX_ROUNDS) {
    next = {
      ...next,
      winner: "mrx",
      phase: "ended",
      log: [...next.log, { kind: "round_limit_reached" }],
    };
  }
  return next;
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
      log: [...next.log, { kind: "detective_capture", payload: { to } }],
    };
    return next;
  }
  return advanceTurn(next);
}

// Applies Mr. X's move (one leg — double-move calls this twice in a row
// without an intervening advanceTurn, same as the original logic).
export function applyMrXMove(map, match, to, edgeMode, ticketUsed) {
  const isReveal = REVEAL_ROUNDS.has(match.round);
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
