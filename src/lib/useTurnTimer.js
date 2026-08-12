import { useState, useEffect, useRef, useMemo } from "react";
import * as api from "./supabaseApi.js";
import * as auth from "./accessControlApi.js";
import { currentActor, validMovesFor, occupiedByDetective } from "./gameEngine.js";
import { computeTurnSchedule, actSecondsForSeatIndex } from "./turnSchedule.js";

// ---------------------------------------------------------------------------
// useTurnTimer — for multiplayer games with a per-room turn timer set.
// Three responsibilities:
//   1. Compute the LIVE countdown (seconds remaining) AND which phase the
//      game is currently in (buffer / mrx / detective), shown to every
//      player regardless of whose turn it is.
//   2. Detect when the current turn has genuinely expired and, if so,
//      submit a RANDOM legal move on the active player's behalf.
//   3. Expose `preThinkActive` so GameBoard.jsx can block move submission
//      (while still allowing the existing explore/huddle preview system)
//      during the shared pre-think buffer.
//
// SCHEDULE: see turnSchedule.js for the full reasoning. In short, the
// host's one turn_timer_seconds number becomes:
//   - Mr. X's own turn window (mrxSeconds, admin ratio)
//   - a ONE-TIME shared pre-think buffer, prepended to the FIRST
//     detective seat's turn only (right after Mr. X moves) -- during
//     this window nobody can move, and no auto-move fallback can fire
//   - each detective seat's own act window, shorter for every seat past
//     a given player's FIRST seat this round (seatOwnership below)
//
// SEAT OWNERSHIP: knowing "is this the 1st or 2nd seat THIS PLAYER is
// moving this round" requires knowing which player controls which seat,
// not just the local viewer's own role -- every client running this hook
// needs to compute the IDENTICAL duration for whatever seat is currently
// active (since any client can submit the auto-move fallback). `players`
// (passed in, already polled by App.jsx for presence/inactivity checks --
// reused here rather than adding a second poll) supplies this: each row's
// `role` is a comma-separated seat list like "d0,d1".
//
// IMPORTANT ARCHITECTURAL NOTE (unchanged from before): the server has NO
// independent knowledge of the map's graph -- this hook has ANY currently-
// connected client compute the random move locally and submit it through
// the EXACT SAME move RPCs a normal move would use, so the server's own
// validation still fully applies. Multiple clients detecting the same
// expiry simultaneously is safe -- only the first RPC to actually land
// succeeds, others harmlessly fail their turn-order check.
// ---------------------------------------------------------------------------
export function useTurnTimer({ roomId, map, match, players, onDetectiveMove, onMrXMove, onPassTurn }) {
  const [actSeconds, setActSeconds] = useState(null);
  const [ratios, setRatios] = useState(null);
  const [secondsRemaining, setSecondsRemaining] = useState(null);
  const [phaseLabel, setPhaseLabel] = useState(null); // "buffer" | "mrx" | "detective" | null
  const attemptedForRef = useRef(null); // guards against submitting more than once for the same turn+phase

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    Promise.all([api.fetchRoom(roomId), auth.getPublicConfig()])
      .then(([room, cfg]) => {
        if (cancelled) return;
        setActSeconds(room?.turn_timer_seconds ?? null);
        setRatios({
          preThinkBufferRatio: cfg.preThinkBufferRatio,
          mrxTimeRatio: cfg.mrxTimeRatio,
          extraSeatTimeRatio: cfg.extraSeatTimeRatio,
        });
      })
      .catch((e) => console.error("Failed to fetch room's turn timer / schedule ratios:", e));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const schedule = useMemo(() => (actSeconds && ratios ? computeTurnSchedule(actSeconds, ratios) : null), [actSeconds, ratios]);

  // seatIndexWithinPlayer -- for each detective seat in turn_order, its
  // 0-based ordinal among THAT SEAT'S OWN player's seats, walked in
  // turn_order's own sequence. Recomputed only when turnOrder or the
  // players list itself changes (seat ownership doesn't change mid-game
  // outside a takeover, which already goes through its own reassignment
  // flow and will simply update `players`, naturally recomputing this).
  const seatIndexWithinPlayer = useMemo(() => {
    if (!match?.turnOrder || !players || players.length === 0) return {};
    const seatToPlayer = {};
    for (const p of players) {
      for (const seat of (p.role || "").split(",")) {
        if (seat && seat !== "mrx") seatToPlayer[seat] = p.id;
      }
    }
    const seenCountByPlayer = {};
    const result = {};
    for (const seat of match.turnOrder) {
      if (seat === "mrx") continue;
      const pid = seatToPlayer[seat];
      const idx = seenCountByPlayer[pid] || 0;
      result[seat] = idx;
      seenCountByPlayer[pid] = idx + 1;
    }
    return result;
  }, [match?.turnOrder, players]);

  useEffect(() => {
    if (!schedule || !match?.turnStartedAt) {
      setSecondsRemaining(null);
      setPhaseLabel(null);
      return;
    }

    // Reset the "already attempted an auto-move" guard whenever the turn
    // genuinely changes -- otherwise a stale guard from a PREVIOUS turn
    // could suppress a legitimate auto-move on a later one. Keyed on
    // BOTH turnStartedAt and detectivePhaseStartedAt so a fresh buffer
    // (which doesn't change turnStartedAt on later seats) still gets its
    // own guard state where relevant.
    const guardKey = `${match.turnStartedAt}|${match.detectivePhaseStartedAt || ""}`;
    if (attemptedForRef.current !== guardKey) {
      attemptedForRef.current = null;
    }

    const actor = currentActor(match);
    const isMrx = actor === "mrx";
    const firstDetectiveSeat = match.turnOrder?.[1];
    const isFirstDetectiveSeat = !isMrx && actor === firstDetectiveSeat;

    const tryExpire = (remaining) => {
      if (remaining <= 0 && attemptedForRef.current !== guardKey && match.phase === "playing") {
        attemptedForRef.current = guardKey; // mark BEFORE attempting, so overlapping ticks don't double-submit
        submitRandomMove();
      }
    };

    const tick = () => {
      const now = Date.now();

      if (isMrx) {
        const elapsed = (now - new Date(match.turnStartedAt).getTime()) / 1000;
        const remaining = Math.max(0, Math.ceil(schedule.mrxSeconds - elapsed));
        setSecondsRemaining(remaining);
        setPhaseLabel("mrx");
        tryExpire(remaining);
        return;
      }

      const seatIdx = seatIndexWithinPlayer[actor] ?? 0;
      const actDuration = actSecondsForSeatIndex(schedule, seatIdx);

      if (isFirstDetectiveSeat && match.detectivePhaseStartedAt) {
        // The shared pre-think buffer is anchored on detectivePhaseStartedAt
        // (stamped server-side exactly once per round, on the mrx ->
        // first-detective-seat transition) rather than turnStartedAt --
        // those two values are equal right when the buffer starts, but
        // the buffer must NOT reset if this same seat's turn_started_at
        // ever gets touched again for an unrelated reason.
        const sinceBufferStart = (now - new Date(match.detectivePhaseStartedAt).getTime()) / 1000;
        if (sinceBufferStart < schedule.bufferSeconds) {
          setSecondsRemaining(Math.max(0, Math.ceil(schedule.bufferSeconds - sinceBufferStart)));
          setPhaseLabel("buffer");
          return; // nobody can move yet -- no expiry/auto-move during the buffer
        }
        // Buffer just elapsed -- the act window counts from the END of
        // the buffer, not from turnStartedAt (which is the SAME moment
        // the buffer started, for this one seat).
        const actElapsed = sinceBufferStart - schedule.bufferSeconds;
        const remaining = Math.max(0, Math.ceil(actDuration - actElapsed));
        setSecondsRemaining(remaining);
        setPhaseLabel("detective");
        tryExpire(remaining);
        return;
      }

      // Every other detective seat: no buffer, just its own act window
      // starting fresh at turnStartedAt.
      const elapsed = (now - new Date(match.turnStartedAt).getTime()) / 1000;
      const remaining = Math.max(0, Math.ceil(actDuration - elapsed));
      setSecondsRemaining(remaining);
      setPhaseLabel("detective");
      tryExpire(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, match?.turnStartedAt, match?.detectivePhaseStartedAt, match?.phase, seatIndexWithinPlayer]);

  function submitRandomMove() {
    if (!map || !match) return;
    const actor = currentActor(match);
    if (actor === "mrx") {
      const moves = validMovesFor(map, match.mrX.pos, match.mrX.tickets, true);
      if (moves.length === 0) {
        if (onPassTurn) onPassTurn(actor);
        return;
      }
      const pick = moves[Math.floor(Math.random() * moves.length)];
      const ticketToUse = match.mrX.tickets[pick.mode] > 0 ? pick.mode : "black";
      onMrXMove(pick.to, pick.mode, ticketToUse);
    } else {
      const detId = parseInt(actor.slice(1), 10);
      const detective = match.detectives.find((d) => d.id === detId);
      if (!detective) return;
      const moves = validMovesFor(map, detective.pos, detective.tickets, false).filter(
        (m) => !occupiedByDetective(match.detectives, m.to)
      );
      if (moves.length === 0) {
        if (onPassTurn) onPassTurn(actor);
        return;
      }
      const pick = moves[Math.floor(Math.random() * moves.length)];
      onDetectiveMove(detId, pick.to, pick.mode);
    }
  }

  return {
    turnTimerSeconds: schedule?.actSeconds ?? null,
    secondsRemaining,
    phaseLabel,
    preThinkActive: phaseLabel === "buffer",
    bufferSeconds: schedule?.bufferSeconds ?? null,
    mrxSeconds: schedule?.mrxSeconds ?? null,
  };
}
