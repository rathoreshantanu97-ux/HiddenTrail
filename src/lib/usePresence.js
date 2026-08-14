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
//
// PEEK IS VIEW-ONLY AS OF v3.27. The "stroke" broadcast event -- a
// peeker drawing directly onto the board of the player they were peeking
// -- has been REMOVED entirely, along with its delivery-ledger/retry
// machinery. Four rounds of fixes (v3.21-v3.24) never made it reliable,
// and it was carrying most of the complexity in this file and in
// GameBoard's stroke state. What remains is a strictly smaller, one-way
// contract: a player publishes their own board state, and anyone peeking
// them renders it. Nothing outside a client can write to that client's
// strokes anymore, which removes the whole class of "whose copy is
// authoritative / did it arrive / can it be replayed" problems.
//
// NOTE: normal drawing on your OWN board is a SEPARATE feature
// (draw_enabled) and is completely unaffected by this.
//
// STROKES ARE NO LONGER CARRIED BY PRESENCE (v3.21). They used to ride
// along in the tracked payload above, which made a peeker's view of a
// peeked player's drawing depend on Presence's periodic, size-limited,
// silently-lossy state sync -- the single root cause of the long-running
// "my drawing never showed up for whoever was peeking me" bug (a payload
// over Presence's per-client limit is rejected outright, and a
// coalesced sync can drop an intermediate state entirely). Strokes now
// travel exclusively over explicit Realtime BROADCAST events on this
// same channel -- the identical mechanism peek-and-draw ("stroke") has
// always used successfully:
//   - "strokes_sync"    {senderPlayerId, strokes} -- pushed by a player
//                       every time their own stroke set changes. Anyone
//                       currently peeking that sender applies it directly.
//   - "strokes_request" {targetPlayerId, fromPlayerId} -- sent when a
//                       peek STARTS, so the peeker gets the current
//                       drawing immediately rather than waiting for the
//                       next change. The target answers with strokes_sync.
//   - "peek_off"        {senderPlayerId} -- pushed the instant a player
//                       turns their "let teammates peek" toggle off, so
//                       active peekers are released immediately instead
//                       of waiting on a Presence state diff (which proved
//                       unreliable in practice). The Presence-diff effect
//                       in GameBoard.jsx is kept as a backup, not the
//                       primary path.
// Presence itself still carries roster/online-status and the
// route-explorer toggles, which are small, idempotent, and genuinely
// "current state" rather than a stream of edits.
export function usePresence({
  roomId,
  myPlayerId,
  myDisplayName,
  myRole,
  gracePeriodSeconds = 25,
  // (v3.32: myToggledDetectiveIds, myPeekable, onStrokesSync,
  // onStrokesRequest, onPeekOff and onRevealSync are gone. Every one of
  // them existed to serve peeking and/or the shared drawing layer, both
  // of which were removed from the product. Presence is back to its
  // original, narrow job: who is in this room and are they online.)
}) {
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
  // (v3.32: the ref indirection for onStrokesSync / onStrokesRequest /
  // onPeekOff / onRevealSync is gone with those callbacks. No broadcast
  // callbacks are passed into this hook any more.)

  // (v3.32: the outbound send queue and sendOnChannel gate are gone --
  // they existed solely to make stroke/reveal broadcasts survive a
  // reconnect. This hook no longer broadcasts anything; Presence's own
  // join/leave/sync bookkeeping is handled by the Supabase client.)

  useEffect(() => {
    if (!supabase || !roomId || !myPlayerId) return;

    const channel = supabase.channel(`presence:${roomId}`, {
      config: {
        presence: { key: myPlayerId },
        // ack: true is the important one -- it makes channel.send()'s
        // promise resolve with the server's real acknowledgement instead
        // of resolving "ok" the moment the frame is handed to the
        // socket. Without it there is no way whatsoever for a client to
        // learn that a broadcast was dropped, which is precisely why
        // this bug survived two previous rounds of "fixes" that only
        // ever adjusted what happens AFTER a message arrives.
        // self: false keeps the existing semantics (a sender does not
        // receive its own broadcast; the peeker's optimistic local echo
        // covers that case).
        broadcast: { ack: true, self: false },
      },
    });
    channelRef.current = channel;

    // (v3.32: the strokes_sync / strokes_request / peek_off /
    // reveal_sync broadcast listeners lived here. All four are gone with
    // the peek and drawing features they existed for. Nothing is
    // broadcast on this channel any more beyond Presence's own
    // join/leave/sync bookkeeping.)


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
        await channel.track({ displayName: myDisplayName, role: myRole });
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
    // Errors here are still logged rather than swallowed. With strokes
    // no longer riding along (they broadcast separately now -- see the
    // header comment), this payload is small and bounded, so a
    // size-limit rejection is no longer a realistic failure mode.
    channelRef.current.track({ displayName: myDisplayName, role: myRole }).catch((e) => console.error("Presence track failed:", e));
    // Depend on the SERIALIZED array/objects, not their references -- the
    // caller reasonably passes freshly-built arrays each render (e.g.
    // Array.from(aSet)), which would otherwise re-track on every render
    // even when nothing actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDisplayName, myRole]);

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

  // (v3.27: sendRemoteStroke -- "draw onto the board of the player I'm
  // peeking" -- was removed with peek-and-draw. Peeking is view-only, so
  // there is no outbound path from a peeker to another player's board.)

  return { onlinePlayerIds, presenceState, isInactive };
}
