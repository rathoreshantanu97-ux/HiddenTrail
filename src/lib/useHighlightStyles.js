import { useState, useEffect } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useHighlightStyles — fetches BOTH independent highlight-style settings
// (position indicators vs destination/legal-move indicators) for a room,
// each resolving room-override -> admin-global -> hardcoded fallback.
// Replaces the old single useTurnHighlightStyle -- position and
// destination highlighting are now fully independent settings, per
// project design (each has its own admin default, overridability, and
// room-level override).
//
// Pass roomId=null for pass-and-play, where there's no room-level
// override concept -- always resolves to the admin's global default in
// that case (or the hardcoded fallback if Supabase isn't configured).
// ---------------------------------------------------------------------------
export function useHighlightStyles(roomId) {
  const [positionStyle, setPositionStyle] = useState("ring");
  const [destinationStyle, setDestinationStyle] = useState("rotating");

  useEffect(() => {
    let cancelled = false;
    api
      .getEffectivePositionHighlightStyle(roomId)
      .then((s) => {
        if (!cancelled) setPositionStyle(s);
      })
      .catch((e) => console.error("Failed to fetch position highlight style:", e));
    api
      .getEffectiveDestinationHighlightStyle(roomId)
      .then((s) => {
        if (!cancelled) setDestinationStyle(s);
      })
      .catch((e) => console.error("Failed to fetch destination highlight style:", e));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return { positionStyle, destinationStyle };
}
