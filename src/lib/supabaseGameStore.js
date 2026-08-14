import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient.js";
import * as api from "./supabaseApi.js";
import { rowToMatch } from "./matchStateAdapter.js";
import { DETECTIVE_COLORS, TICKET_STARTS } from "./gameEngine.js";
import { computeRoundsAndRevealSchedule } from "../maps/mapSchema.js";

// ---------------------------------------------------------------------------
// SUPABASE GAME STORE — online multiplayer. Implements the same interface
// as localGameStore.js (see gameStoreInterface.js for the contract) so
// App.jsx doesn't need to know which one it's using.
//
// How state flows in:
//   - game_state_public row changes -> pushed live via Supabase Realtime
//     (a Postgres Changes subscription), no polling needed.
//   - Mr. X's own position -> fetched via the get_mrx_position RPC
//     whenever game_state_public changes (piggybacking on the same
//     trigger), since it can't be part of the realtime-subscribed table.
//   - Chat -> polled every 2.5s while the chat panel is mounted (see the
//     schema.sql note on why messages isn't a realtime table).
//
// `roomId` and `myPlayerId` are supplied by the room create/join flow
// (App.jsx passes them in once the player has created or joined a room).
// ---------------------------------------------------------------------------
export function useSupabaseGameStore({ roomId, myPlayerId, myPlayerSecret, myRole }) {
  const [match, setMatch] = useState(null);
  const [error, setError] = useState(null);
  const myMrxPositionRef = useRef(null);
  // Declared up here, above every consumer, because the realtime
  // subscription effect below calls into it (heartbeat leg 4 -- see the
  // long note on the heartbeat effect) and reads better without a
  // forward reference.
  const beatRef = useRef({ last: 0, fn: null });

  const refreshMrxPosition = useCallback(async () => {
    if (myRole !== "mrx" || !roomId || !myPlayerId) return;
    try {
      const pos = await api.getMrxPosition({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      myMrxPositionRef.current = pos;
    } catch (e) {
      console.error("Failed to fetch Mr. X position:", e);
    }
  }, [roomId, myPlayerId, myPlayerSecret, myRole]);

  const refreshMatch = useCallback(async () => {
    if (!roomId) return;
    try {
      const gsRow = await api.fetchGameStatePublic(roomId);
      if (!gsRow) {
        setMatch(null);
        return;
      }
      await refreshMrxPosition();
      setMatch(rowToMatch(gsRow, myMrxPositionRef.current));
    } catch (e) {
      setError(e.message);
    }
  }, [roomId, refreshMrxPosition]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    refreshMatch();

    const channel = supabase
      .channel(`game_state_public:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_state_public", filter: `room_id=eq.${roomId}` },
        () => {
          refreshMatch();
          // Heartbeat leg 4: websocket delivery is not subject to the
          // background-tab timer throttling that can stall the interval,
          // so piggy-backing on inbound realtime traffic keeps a hidden
          // tab's last_seen_at fresh in any game where anything is
          // actually happening. Rate-limited inside beatIfStale, so this
          // adds no write load on a busy room.
          beatRef.current.fn?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, refreshMatch]);

  // HEARTBEAT -- keeps players.last_seen_at fresh. This is not just a
  // presence nicety: it is the SERVER's definition of "currently
  // connected", and therefore the denominator of the unanimous
  // ready-to-act vote in set_planning_ready (a player the server thinks
  // has dropped is excluded from the vote, deliberately, so a dead client
  // can't block the round forever).
  //
  // v3.34: fire once IMMEDIATELY as well as on the interval. Previously
  // the first beat was only sent 15s after mount, so a player who had
  // just joined, refreshed, or reconnected could look stale to the server
  // for up to 15 seconds -- and the planning phase is exactly the window
  // in which a client makes no other RPC calls at all, so nothing else
  // was refreshing the timestamp either. During that gap the server's
  // connected set can be smaller than the real one, which makes a
  // too-small unanimity denominator possible.
  // v3.36 -- HARDENED AGAINST BACKGROUND-TAB TIMER THROTTLING.
  //
  // THE BUG. Every major browser throttles setInterval in a hidden tab.
  // Chrome's "intensive throttling" drops a background page's timers to
  // ONE WAKEUP PER MINUTE after it has been hidden ~5 minutes; Safari and
  // Firefox land in the same ballpark. A 15s interval is therefore not a
  // 15s interval -- once a player backgrounds the tab (checks a message,
  // switches windows on a shared machine, which is exactly how this was
  // first reproduced) it can become a ~60s+ interval. Against a 60s
  // server grace period that is a coin flip, and losing the flip means
  // the server stops counting that player as connected, which shrinks the
  // unanimity DENOMINATOR in set_planning_ready and lets the acting phase
  // start on fewer ticks than there are real players.
  //
  // WHAT DOESN'T WORK, and why this isn't a one-liner:
  //   - a shorter interval: throttling collapses N ticks into one wakeup,
  //     so 5s and 15s behave identically once throttled;
  //   - requestAnimationFrame: not called AT ALL in a hidden tab -- worse;
  //   - a dedicated Web Worker: Chrome throttles timers in workers owned
  //     by a hidden page too, so it buys nothing for real complexity;
  //   - navigator.sendBeacon on hide: one-shot, doesn't keep you fresh.
  //
  // THE APPROACH -- many independent triggers into one rate-limited beat,
  // so no single throttled clock is load-bearing:
  //   1. an interval, now 10s, as the baseline while visible;
  //   2. visibilitychange in BOTH directions. Beating on the way OUT
  //      matters as much as on the way back: it starts the away window
  //      with a maximally fresh timestamp instead of an up-to-15s-stale
  //      one, which is pure free margin;
  //   3. focus / blur / pageshow / online -- pageshow covers restore from
  //      the bfcache (where timers were frozen outright), online covers a
  //      network blip that silently swallowed beats;
  //   4. realtime traffic. Any game_state_public change arriving over the
  //      websocket beats too. This is the strongest leg: websocket
  //      message delivery is NOT timer-throttled in background tabs, so
  //      in an active game it keeps a hidden tab fresh independently of
  //      any clock;
  //   5. real user input (pointerdown/keydown), which is both free and a
  //      definitive liveness signal.
  //
  // Every trigger funnels through beatIfStale, which does nothing if a
  // beat already went out inside MIN_BEAT_GAP_MS. So adding triggers does
  // not add RPC load -- the steady state is still ~one write per 10s per
  // player -- it only adds independent CHANCES to fire.
  //
  // Paired with the server side: the presence grace period goes 60s ->
  // 90s in the same release, so even the fully-throttled worst case (one
  // wakeup per minute, nothing else firing) stays inside the window.
  useEffect(() => {
    if (!myPlayerId) return;
    const MIN_BEAT_GAP_MS = 8000;
    let cancelled = false;
    const beatNow = () => {
      beatRef.current.last = Date.now();
      api.heartbeat({ playerId: myPlayerId, callerSecret: myPlayerSecret }).catch(() => {
        // A failed beat must not count as a beat -- otherwise a transient
        // network error is followed by a rate-limit-enforced silence.
        if (!cancelled) beatRef.current.last = 0;
      });
    };
    const beatIfStale = () => {
      if (cancelled) return;
      if (Date.now() - beatRef.current.last < MIN_BEAT_GAP_MS) return;
      beatNow();
    };
    beatRef.current.fn = beatIfStale;

    beatNow();
    const id = setInterval(beatIfStale, 10000);
    const onVisibility = () => beatIfStale(); // both directions, deliberately
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", beatIfStale);
    window.addEventListener("blur", beatIfStale);
    window.addEventListener("pageshow", beatIfStale);
    window.addEventListener("online", beatIfStale);
    window.addEventListener("pointerdown", beatIfStale, { passive: true });
    window.addEventListener("keydown", beatIfStale, { passive: true });

    return () => {
      cancelled = true;
      beatRef.current.fn = null;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", beatIfStale);
      window.removeEventListener("blur", beatIfStale);
      window.removeEventListener("pageshow", beatIfStale);
      window.removeEventListener("online", beatIfStale);
      window.removeEventListener("pointerdown", beatIfStale);
      window.removeEventListener("keydown", beatIfStale);
    };
  }, [myPlayerId, myPlayerSecret]);

  const startGame = useCallback(
    async (map) => {
      if (!roomId || !myPlayerId) return;
      try {
        // Ticket counts computed per-map from actual graph connectivity
        // (see computeTicketCounts in mapSchema.js), not fixed values --
        // same reasoning as pass-and-play's initMatch(), kept consistent
        // between both modes.
        const ticketCounts = map.ticketCounts || TICKET_STARTS;

        // Round/reveal schedule: recompute LIVE using the room's actual
        // STORED round_scaling_ratio_override (set by the host at room
        // creation, via CreateRoomForm's Shorter/Standard/Longer choice)
        // rather than always using the map's static default (ratio=1.0).
        // This is the actual fix for the reported bug where choosing
        // "Shorter" at room creation had no effect on the real game --
        // the override was being saved correctly to the room, but never
        // actually READ again at game-start time.
        const room = await api.fetchRoom(roomId);
        const roundScalingRatio = room?.round_scaling_ratio_override;
        const roundsAndReveal =
          roundScalingRatio != null
            ? computeRoundsAndRevealSchedule(map.graph, Object.keys(map.stations).map(Number), roundScalingRatio)
            : map.roundsAndReveal;

        // Build the ACTUAL per-seat color array from the room's
        // seat_colors overrides (set via the lobby color picker), falling
        // back to the default DETECTIVE_COLORS[i] for any seat that never
        // picked one -- room.seat_colors is a jsonb object keyed by seat
        // index as a STRING (e.g. {"0": "#cb110b"}), same shape written
        // by set_seat_color. This is the one place those per-seat picks
        // actually get turned into the positional array start_game (the
        // SQL function) expects.
        const seatColorOverrides = room?.seat_colors || {};
        const detectiveColors = DETECTIVE_COLORS.map((defaultColor, i) => seatColorOverrides[String(i)] || defaultColor);

        // Same pattern for names -- only meaningful for maps that ship a
        // character roster (map.characterNames, e.g. Westeros); other
        // maps get `undefined`, which startGameRpc correctly omits
        // entirely rather than sending an empty/null array. room.num_detectives
        // (not map data) is the actual seat count for THIS room.
        const seatNameOverrides = room?.seat_names || {};
        const numDetectivesInRoom = room?.num_detectives || 0;
        const detectiveNames = map.characterNames
          ? Array.from({ length: numDetectivesInRoom }, (_, i) => seatNameOverrides[String(i)] || map.characterNames[i] || null)
          : undefined;

        await api.startGameRpc({
          roomId,
          callerPlayerId: myPlayerId,
          callerSecret: myPlayerSecret,
          startPool: map.startPool,
          mrxStartingTickets: ticketCounts.mrx,
          detectiveStartingTickets: ticketCounts.detective,
          detectiveColors,
          detectiveNames,
          maxRounds: roundsAndReveal?.totalRounds,
          revealRounds: roundsAndReveal?.revealRounds,
        });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, myPlayerSecret, refreshMatch]
  );

  const submitDetectiveMove = useCallback(
    async (_map, detId, to, mode) => {
      if (!roomId || !myPlayerId) return;
      try {
        await api.makeDetectiveMove({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret, detId, to, mode });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, myPlayerSecret, refreshMatch]
  );

  // passMrxTurn -- mrx-only (see supabaseApi.js's own comment). Used for
  // both the manual "Pass Turn" button (Mr.X side) and useTurnTimer's
  // auto-fallback when Mr.X genuinely has zero legal moves left.
  const passMrxTurn = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.passMrxTurn({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      await refreshMatch();
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  // mrxStayHere (v3.25) -- Mr.X's VOLUNTARY "stay put" action, taken
  // from the move-confirmation overlay by clicking his own station.
  // Errors ARE surfaced here (unlike the timeout counterpart below):
  // this is a deliberate click, so a failure is something the player
  // needs to see rather than a benign race.
  // v3.26: ticketMode is the type the player picked to forfeit; null =>
  // let the server take the cheapest held one.
  const mrxStayHere = useCallback(async (ticketMode = null) => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.mrxStayHere({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret, ticketMode });
      await refreshMatch();
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  // forceEndMrxTurn (v3.25) -- the timer-expiry path for Mr.X's turn.
  // Every connected client's timer fires this, so it races routinely and
  // is a server-side no-op after the first one lands; errors are logged,
  // not surfaced, exactly like beginActingPhase/forceEndActingPhase.
  const forceEndMrxTurn = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.forceEndMrxTurn({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      await refreshMatch();
    } catch (e) {
      console.error("forceEndMrxTurn failed:", e);
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  // passDetectiveTurn -- a detective marks themselves done for this
  // round's acting phase without moving (zero legal moves, or simply
  // choosing not to act). v3.26: this costs a ticket now, just like
  // Mr.X's stay -- ticketMode is the player's chosen type when they used
  // the Stay Here popup, or null for the automatic no-legal-moves pass
  // (cheapest held type, server-side).
  const passDetectiveTurn = useCallback(
    async (detId, ticketMode = null) => {
      if (!roomId || !myPlayerId) return;
      try {
        await api.passDetectiveTurn({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret, detId, ticketMode });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, myPlayerSecret, refreshMatch]
  );

  const submitMrXMove = useCallback(
    async (_map, to, edgeMode, ticketUsed) => {
      if (!roomId || !myPlayerId) return;
      try {
        await api.makeMrxMove({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret, to, edgeMode, ticketUsed });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, myPlayerSecret, refreshMatch]
  );

  const activateDoubleMove = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.activateDoubleMoveRpc({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      await refreshMatch();
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  const beginActingPhase = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.beginActingPhase({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      await refreshMatch();
    } catch (e) {
      // Deliberately not surfaced via setError -- this races benignly
      // (e.g. two ready detectives both trigger it, or the planning
      // window already ended naturally a moment earlier) and isn't worth
      // showing the player an error banner for a no-op.
      console.error("beginActingPhase failed:", e);
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  // setPlanningReady -- see supabaseApi.js. Errors ARE swallowed to a
  // console log here for the same reason as beginActingPhase: the common
  // failure is a benign race (the planning window ended between render
  // and click), which is a no-op server-side, not something to alarm the
  // player about.
  const setPlanningReady = useCallback(
    async (ready) => {
      if (!roomId || !myPlayerId) return null;
      try {
        const res = await api.setPlanningReady({ roomId, playerId: myPlayerId, callerSecret: myPlayerSecret, ready });
        await refreshMatch();
        return res;
      } catch (e) {
        console.error("setPlanningReady failed:", e);
        return null;
      }
    },
    [roomId, myPlayerId, myPlayerSecret, refreshMatch]
  );

  // expireActingPools (v3.27) -- fired when THIS client's own acting pool
  // runs out. Untargeted and fully server-authoritative (see the API
  // comment), so it is both safe to call from anywhere and safe for
  // several clients to call at once.
  const expireActingPools = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.expireActingPools({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      await refreshMatch();
    } catch (e) {
      // Same reasoning as beginActingPhase -- benign races, not worth an error banner.
      console.error("expireActingPools failed:", e);
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  const forceEndActingPhase = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.forceEndActingPhase({ roomId, callerPlayerId: myPlayerId, callerSecret: myPlayerSecret });
      await refreshMatch();
    } catch (e) {
      // Same reasoning as beginActingPhase -- benign races, not worth an error banner.
      console.error("forceEndActingPhase failed:", e);
    }
  }, [roomId, myPlayerId, myPlayerSecret, refreshMatch]);

  // No-op: online multiplayer has no "pass the device" handoff screen --
  // each player has their own device, so there's no local phase
  // transition to trigger the way localGameStore's beginTurnScreen() does.
  const beginTurnScreen = useCallback(() => {}, []);

  const resetToSetup = useCallback(() => {
    setMatch(null);
  }, []);

  return {
    match,
    myRole,
    isMultiplayer: true,
    error,
    startGame,
    submitDetectiveMove,
    submitMrXMove,
    activateDoubleMove,
    passMrxTurn,
    mrxStayHere,
    forceEndMrxTurn,
    passDetectiveTurn,
    beginActingPhase,
    setPlanningReady,
    expireActingPools,
    forceEndActingPhase,
    beginTurnScreen,
    resetToSetup,
  };
}
