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
export function useChat({ roomId, myPlayerId, mySecret, myRole }) {
  const [allMessages, setAllMessages] = useState([]);
  const [detectiveMessages, setDetectiveMessages] = useState([]);
  const lastAllRef = useRef("1970-01-01T00:00:00Z");
  const lastDetRef = useRef("1970-01-01T00:00:00Z");
  // Guards against a real race condition that was causing duplicate
  // messages: poll() reads lastAllRef/lastDetRef SYNCHRONOUSLY, then
  // awaits the network call -- during that await, JS is free to run
  // OTHER code, including a second concurrent poll() call (e.g. the
  // scheduled setInterval firing right as sendToAll's own explicit
  // .then(poll) call is also in flight, which happens often since
  // sending a message triggers an immediate poll on top of the regular
  // 2.5s interval). Both concurrent calls would read the SAME
  // not-yet-updated "after" timestamp, both fetch the SAME "new"
  // message, and both append it to state -- confirmed this is exactly
  // why it was specifically the SENDER who saw their own message appear
  // more than once (their send-triggered poll was the one most likely
  // to overlap with the interval's own poll). inFlightRef makes any
  // poll() call that starts while one is already running simply wait
  // for the in-progress one and return its result, rather than kicking
  // off a second, independently-racing fetch.
  const inFlightRef = useRef(null);

  const isDetective = myRole && myRole !== "mrx";

  const poll = useCallback(async () => {
    if (!roomId) return;
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async () => {
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
            callerSecret: mySecret,
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
    })();

    inFlightRef.current = run;
    try {
      await run;
    } finally {
      inFlightRef.current = null;
    }
  }, [roomId, myPlayerId, mySecret, isDetective]);


  useEffect(() => {
    if (!roomId) return;
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, [roomId, poll]);

  const sendToAll = useCallback(
    (body) => api.sendMessage({ roomId, callerPlayerId: myPlayerId, callerSecret: mySecret, channel: "all", body }).then(poll),
    [roomId, myPlayerId, mySecret, poll]
  );

  const sendToDetectives = useCallback(
    (body) =>
      api.sendMessage({ roomId, callerPlayerId: myPlayerId, callerSecret: mySecret, channel: "detectives", body }).then(poll),
    [roomId, myPlayerId, mySecret, poll]
  );

  return {
    allMessages,
    detectiveMessages,
    canUseDetectiveChannel: isDetective,
    sendToAll,
    sendToDetectives,
  };
}
