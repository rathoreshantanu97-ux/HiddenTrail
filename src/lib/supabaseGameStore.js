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
export function useSupabaseGameStore({ roomId, myPlayerId, myRole }) {
  const [match, setMatch] = useState(null);
  const [error, setError] = useState(null);
  const myMrxPositionRef = useRef(null);

  const refreshMrxPosition = useCallback(async () => {
    if (myRole !== "mrx" || !roomId || !myPlayerId) return;
    try {
      const pos = await api.getMrxPosition({ roomId, callerPlayerId: myPlayerId });
      myMrxPositionRef.current = pos;
    } catch (e) {
      console.error("Failed to fetch Mr. X position:", e);
    }
  }, [roomId, myPlayerId, myRole]);

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
      api.heartbeat({ playerId: myPlayerId }).catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [myPlayerId]);

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

        await api.startGameRpc({
          roomId,
          callerPlayerId: myPlayerId,
          startPool: map.startPool,
          mrxStartingTickets: ticketCounts.mrx,
          detectiveStartingTickets: ticketCounts.detective,
          detectiveColors,
          maxRounds: roundsAndReveal?.totalRounds,
          revealRounds: roundsAndReveal?.revealRounds,
        });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, refreshMatch]
  );

  const submitDetectiveMove = useCallback(
    async (_map, detId, to, mode) => {
      if (!roomId || !myPlayerId) return;
      try {
        await api.makeDetectiveMove({ roomId, callerPlayerId: myPlayerId, detId, to, mode });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, refreshMatch]
  );

  const passTurn = useCallback(
    async (actor) => {
      if (!roomId || !myPlayerId) return;
      try {
        await api.passTurn({ roomId, callerPlayerId: myPlayerId, actor });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, refreshMatch]
  );

  const submitMrXMove = useCallback(
    async (_map, to, edgeMode, ticketUsed) => {
      if (!roomId || !myPlayerId) return;
      try {
        await api.makeMrxMove({ roomId, callerPlayerId: myPlayerId, to, edgeMode, ticketUsed });
        await refreshMatch();
      } catch (e) {
        setError(e.message);
        throw e;
      }
    },
    [roomId, myPlayerId, refreshMatch]
  );

  const activateDoubleMove = useCallback(async () => {
    if (!roomId || !myPlayerId) return;
    try {
      await api.activateDoubleMoveRpc({ roomId, callerPlayerId: myPlayerId });
      await refreshMatch();
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [roomId, myPlayerId, refreshMatch]);

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
    passTurn,
    beginTurnScreen,
    resetToSetup,
  };
}
