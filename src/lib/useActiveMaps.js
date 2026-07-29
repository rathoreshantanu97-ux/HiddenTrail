import { useState, useEffect } from "react";
import { MAP_LIST } from "../maps/index.js";
import { getInactiveMapIds } from "./accessControlApi.js";
import { isSupabaseConfigured } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// useActiveMaps — filters MAP_LIST down to maps the owner hasn't
// deactivated. Falls back to showing everything if Supabase isn't
// configured (dev mode) or the check fails for any reason -- deactivation
// is a nice-to-have admin control, not something that should ever make
// the map picker come up empty due to a network hiccup.
// ---------------------------------------------------------------------------
export function useActiveMaps() {
  const [activeMaps, setActiveMaps] = useState(MAP_LIST);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    getInactiveMapIds()
      .then((inactiveIds) => {
        const inactiveSet = new Set(inactiveIds);
        setActiveMaps(MAP_LIST.filter((m) => !inactiveSet.has(m.id)));
      })
      .catch((e) => {
        console.error("Failed to fetch active maps, showing all:", e);
        setActiveMaps(MAP_LIST);
      });
  }, []);

  return activeMaps;
}
