import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient.js";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// usePublicRooms — live-updating list of joinable public rooms for the
// room browser. Subscribes to BOTH `rooms` (a room's status/is_public
// flag changing, e.g. someone starts the game) and `players` (someone
// joining/leaving changes the fill count) via Supabase Realtime, since
// either kind of change can affect whether a room should still be
// visible. Re-fetches the full list on any relevant change rather than
// trying to patch individual rows client-side -- simpler and correct,
// and the list is small enough that a full re-fetch is cheap.
// ---------------------------------------------------------------------------
export function usePublicRooms() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.getPublicRooms();
      setRooms(list);
    } catch (e) {
      console.error("Failed to fetch public rooms:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!supabase) return;

    const channel = supabase
      .channel("public_rooms_browser")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { rooms, loading, refresh };
}
