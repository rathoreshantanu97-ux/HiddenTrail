import { useState, useEffect, useRef } from "react";
import * as api from "./supabaseApi.js";
import { currentActor, validMovesFor, occupiedByDetective } from "./gameEngine.js";

// ---------------------------------------------------------------------------
// useTurnTimer — for multiplayer games with a per-room turn timer set.
// Two responsibilities:
//   1. Compute the LIVE countdown (seconds remaining), shown to every
//      player regardless of whose turn it is, per project design.
//   2. Detect when the current turn has genuinely expired and, if so,
//      submit a RANDOM legal move on the active player's behalf --
//      keeping the game moving even if they've walked away.
//
// IMPORTANT ARCHITECTURAL NOTE: the server has NO independent knowledge
// of the map's graph (station connectivity) -- that data only ever
// lives client-side (src/maps/*.js). Rather than teach the server the
// whole graph just for this (a much larger, riskier change), this hook
// has ANY currently-connected client compute the random move locally
// (using the map data it already has in memory) and submit it through
// the EXACT SAME move RPCs a normal move would use -- so the server's
// existing validation (tickets, turn order, occupancy) still fully
// applies; this hook never bypasses that, it just picks WHICH legal
// move to make when nobody else will. Since multiple clients might
// detect the same expiry simultaneously, the underlying RPCs are
// naturally idempotent-safe here: only the first one to actually reach
// the server will succeed (it advances the turn), and any others
// arriving moments later will simply fail their turn-order check
// harmlessly, since it's no longer that player's turn by then.
// ---------------------------------------------------------------------------
export function useTurnTimer({ roomId, map, match, onDetectiveMove, onMrXMove, onPassTurn }) {
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(null);
  const [secondsRemaining, setSecondsRemaining] = useState(null);
  const attemptedForRef = useRef(null); // guards against submitting more than once for the same turn

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    api
      .fetchRoom(roomId)
      .then((room) => {
        if (!cancelled) setTurnTimerSeconds(room?.turn_timer_seconds ?? null);
      })
      .catch((e) => console.error("Failed to fetch room's turn timer setting:", e));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!turnTimerSeconds || !match?.turnStartedAt) {
      setSecondsRemaining(null);
      return;
    }

    // Reset the "already attempted an auto-move for this turn" guard
    // whenever the turn genuinely changes (new turnStartedAt value) --
    // otherwise a stale guard from a PREVIOUS turn could incorrectly
    // suppress a legitimate auto-move on a later one.
    if (attemptedForRef.current !== match.turnStartedAt) {
      attemptedForRef.current = null;
    }

    const tick = () => {
      const startMs = new Date(match.turnStartedAt).getTime();
      const elapsedSec = (Date.now() - startMs) / 1000;
      const remaining = Math.max(0, Math.round(turnTimerSeconds - elapsedSec));
      setSecondsRemaining(remaining);

      if (remaining <= 0 && attemptedForRef.current !== match.turnStartedAt && match.phase === "playing") {
        attemptedForRef.current = match.turnStartedAt; // mark BEFORE attempting, so overlapping ticks don't double-submit from this same client
        submitRandomMove();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnTimerSeconds, match?.turnStartedAt, match?.phase]);

  function submitRandomMove() {
    if (!map || !match) return;
    const actor = currentActor(match);
    if (actor === "mrx") {
      const moves = validMovesFor(map, match.mrX.pos, match.mrX.tickets, true);
      // BUG FIX: this used to just `return` here, leaving the turn
      // stuck forever -- the guard above (attemptedForRef) marks this
      // turn as "already attempted" BEFORE this check runs, so it would
      // never retry, and no other mechanism advances the turn on this
      // player's behalf. The engine already has a dedicated pass_turn
      // RPC/applyPassTurn for exactly this "genuinely zero legal moves"
      // case (see the passTurnNote UI in GameBoard.jsx, which offers the
      // same action manually) -- calling it here means a player who's
      // stuck AND has walked away no longer stalls the game for
      // everyone else until a human notices and passes for them.
      if (moves.length === 0) {
        if (onPassTurn) onPassTurn(actor);
        return;
      }
      const pick = moves[Math.floor(Math.random() * moves.length)];
      // Prefer the pick's own mode; only fall back to black if that
      // specific ticket type is actually out (mirrors how a real player
      // choosing camouflage would only do so deliberately, not as a
      // silent default).
      const ticketToUse = match.mrX.tickets[pick.mode] > 0 ? pick.mode : "black";
      onMrXMove(pick.to, pick.mode, ticketToUse);
    } else {
      const detId = parseInt(actor.slice(1), 10);
      const detective = match.detectives.find((d) => d.id === detId);
      if (!detective) return;
      const moves = validMovesFor(map, detective.pos, detective.tickets, false).filter(
        (m) => !occupiedByDetective(match.detectives, m.to)
      );
      // Same fix as the Mr. X branch above -- fall back to passing the
      // turn instead of silently stalling.
      if (moves.length === 0) {
        if (onPassTurn) onPassTurn(actor);
        return;
      }
      const pick = moves[Math.floor(Math.random() * moves.length)];
      onDetectiveMove(detId, pick.to, pick.mode);
    }
  }

  return { turnTimerSeconds, secondsRemaining };
}
