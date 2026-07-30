import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useTakeover — polls for an active takeover event in this room (same
// polling approach as chat/end-game-vote). Exposes the event plus every
// action a player might take depending on their role in the flow (host
// deciding, nominating, voting), plus flag/cancel used to drive the
// inactivity-detection side of things.
// ---------------------------------------------------------------------------
export function useTakeover({ roomId, myPlayerId }) {
  const [event, setEvent] = useState(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const e = await api.getActiveTakeoverEvent(roomId);
      setEvent(e);
    } catch (e) {
      console.error("Failed to fetch takeover event:", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [roomId, refresh]);

  const decide = useCallback(
    async (decision) => {
      if (!event) return;
      setErr("");
      try {
        await api.hostDecideTakeover({ roomId, callerPlayerId: myPlayerId, eventId: event.eventId, decision });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to record decision.");
        throw e;
      }
    },
    [roomId, myPlayerId, event, refresh]
  );

  const startTakeoverNow = useCallback(async () => {
    if (!event) return;
    setErr("");
    try {
      await api.startTakeoverFromWaiting({ roomId, callerPlayerId: myPlayerId, eventId: event.eventId });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to start takeover.");
      throw e;
    }
  }, [roomId, myPlayerId, event, refresh]);

  const nominate = useCallback(async () => {
    if (!event) return;
    setErr("");
    try {
      await api.nominateSelf({ roomId, callerPlayerId: myPlayerId, eventId: event.eventId });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to nominate yourself.");
      throw e;
    }
  }, [roomId, myPlayerId, event, refresh]);

  const vote = useCallback(
    async (nomineePlayerId) => {
      if (!event) return;
      setErr("");
      try {
        await api.voteTakeoverNominee({ roomId, callerPlayerId: myPlayerId, eventId: event.eventId, nomineePlayerId });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to submit your vote.");
        throw e;
      }
    },
    [roomId, myPlayerId, event, refresh]
  );

  const cancel = useCallback(async () => {
    if (!event) return;
    try {
      await api.cancelTakeoverEvent({ roomId, eventId: event.eventId });
      await refresh();
    } catch (e) {
      console.error("Failed to cancel takeover event:", e);
    }
  }, [roomId, event, refresh]);

  const flag = useCallback(
    async (targetRole) => {
      try {
        await api.flagInactivePlayer({ roomId, targetRole });
        await refresh();
      } catch (e) {
        console.error("Failed to flag inactive player:", e);
      }
    },
    [roomId, refresh]
  );

  const iHaveNominated = event ? event.nomineeIds.includes(myPlayerId) : false;

  return { event, err, decide, startTakeoverNow, nominate, vote, cancel, flag, iHaveNominated };
}
