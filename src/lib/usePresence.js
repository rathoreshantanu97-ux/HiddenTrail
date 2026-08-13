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
  myToggledDetectiveIds = [],
  myPeekable = true,
  onRemoteStroke,
  // onPeerStroke (v3.22) -- fires for a "stroke" broadcast aimed at
  // SOMEONE ELSE. Needed for multi-peeker concurrent drawing: if three
  // players are all peeking player P and one of them draws on P's board,
  // the other two must see that mark immediately, not only after P's own
  // client has committed it and echoed a strokes_sync back. Without this,
  // every peek-drawn mark was invisible to every peeker except the one
  // whose hand drew it (and even for them only until pointerup, since the
  // in-progress preview is all they had). The owner's strokes_sync is
  // still the authority -- this is a fast, optimistic, self-healing
  // overlay that the next snapshot overwrites wholesale.
  onPeerStroke,
  onStrokesSync,
  onStrokesRequest,
  onPeekOff,
  // onRevealSync (v3.24) -- a player pushing the set of detective ids
  // whose DESTINATIONS they currently have revealed on their own board.
  // Same shape of thing as strokes_sync: a full, idempotent snapshot,
  // pushed on every change, cached and mirrored by anyone peeking that
  // player. This used to ride along in the Presence payload
  // (toggledDetectiveIds) only -- which still happens, and is still what
  // seeds a peek that starts cold -- but Presence sync is coalescing and
  // silently lossy, so the LIVE "they just clicked a piece, show me what
  // they're seeing" path now goes over broadcast like everything else.
  onRevealSync,
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
  // Ref holding the LATEST onRemoteStroke callback -- the broadcast
  // listener is attached once per channel (channel setup only re-runs on
  // room/player/role changes, not every render), but GameBoard passes a
  // fresh inline function each render, so the listener reads through this
  // ref rather than closing over a stale copy.
  const onRemoteStrokeRef = useRef(onRemoteStroke);
  onRemoteStrokeRef.current = onRemoteStroke;
  const onPeerStrokeRef = useRef(onPeerStroke);
  onPeerStrokeRef.current = onPeerStroke;
  // Same ref-indirection reasoning as onRemoteStrokeRef above, for the
  // three new broadcast events (see the header comment).
  const onStrokesSyncRef = useRef(onStrokesSync);
  onStrokesSyncRef.current = onStrokesSync;
  const onStrokesRequestRef = useRef(onStrokesRequest);
  onStrokesRequestRef.current = onStrokesRequest;
  const onPeekOffRef = useRef(onPeekOff);
  onPeekOffRef.current = onPeekOff;
  const onRevealSyncRef = useRef(onRevealSync);
  onRevealSyncRef.current = onRevealSync;

  // -------------------------------------------------------------------
  // OUTBOUND SEND QUEUE (v3.24) -- THE actual fix for the long-running
  // "peek-and-draw vanishes" bug. See sendOnChannel below for the full
  // reasoning; in short, `channel.send()` silently does nothing useful
  // (it falls back to a REST call and resolves "error") whenever the
  // channel is not in the `joined` state, and NOTHING in this app ever
  // looked at that return value. Anything sent during a reconnect, a
  // channel rebuild, or the first moments after a tab wakes up was
  // dropped without a trace. Now it's queued and flushed on the next
  // successful SUBSCRIBED instead.
  // -------------------------------------------------------------------
  const outboxRef = useRef([]);
  const channelJoinedRef = useRef(false);

  const flushOutbox = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !channelJoinedRef.current) return;
    const pending = outboxRef.current;
    outboxRef.current = [];
    for (const msg of pending) {
      ch.send(msg).catch((e) => console.error("Realtime flush failed:", msg.event, e));
    }
  }, []);

  // sendOnChannel -- one gate every broadcast in this hook goes through.
  // Returns nothing; failures are queued for retry rather than thrown.
  const sendOnChannel = useCallback(
    (event, payload) => {
      const msg = { type: "broadcast", event, payload };
      const ch = channelRef.current;
      if (!ch || !channelJoinedRef.current) {
        // Bounded so a long disconnection can't grow without limit. The
        // messages that matter most here (strokes_sync, reveal_sync) are
        // full snapshots, so only the newest of each really matters --
        // dropping the oldest is exactly the right thing to lose.
        outboxRef.current.push(msg);
        if (outboxRef.current.length > 60) outboxRef.current.shift();
        return;
      }
      ch.send(msg)
        .then((res) => {
          // With broadcast ack enabled (see the channel config), this
          // resolves to the SERVER's answer, not just "we wrote to a
          // socket." Anything other than "ok" means the message did not
          // land -- previously invisible, now retried.
          if (res !== "ok") {
            console.warn("Realtime broadcast not acknowledged:", event, res);
            outboxRef.current.push(msg);
            if (outboxRef.current.length > 60) outboxRef.current.shift();
          }
        })
        .catch((e) => {
          console.error("Realtime broadcast failed:", event, e);
          outboxRef.current.push(msg);
          if (outboxRef.current.length > 60) outboxRef.current.shift();
        });
    },
    []
  );

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
    channelJoinedRef.current = false;

    // Peek-and-draw: a player peeking into MY screen can draw directly
    // onto it (see GameBoard.jsx) -- this arrives here as a targeted
    // broadcast event (NOT Presence state, since this is a one-off
    // action, not "current status" to keep syncing). Only apply it if
    // I'm actually the intended target -- broadcast is room-wide, not
    // point-to-point, so every client in the room receives every event.
    // v3.23 DELIVERY FIX. This used to be an if/ELSE on
    // `payload.targetPlayerId === myPlayerId`, using the `myPlayerId`
    // captured by THIS effect's closure. That made the peeked player's
    // own delivery (the `onRemoteStroke` branch) depend on a single
    // identity comparison made inside the hook, while every OTHER
    // client's delivery went down the always-true `else` branch -- which
    // is exactly the observed failure signature: a peeker's stroke
    // reached every other peeker but never the owner of the board.
    // Both callbacks now fire for every stroke event, unconditionally.
    // The consumer (GameBoard) does the routing itself, against its own
    // `myPlayerId` prop, and de-duplicates on `actionId` so a payload
    // arriving through both callbacks is only ever applied once (which
    // matters for the non-idempotent "undo"/"erase" actions).
    channel.on("broadcast", { event: "stroke" }, ({ payload }) => {
      if (!payload?.targetPlayerId) return;
      if (onRemoteStrokeRef.current) onRemoteStrokeRef.current(payload);
      if (onPeerStrokeRef.current) onPeerStrokeRef.current(payload);
    });

    // strokes_sync -- a player pushing their CURRENT full stroke set to
    // the room. Room-wide like every broadcast, so each client decides
    // for itself whether it cares (GameBoard only applies it when the
    // sender is the player it's actively peeking). Ignore our own echo.
    channel.on("broadcast", { event: "strokes_sync" }, ({ payload }) => {
      if (payload?.senderPlayerId && payload.senderPlayerId !== myPlayerId && onStrokesSyncRef.current) {
        onStrokesSyncRef.current(payload);
      }
    });

    // strokes_request -- someone just STARTED peeking me and wants my
    // current drawing right now, rather than waiting for my next edit.
    // Same v3.23 reasoning as the "stroke" handler above: the
    // "am I the target?" test is no longer made against this effect's
    // captured `myPlayerId`. The full payload is handed to the consumer,
    // which compares it against its own live player id and answers with
    // a strokes_sync only if it really is the target.
    channel.on("broadcast", { event: "strokes_request" }, ({ payload }) => {
      if (payload?.targetPlayerId && onStrokesRequestRef.current) {
        onStrokesRequestRef.current(payload);
      }
    });

    // peek_off -- a player revoked peek permission. Primary, immediate
    // release path for anyone currently peeking them.
    channel.on("broadcast", { event: "peek_off" }, ({ payload }) => {
      if (payload?.senderPlayerId && payload.senderPlayerId !== myPlayerId && onPeekOffRef.current) {
        onPeekOffRef.current(payload);
      }
    });

    // reveal_sync -- a player's current "whose destinations am I looking
    // at" set (v3.24). Room-wide; each client decides for itself whether
    // it cares. Ignore our own echo, same as strokes_sync.
    channel.on("broadcast", { event: "reveal_sync" }, ({ payload }) => {
      if (payload?.senderPlayerId && payload.senderPlayerId !== myPlayerId && onRevealSyncRef.current) {
        onRevealSyncRef.current(payload);
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
        channelJoinedRef.current = true;
        await channel.track({ displayName: myDisplayName, role: myRole, toggledDetectiveIds: myToggledDetectiveIds, peekable: myPeekable });
        // Anything that was attempted while the channel was down goes
        // out now, in order. This is what turns a reconnect from
        // "silently lost every message in that window" into "delivered
        // a moment late."
        flushOutbox();
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        channelJoinedRef.current = false;
      }
    });

    return () => {
      channelJoinedRef.current = false;
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
    channelRef.current.track({ displayName: myDisplayName, role: myRole, toggledDetectiveIds: myToggledDetectiveIds, peekable: myPeekable }).catch((e) => console.error("Presence track failed:", e));
    // Depend on the SERIALIZED array/objects, not their references -- the
    // caller reasonably passes freshly-built arrays each render (e.g.
    // Array.from(aSet)), which would otherwise re-track on every render
    // even when nothing actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(myToggledDetectiveIds), myDisplayName, myRole, myPeekable]);

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
  //
  // v3.24: routed through sendOnChannel, so a stroke drawn while the
  // channel happens to be re-joining is queued and delivered rather than
  // silently discarded. Re-sending the SAME payload (same actionId) is
  // always safe: every receiver de-duplicates on actionId, so even the
  // non-idempotent "undo"/"erase" actions can be retried freely.
  const sendRemoteStroke = useCallback(
    (targetPlayerId, action) => {
      sendOnChannel("stroke", { targetPlayerId, ...action });
    },
    [sendOnChannel]
  );

  // sendStrokesSync -- push MY current full stroke set to the room, so
  // any client peeking me re-renders it immediately. Full snapshot, not
  // a delta: idempotent, order-independent, and self-healing if any
  // single broadcast is ever missed.
  const sendStrokesSync = useCallback(
    (strokes) => {
      if (!myPlayerId) return;
      sendOnChannel("strokes_sync", { senderPlayerId: myPlayerId, strokes });
    },
    [myPlayerId, sendOnChannel]
  );

  // sendRevealSync -- push MY current "revealed destinations" detective
  // id set to the room (v3.24). Exactly the same contract as
  // sendStrokesSync: a full snapshot, cheap, idempotent, self-healing.
  const sendRevealSync = useCallback(
    (revealedDetectiveIds) => {
      if (!myPlayerId) return;
      sendOnChannel("reveal_sync", { senderPlayerId: myPlayerId, revealedDetectiveIds: revealedDetectiveIds || [] });
    },
    [myPlayerId, sendOnChannel]
  );

  // sendStrokesRequest -- ask a specific player to push me their current
  // strokes right now (sent the moment a peek starts).
  const sendStrokesRequest = useCallback(
    (targetPlayerId) => {
      if (!myPlayerId || !targetPlayerId) return;
      sendOnChannel("strokes_request", { targetPlayerId, fromPlayerId: myPlayerId });
    },
    [myPlayerId, sendOnChannel]
  );

  // sendPeekOff -- tell the room I've revoked peek permission, so active
  // peekers drop out of my board immediately.
  const sendPeekOff = useCallback(() => {
    if (!myPlayerId) return;
    sendOnChannel("peek_off", { senderPlayerId: myPlayerId });
  }, [myPlayerId, sendOnChannel]);

  return { onlinePlayerIds, presenceState, isInactive, sendRemoteStroke, sendStrokesSync, sendStrokesRequest, sendPeekOff, sendRevealSync };
}
