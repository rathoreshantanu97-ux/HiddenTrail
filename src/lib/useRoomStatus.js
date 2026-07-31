import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient.js";
import { fetchRoom } from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useRoomStatus — subscribes to a room's `status` column via Supabase
// Realtime (rooms is already in the realtime publication, see schema.sql).
//
// This replaces what used to be a bug: `mpStage` in App.jsx was local
// React state that only the HOST's own click (handleStartMultiplayerGame)
// ever changed, so a detective's browser had no way to learn the game had
// started -- they'd sit on the lobby screen forever, since Supabase
// itself was updated (the room's `status` flipped to 'playing') but
// nothing on their end was watching for that.
//
// Every client -- host or not -- now derives "has the game started" from
// the actual database row, kept live via this subscription, instead of
// from a flag only one browser ever sets.
// ---------------------------------------------------------------------------
export function useRoomStatus(roomId) {
  const [status, setStatus] = useState(null); // "lobby" | "playing" | "ended" | null (not loaded yet)
  const [roomNotFound, setRoomNotFound] = useState(false);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const room = await fetchRoom(roomId);
      if (!room) {
        // fetchRoom resolved successfully and confirmed no such row exists
        // -- this is a genuine "room not found", not a network issue.
        setRoomNotFound(true);
        return;
      }
      setStatus(room.status);
    } catch (e) {
      // A thrown error here means the FETCH ITSELF failed (network
      // hiccup, momentary Supabase reconnect, etc) -- NOT that the room
      // doesn't exist. Treating any error as "room not found" was a real
      // bug: right after a page refresh, the very first fetch can
      // transiently fail before the connection settles, which would
      // incorrectly show "this room no longer exists" even though the
      // room is completely fine. Log it and leave `status`/`roomNotFound`
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
            setStatus(payload.new.status);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, refresh]);

  return { status, roomNotFound, refresh };
}
