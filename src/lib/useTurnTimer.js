import { useState, useEffect, useRef, useMemo } from "react";
import * as api from "./supabaseApi.js";
import * as auth from "./accessControlApi.js";
import { computeTurnSchedule, actingWindowSeconds, actingSafetyCapSeconds } from "./turnSchedule.js";

// ---------------------------------------------------------------------------
// useTurnTimer — for multiplayer games with a per-room turn timer set.
// THREE-PHASE MODEL (mrx -> planning -> acting), replacing the old
// per-seat sequential walk:
//   - 'mrx': Mr.X's own turn -- single actor. On expiry (v3.25) he now
//     STAYS PUT and forfeits one ticket, via force_end_mrx_turn, instead
//     of being auto-relocated by a random legal move as in v3.24 and
//     earlier. Same server-side implementation as his voluntary
//     "Stay Here" action, so the two can't drift apart.
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
// IMPORTANT ARCHITECTURAL NOTE: the server has NO independent knowledge
// of the map's graph. As of v3.25 that no longer matters for ANY of the
// three timeout paths -- none of them needs to pick a destination
// anymore (Mr.X stays put; detectives stay put), so all three are plain
// server-side state transitions. Every one of the three RPCs involved
// (force_end_mrx_turn, begin_acting_phase, force_end_acting_phase) is
// explicitly written as an idempotent no-op if the phase has already
// moved on, so it is safe that EVERY connected client fires them the
// moment it sees the same expiry.
// ---------------------------------------------------------------------------
export function useTurnTimer({
  roomId,
  myPlayerId,
  myPlayerSecret,
  map,
  match,
  // maxDetectivesForAnyOnePlayer -- how many detectives the BUSIEST
  // single player in this room controls. As of v3.27 this sizes ONLY the
  // round's outer safety cap, not anybody's actual clock.
  maxDetectivesForAnyOnePlayer = 1,
  // myDetectiveCount (v3.27) -- how many detectives THIS client controls.
  // Sizes this client's OWN acting pool, which is the number their timer
  // bar shows and the only thing that drives their own detectives'
  // timeout forfeits. Mr.X and spectators pass 0/1 and simply watch the
  // safety cap instead (they have no pool of their own to run out).
  myDetectiveCount = 0,
  // onForceEndMrxTurn (v3.25) -- fired when MR.X's own window expires.
  // See submitMrxTimeout below: he stays put and forfeits a ticket,
  // rather than being teleported by a random auto-move as before.
  onForceEndMrxTurn,
  onBeginActingPhase,
  // onExpireActingPools (v3.27) -- fired once this client's OWN acting
  // pool runs out. Calls the server-side sweep, which authoritatively
  // re-derives EVERY player's pool itself and forfeits a ticket for each
  // outstanding detective of each player whose pool has genuinely
  // elapsed. It deliberately takes no target: a client cannot expire
  // anyone (including itself) early by calling it, so it is safe for any
  // client to fire, which is what covers a player who has dropped.
  onExpireActingPools,
  // onForceEndActingPhase -- now ONLY the outer safety-cap backstop.
  onForceEndActingPhase,
}) {
  const [actSeconds, setActSeconds] = useState(null);
  const [extraDetectiveSeconds, setExtraDetectiveSeconds] = useState(null);
  // (v3.24: rooms.detective_cap_seconds is no longer read at all. The
  // per-detective hard cap it powered -- a sub-clock that auto-passed a
  // detective when IT expired -- is gone. There is now exactly ONE clock
  // in the acting phase: the pooled per-round window, sized as before
  // off the busiest player's detective count via extra_detective_seconds.
  // A player's spotlight advances only when they actually move or pass;
  // if the pool runs out with detectives unmoved, those detectives stay
  // put and forfeit one ticket each, applied authoritatively server-side
  // in force_end_acting_phase. The DB column and the host-facing field
  // are left in place rather than ripped out, so no room's stored
  // settings become invalid -- the value is simply inert now.)
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

  // MY OWN pool (v3.27) -- base act time plus the configured top-up for
  // each detective beyond the first that I PERSONALLY control. This is
  // the number my timer bar counts down, and its expiry forfeits only my
  // own outstanding detectives' tickets.
  const myActingPoolSeconds = useMemo(
    () => (myDetectiveCount > 0 ? actingWindowSeconds(schedule, myDetectiveCount) : null),
    [schedule, myDetectiveCount]
  );

  // The round's outer safety cap, sized off the busiest player. Shown as
  // the muted "round ends in…" line and used for the last-resort
  // force-end call; it no longer drives anyone's ticket forfeits.
  const actingSafetyCapTotalSeconds = useMemo(
    () => actingSafetyCapSeconds(schedule, maxDetectivesForAnyOnePlayer),
    [schedule, maxDetectivesForAnyOnePlayer]
  );

  // What the PROMINENT bar counts down during the acting phase: my own
  // pool if I have one, otherwise (Mr.X, spectators) the safety cap,
  // since they have nothing of their own running out.
  const actingTotalSeconds = myActingPoolSeconds ?? actingSafetyCapTotalSeconds;

  const [safetyCapRemaining, setSafetyCapRemaining] = useState(null);
  // Separate guard for the safety cap: it fires at a DIFFERENT moment
  // from my own pool, so sharing one guard key would let whichever fired
  // first permanently suppress the other.
  const capAttemptedForRef = useRef(null);

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
    if (capAttemptedForRef.current !== guardKey) {
      capAttemptedForRef.current = null;
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
        tryExpire(remaining, submitMrxTimeout);
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

        // TWO INDEPENDENT DEADLINES (v3.27), each with its own guard.
        //
        //  1. MY OWN pool. Expiring calls the per-player sweep, which
        //     forfeits a ticket for each of MY still-unmoved detectives
        //     and leaves every other player's alone. It's fine (and
        //     useful) that other clients fire this at their own moments
        //     too: the server re-derives everyone's pool itself, so each
        //     call simply sweeps whoever is genuinely overdue right then.
        //     That redundancy is exactly what covers a dropped player.
        //  2. The SAFETY CAP. Sized off the busiest player, so it always
        //     lands at or after every individual pool. Only a backstop:
        //     by the time it fires the per-player sweep should already
        //     have resolved everyone, and force_end_acting_phase itself
        //     re-checks the cap server-side before doing anything.
        if (myActingPoolSeconds) {
          const myRemaining = Math.max(0, Math.ceil(myActingPoolSeconds - elapsed));
          tryExpire(myRemaining, submitExpireActingPools);
        }

        if (actingSafetyCapTotalSeconds) {
          const capRemaining = Math.max(0, Math.ceil(actingSafetyCapTotalSeconds - elapsed));
          setSafetyCapRemaining(capRemaining);
          if (capRemaining <= 0 && capAttemptedForRef.current !== guardKey && match.phase === "playing") {
            capAttemptedForRef.current = guardKey;
            submitForceEndActingPhase();
          }
        } else {
          setSafetyCapRemaining(null);
        }
        return;
      }

      setSafetyCapRemaining(null);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    schedule,
    actingTotalSeconds,
    myActingPoolSeconds,
    actingSafetyCapTotalSeconds,
    match?.roundPhase,
    match?.turnStartedAt,
    match?.detectivePhaseStartedAt,
    match?.actingPhaseStartedAt,
    match?.phase,
  ]);

  // submitMrxTimeout (v3.25) -- REPLACES the old submitRandomMrxMove.
  //
  // Mr.X's timer expiring no longer relocates him to a random legal
  // station. He now simply STAYS WHERE HE IS, forfeits one ticket of his
  // cheapest held type, and the round is recorded openly in the travel
  // log as a non-move. Rationale (an explicit design decision, not a
  // bug): a random teleport was both arbitrary and silently
  // indistinguishable from a chosen move, whereas standing still is
  // exactly what a real fugitive who fails to act does -- and the fact
  // that he stood still is legitimately informative to his pursuers.
  //
  // This calls the SAME server-side implementation as Mr.X's voluntary
  // "Stay Here" action (mrx_stay_here and force_end_mrx_turn both run
  // mrx_stay_internal), so the two paths cannot diverge in ticket cost
  // or logging. It also means the timeout no longer needs any map/graph
  // knowledge on the client at all -- unlike the old random-move
  // fallback, which had to compute legal moves locally.
  //
  // Any connected client may fire it (Mr.X himself is often the one who
  // has dropped); it's an idempotent server-side no-op once his turn has
  // already ended, exactly like the acting-phase timeout handler.
  function submitMrxTimeout() {
    if (onForceEndMrxTurn) onForceEndMrxTurn();
  }

  function submitBeginActingPhase() {
    if (onBeginActingPhase) onBeginActingPhase();
  }

  function submitExpireActingPools() {
    if (onExpireActingPools) onExpireActingPools();
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
    // actSeconds is the denominator for the PROMINENT bar: as of v3.27
    // that's THIS client's OWN acting pool (sized off their own detective
    // count), falling back to the safety cap for Mr.X/spectators who have
    // no pool of their own. The unscaled base is still available
    // separately as baseActSeconds.
    actSeconds: actingTotalSeconds ?? null,
    // The outer safety cap, exposed separately so GameBoard can render
    // the muted "round ends in…" line without it ever being mistaken for
    // (or reused as) the player's own countdown.
    safetyCapSeconds: actingSafetyCapTotalSeconds ?? null,
    safetyCapRemaining,
    baseActSeconds: schedule?.actSeconds ?? null,
    extraSeatSeconds: schedule?.extraSeatSeconds ?? null,
  };
}
