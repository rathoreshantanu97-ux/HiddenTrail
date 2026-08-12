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
export function usePresence({ roomId, myPlayerId, myDisplayName, myRole, gracePeriodSeconds = 25, myToggledDetectiveIds = [], myPeekable = true, myStrokes = [], onRemoteStroke }) {
  const [onlinePlayerIds, setOnlinePlayerIds] = useState(new Set());
  // playerId -> their full tracked presence payload (displayName, role,
  // and now toggledDetectiveIds) -- exposed so consumers (like the "peek
  // into a player's screen" panel) can read what a teammate is CURRENTLY
  // looking at, not just whether they're online. "Currently" is enforced
  // by construction: a stale value can never linger here, since
  // re-tracking (see the effect below) always overwrites the whole
  // payload, and a teammate clearing their own toggles re-tracks with
  // toggledDetectiveIds: [], which immediately propagates via the same
  // "sync" event.
  const [presenceState, setPresenceState] = useState({});
  // playerId -> timestamp (ms) when they were first observed as gone.
  // Used to compute the grace-period-adjusted "inactive" set below.
  const droppedAtRef = useRef(new Map());
  const [, forceTick] = useState(0); // re-render periodically so grace-period expiry gets reflected in UI
  const channelRef = useRef(null);
  const backgroundTimeoutRef = useRef(null);
  // Ref holding the LATEST onRemoteStroke callback -- the broadcast
  // listener is attached once per channel (channel setup only re-runs on
  // room/player/role changes, not every render), but GameBoard passes a
  // fresh inline function each render, so the listener reads through this
  // ref rather than closing over a stale copy.
  const onRemoteStrokeRef = useRef(onRemoteStroke);
  onRemoteStrokeRef.current = onRemoteStroke;

  useEffect(() => {
    if (!supabase || !roomId || !myPlayerId) return;

    const channel = supabase.channel(`presence:${roomId}`, {
      config: { presence: { key: myPlayerId } },
    });
    channelRef.current = channel;

    // Peek-and-draw: a player peeking into MY screen can draw directly
    // onto it (see GameBoard.jsx) -- this arrives here as a targeted
    // broadcast event (NOT Presence state, since this is a one-off
    // action, not "current status" to keep syncing). Only apply it if
    // I'm actually the intended target -- broadcast is room-wide, not
    // point-to-point, so every client in the room receives every event.
    channel.on("broadcast", { event: "stroke" }, ({ payload }) => {
      if (payload?.targetPlayerId === myPlayerId && onRemoteStrokeRef.current) {
        onRemoteStrokeRef.current(payload);
      }
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const nowOnline = new Set(Object.keys(state));
      setOnlinePlayerIds(nowOnline);
      // presenceState() gives {key: [{...payload}]} -- Supabase Presence
      // allows multiple simultaneous "instances" per key in theory (e.g.
      // multiple tabs), but this app only ever tracks one payload per
      // player, so the first entry is always the right one to read.
      const flattened = {};
      for (const [key, entries] of Object.entries(state)) {
        flattened[key] = entries[0] || {};
      }
      setPresenceState(flattened);
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
        await channel.track({ displayName: myDisplayName, role: myRole, toggledDetectiveIds: myToggledDetectiveIds, peekable: myPeekable, strokes: myStrokes });
      }
    });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myPlayerId, myDisplayName, myRole]);

  // Re-track whenever OUR OWN explore mode changes, so teammates see it
  // update live -- this is a separate, lighter-weight effect from the
  // main channel-setup one above (which only re-runs on room/player/role
  // changes, not on every explore-mode click).
  useEffect(() => {
    if (!channelRef.current) return;
    channelRef.current.track({ displayName: myDisplayName, role: myRole, toggledDetectiveIds: myToggledDetectiveIds, peekable: myPeekable, strokes: myStrokes }).catch(() => {});
    // Depend on the SERIALIZED array/objects, not their references -- the
    // caller reasonably passes freshly-built arrays each render (e.g.
    // Array.from(aSet)), which would otherwise re-track on every render
    // even when nothing actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(myToggledDetectiveIds), myDisplayName, myRole, myPeekable, JSON.stringify(myStrokes)]);

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
          channelRef.current.track({ displayName: myDisplayName, role: myRole, toggledDetectiveIds: myToggledDetectiveIds, peekable: myPeekable }).catch(() => {});
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (backgroundTimeoutRef.current) clearTimeout(backgroundTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // sendRemoteStroke -- fire a one-off draw action at a SPECIFIC other
  // player (used while peeking their screen: your pen/eraser/undo
  // actions land on THEIR board, not yours). A plain broadcast, not
  // Presence state -- there's nothing to "currently be," it's a single
  // event the target applies once and moves on.
  const sendRemoteStroke = useCallback((targetPlayerId, action) => {
    if (!channelRef.current) return;
    channelRef.current.send({ type: "broadcast", event: "stroke", payload: { targetPlayerId, ...action } }).catch(() => {});
  }, []);

  return { onlinePlayerIds, presenceState, isInactive, sendRemoteStroke };
}
