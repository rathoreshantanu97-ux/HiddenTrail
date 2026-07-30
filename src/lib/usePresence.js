import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// usePresence — tracks which players are actually connected to a room via
// Supabase Realtime Presence (a websocket-based "who's here right now"
// channel, distinct from the game-state/chat polling used elsewhere in
// this app). This is the fast, event-driven signal for "did someone's
// connection just drop" -- typically detected within a few seconds of a
// tab closing, a crash, or a network loss, since it's the actual
// websocket connection dying, not an inferred timeout.
//
// GRACE PERIOD: a fast "disconnected" signal on its own would be too
// twitchy -- closing a laptop lid for a few seconds, or a brief wifi
// blip, would otherwise immediately show someone as "gone." So this hook
// doesn't report a player as inactive the instant Presence says they've
// left; it waits `gracePeriodSeconds` (admin-configurable, default 25s)
// after the drop before actually flagging them. If they reconnect within
// that window, nothing is ever shown to anyone else -- the flag never
// fires.
//
// MOBILE BACKGROUNDING: a backgrounded phone's websocket can sometimes
// stay technically alive even though the user isn't looking at the
// screen. This hook also listens for the page becoming hidden
// (document.visibilitychange) and, after a short delay in that state,
// explicitly untracks itself -- treating "backgrounded for a while" the
// same as "actually disconnected," rather than sitting in a false
// "still here" status indefinitely.
// ---------------------------------------------------------------------------
export function usePresence({ roomId, myPlayerId, myDisplayName, myRole, gracePeriodSeconds = 25 }) {
  const [onlinePlayerIds, setOnlinePlayerIds] = useState(new Set());
  // playerId -> timestamp (ms) when they were first observed as gone.
  // Used to compute the grace-period-adjusted "inactive" set below.
  const droppedAtRef = useRef(new Map());
  const [, forceTick] = useState(0); // re-render periodically so grace-period expiry gets reflected in UI
  const channelRef = useRef(null);
  const backgroundTimeoutRef = useRef(null);

  useEffect(() => {
    if (!supabase || !roomId || !myPlayerId) return;

    const channel = supabase.channel(`presence:${roomId}`, {
      config: { presence: { key: myPlayerId } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const nowOnline = new Set(Object.keys(state));
      setOnlinePlayerIds(nowOnline);
      for (const id of nowOnline) {
        droppedAtRef.current.delete(id);
      }
    });

    channel.on("presence", { event: "leave" }, ({ key }) => {
      if (!droppedAtRef.current.has(key)) {
        droppedAtRef.current.set(key, Date.now());
      }
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ displayName: myDisplayName, role: myRole });
      }
    });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, myPlayerId, myDisplayName, myRole]);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        backgroundTimeoutRef.current = setTimeout(() => {
          channelRef.current?.untrack();
        }, 8000);
      } else {
        if (backgroundTimeoutRef.current) {
          clearTimeout(backgroundTimeoutRef.current);
          backgroundTimeoutRef.current = null;
        }
        if (channelRef.current) {
          channelRef.current.track({ displayName: myDisplayName, role: myRole }).catch(() => {});
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (backgroundTimeoutRef.current) clearTimeout(backgroundTimeoutRef.current);
    };
  }, [myDisplayName, myRole]);

  const isInactive = useCallback(
    (playerId) => {
      if (onlinePlayerIds.has(playerId)) return false;
      const droppedAt = droppedAtRef.current.get(playerId);
      if (!droppedAt) return false;
      return Date.now() - droppedAt >= gracePeriodSeconds * 1000;
    },
    [onlinePlayerIds, gracePeriodSeconds]
  );

  return { onlinePlayerIds, isInactive };
}
