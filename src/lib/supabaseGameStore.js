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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, refreshMatch]);

  useEffect(() => {
    if (!myPlayerId) return;
    const id = setInterval(() => {
      api.heartbeat({ playerId: myPlayerId, callerSecret: myPlayerSecret }).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
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
    forceEndActingPhase,
    beginTurnScreen,
    resetToSetup,
  };
}
