import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// CHAT HOOK — polls both channels every 2.5s (see schema.sql for why chat
// isn't realtime-pushed: avoiding a subtle RLS/Realtime interaction bug is
// worth a few seconds of chat latency for a first version).
//
// `myRole` determines whether the "detectives" channel is fetched at all —
// Mr. X's client never calls get_detective_messages, so there's no path
// where Mr. X's browser ever receives detectives-channel message bodies,
// on top of the server-side role check inside that RPC.
// ---------------------------------------------------------------------------
export function useChat({ roomId, myPlayerId, myRole }) {
  const [allMessages, setAllMessages] = useState([]);
  const [detectiveMessages, setDetectiveMessages] = useState([]);
  const lastAllRef = useRef("1970-01-01T00:00:00Z");
  const lastDetRef = useRef("1970-01-01T00:00:00Z");

  const isDetective = myRole && myRole !== "mrx";

  const poll = useCallback(async () => {
    if (!roomId) return;
    try {
      const newAll = await api.getAllChannelMessages({ roomId, after: lastAllRef.current });
      if (newAll.length) {
        setAllMessages((prev) => [...prev, ...newAll]);
        lastAllRef.current = newAll[newAll.length - 1].createdAt;
      }
    } catch (e) {
      console.error("chat poll (all) failed:", e);
    }

    if (isDetective) {
      try {
        const newDet = await api.getDetectiveMessages({
          roomId,
          callerPlayerId: myPlayerId,
          after: lastDetRef.current,
        });
        if (newDet.length) {
          setDetectiveMessages((prev) => [...prev, ...newDet]);
          lastDetRef.current = newDet[newDet.length - 1].createdAt;
        }
      } catch (e) {
        console.error("chat poll (detectives) failed:", e);
      }
    }
  }, [roomId, myPlayerId, isDetective]);

  useEffect(() => {
    if (!roomId) return;
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, [roomId, poll]);

  const sendToAll = useCallback(
    (body) => api.sendMessage({ roomId, callerPlayerId: myPlayerId, channel: "all", body }).then(poll),
    [roomId, myPlayerId, poll]
  );

  const sendToDetectives = useCallback(
    (body) => api.sendMessage({ roomId, callerPlayerId: myPlayerId, channel: "detectives", body }).then(poll),
    [roomId, myPlayerId, poll]
  );

  return {
    allMessages,
    detectiveMessages,
    canUseDetectiveChannel: isDetective,
    sendToAll,
    sendToDetectives,
  };
}
