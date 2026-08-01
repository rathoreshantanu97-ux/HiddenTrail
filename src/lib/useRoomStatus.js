import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient.js";
import { fetchRoom } from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useRoomStatus — subscribes to a room's FULL row via Supabase Realtime
// (rooms is already in the realtime publication, see schema.sql).
//
// This replaces what used to be a bug: `mpStage` in App.jsx was local
// React state that only the HOST's own click (handleStartMultiplayerGame)
// ever changed, so a detective's browser had no way to learn the game had
// started -- they'd sit on the lobby screen forever, since Supabase
// itself was updated (the room's `status` flipped to 'playing') but
// nothing on their end was watching for that.
//
// Every client -- host or not -- now derives "has the game started" AND
// every other room-level fact (who's host, which map, how many
// detectives, turn timer) from the actual database row, kept live via
// this subscription, instead of from flags only one browser ever sets.
// This is also the fix for two separate, confirmed real bugs: host
// reassignment (reassign_host) and room settings edits
// (update_room_settings) both correctly updated the SERVER, but no
// client except the one that made the call ever learned about it --
// every OTHER player's local state stayed stale until they manually
// left and rejoined. Now that the full row (not just `status`) is
// exposed live, App.jsx can derive host/map/detective-count/etc
// directly from `room`, the same way it already correctly derives
// `status`.
// ---------------------------------------------------------------------------
export function useRoomStatus(roomId) {
  const [room, setRoom] = useState(null); // the full room row, kept live
  const [roomNotFound, setRoomNotFound] = useState(false);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const fetched = await fetchRoom(roomId);
      if (!fetched) {
        // fetchRoom resolved successfully and confirmed no such row exists
        // -- this is a genuine "room not found", not a network issue.
        setRoomNotFound(true);
        return;
      }
      setRoom(fetched);
    } catch (e) {
      // A thrown error here means the FETCH ITSELF failed (network
      // hiccup, momentary Supabase reconnect, etc) -- NOT that the room
      // doesn't exist. Treating any error as "room not found" was a real
      // bug: right after a page refresh, the very first fetch can
      // transiently fail before the connection settles, which would
      // incorrectly show "this room no longer exists" even though the
      // room is completely fine. Log it and leave `room`/`roomNotFound`
      // untouched so the loading state persists and a retry can succeed,
      // rather than jumping to a false conclusion from one failed attempt.
      console.error("Failed to fetch room status (will retry, not treating as room-not-found):", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    refresh();

    const channel = supabase
      .channel(`room_status:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setRoomNotFound(true);
          } else {
            // payload.new is the raw Postgres row (snake_case columns),
            // NOT run through fetchRoom's own shape -- but fetchRoom
            // itself just returns the raw row directly (select("*")), so
            // this is already the same shape; no transformation needed.
            setRoom(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  return { status: room?.status ?? null, room, roomNotFound, refresh };
}
