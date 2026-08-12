import { useState, useEffect, useRef, useMemo } from "react";
import * as api from "./supabaseApi.js";
import * as auth from "./accessControlApi.js";
import { validMovesFor } from "./gameEngine.js";
import { computeTurnSchedule, actingWindowSeconds } from "./turnSchedule.js";

// ---------------------------------------------------------------------------
// useTurnTimer — for multiplayer games with a per-room turn timer set.
// THREE-PHASE MODEL (mrx -> planning -> acting), replacing the old
// per-seat sequential walk:
//   - 'mrx': Mr.X's own turn, unchanged in spirit -- single actor, auto-
//     random-move fallback on expiry, same as before.
//   - 'planning': the shared buffer, unchanged in spirit -- nobody may
//     move yet. On expiry (or when the team signals ready early, see
//     GameBoard.jsx), any connected client calls begin_acting_phase.
//   - 'acting': NEW -- every detective may move independently, in any
//     order, as soon as this phase starts, for as long as the ONE shared
//     acting window lasts. There's no more "whose turn is it" for
//     detectives, so there's no more per-seat auto-move fallback either
//     -- on expiry, any connected client calls force_end_acting_phase,
//     which simply leaves whichever detectives never moved in place and
//     hands control back to Mr.X. This is actually simpler than the old
//     per-seat model, not just different: no seat-ownership bookkeeping
//     needed anymore (the old seatIndexWithinPlayer/extraSeatSeconds
//     machinery is gone entirely -- one shared clock for the whole team).
//
// IMPORTANT ARCHITECTURAL NOTE (unchanged from before): the server has NO
// independent knowledge of the map's graph -- for Mr.X's own auto-move
// fallback, this hook has ANY currently-connected client compute the
// random move locally and submit it through the EXACT SAME move RPC a
// normal move would use, so the server's own validation still fully
// applies. Multiple clients detecting the same expiry simultaneously is
// safe -- only the first RPC to actually land succeeds, the RPCs used for
// the planning->acting and acting->mrx transitions (begin_acting_phase,
// force_end_acting_phase) are BOTH explicitly written as idempotent no-ops
// if the phase has already moved on by the time they run.
// ---------------------------------------------------------------------------
export function useTurnTimer({
  roomId,
  myPlayerId,
  myPlayerSecret,
  map,
  match,
  // maxDetectivesForAnyOnePlayer -- how many detectives the BUSIEST
  // single player in this room controls. Sizes the shared acting window
  // (see actingWindowSeconds in turnSchedule.js), since each player works
  // through their own detectives sequentially inside that one window.
  maxDetectivesForAnyOnePlayer = 1,
  onMrXMove,
  onPassMrxTurn,
  onBeginActingPhase,
  onForceEndActingPhase,
}) {
  const [actSeconds, setActSeconds] = useState(null);
  const [extraDetectiveSeconds, setExtraDetectiveSeconds] = useState(null);
  const [bufferSecondsInput, setBufferSecondsInput] = useState(null); // the host's OWN planning-time number (room.planning_time_seconds), before ratio/bounds are applied
  const [ratios, setRatios] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [secondsRemaining, setSecondsRemaining] = useState(null);
  const [phaseLabel, setPhaseLabel] = useState(null); // "planning" | "mrx" | "acting" | null
  const attemptedForRef = useRef(null); // guards against submitting more than once for the same phase

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    Promise.all([api.fetchRoom(roomId), auth.getPublicConfig()])
      .then(([room, cfg]) => {
        if (cancelled) return;
        setActSeconds(room?.turn_timer_seconds ?? null);
        setBufferSecondsInput(room?.planning_time_seconds ?? null);
        setExtraDetectiveSeconds(room?.extra_detective_seconds ?? null);
        setRatios({
          mrxTimeRatio: cfg.mrxTimeRatio,
          extraSeatTimeRatio: cfg.extraSeatTimeRatio,
        });
        setBounds({
          mrxSecondsMin: cfg.mrxSecondsMin,
          mrxSecondsMax: cfg.mrxSecondsMax,
        });
      })
      .catch((e) => console.error("Failed to fetch room's turn timer / schedule ratios:", e));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const schedule = useMemo(
    () => (actSeconds && ratios && bounds ? computeTurnSchedule(actSeconds, bufferSecondsInput, ratios, bounds, extraDetectiveSeconds) : null),
    [actSeconds, bufferSecondsInput, ratios, bounds, extraDetectiveSeconds]
  );

  // The acting phase's real total length -- base act time plus the
  // configured top-up for each detective beyond the first held by the
  // busiest single player. Everyone in the room sees this SAME countdown
  // (it's one shared phase); per-player sub-turn progress is shown
  // separately in GameBoard.
  const actingTotalSeconds = useMemo(
    () => actingWindowSeconds(schedule, maxDetectivesForAnyOnePlayer),
    [schedule, maxDetectivesForAnyOnePlayer]
  );

  useEffect(() => {
    if (!schedule || !match?.roundPhase) {
      setSecondsRemaining(null);
      setPhaseLabel(null);
      return;
    }

    // Reset the "already attempted an auto-transition" guard whenever the
    // phase genuinely changes, keyed on whichever timestamp anchors the
    // CURRENT phase -- so a stale guard from a previous phase can never
    // suppress a legitimate one on a later phase.
    const anchor =
      match.roundPhase === "mrx" ? match.turnStartedAt : match.roundPhase === "planning" ? match.detectivePhaseStartedAt : match.actingPhaseStartedAt;
    const guardKey = `${match.roundPhase}|${anchor || ""}`;
    if (attemptedForRef.current !== guardKey) {
      attemptedForRef.current = null;
    }

    const tryExpire = (remaining, action) => {
      if (remaining <= 0 && attemptedForRef.current !== guardKey && match.phase === "playing") {
        attemptedForRef.current = guardKey; // mark BEFORE attempting, so overlapping ticks don't double-fire
        action();
      }
    };

    const tick = () => {
      const now = Date.now();

      if (match.roundPhase === "mrx") {
        if (!match.turnStartedAt) return;
        const elapsed = (now - new Date(match.turnStartedAt).getTime()) / 1000;
        const remaining = Math.max(0, Math.ceil(schedule.mrxSeconds - elapsed));
        setSecondsRemaining(remaining);
        setPhaseLabel("mrx");
        tryExpire(remaining, submitRandomMrxMove);
        return;
      }

      if (match.roundPhase === "planning") {
        if (!schedule.bufferSeconds) {
          // No planning window configured for this room -- begin_acting_phase
          // already gets called immediately server-side in that case is NOT
          // true (the server still parks in 'planning' until told to move
          // on) -- so the client itself is what skips straight through here.
          setSecondsRemaining(null);
          setPhaseLabel("planning");
          tryExpire(0, submitBeginActingPhase);
          return;
        }
        if (!match.detectivePhaseStartedAt) return;
        const elapsed = (now - new Date(match.detectivePhaseStartedAt).getTime()) / 1000;
        const remaining = Math.max(0, Math.ceil(schedule.bufferSeconds - elapsed));
        setSecondsRemaining(remaining);
        setPhaseLabel("planning");
        tryExpire(remaining, submitBeginActingPhase);
        return;
      }

      if (match.roundPhase === "acting") {
        if (!match.actingPhaseStartedAt || !actingTotalSeconds) return;
        const elapsed = (now - new Date(match.actingPhaseStartedAt).getTime()) / 1000;
        const remaining = Math.max(0, Math.ceil(actingTotalSeconds - elapsed));
        setSecondsRemaining(remaining);
        setPhaseLabel("acting");
        tryExpire(remaining, submitForceEndActingPhase);
        return;
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, actingTotalSeconds, match?.roundPhase, match?.turnStartedAt, match?.detectivePhaseStartedAt, match?.actingPhaseStartedAt, match?.phase]);

  // submitRandomMrxMove -- unchanged in spirit from before: Mr.X's own
  // turn still has exactly one actor, so a random-legal-move fallback on
  // expiry still makes sense the same way it always did.
  function submitRandomMrxMove() {
    if (!map || !match) return;
    const moves = validMovesFor(map, match.mrX.pos, match.mrX.tickets, true);
    if (moves.length === 0) {
      if (onPassMrxTurn) onPassMrxTurn();
      return;
    }
    const pick = moves[Math.floor(Math.random() * moves.length)];
    const ticketToUse = match.mrX.tickets[pick.mode] > 0 ? pick.mode : "black";
    onMrXMove(pick.to, pick.mode, ticketToUse);
  }

  function submitBeginActingPhase() {
    if (onBeginActingPhase) onBeginActingPhase();
  }

  function submitForceEndActingPhase() {
    if (onForceEndActingPhase) onForceEndActingPhase();
  }

  return {
    turnTimerSeconds: schedule?.actSeconds ?? null,
    secondsRemaining,
    phaseLabel, // "mrx" | "planning" | "acting" | null
    preThinkActive: phaseLabel === "planning",
    actingActive: phaseLabel === "acting",
    bufferSeconds: schedule?.bufferSeconds ?? null,
    mrxSeconds: schedule?.mrxSeconds ?? null,
    // actSeconds is now the ACTING PHASE'S FULL LENGTH (sized for the
    // busiest player), not the bare per-detective base -- that's what the
    // timer bar needs as its denominator, since it's what's actually
    // counting down. The unscaled base is still available separately.
    actSeconds: actingTotalSeconds ?? null,
    baseActSeconds: schedule?.actSeconds ?? null,
    extraSeatSeconds: schedule?.extraSeatSeconds ?? null,
  };
}
