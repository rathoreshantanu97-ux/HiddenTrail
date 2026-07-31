import { useState, useEffect } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useTurnHighlightStyle — fetches the effective highlight style ('ring'
// or 'blink') for a room, resolving room-override -> admin-global ->
// hardcoded 'ring' fallback. Pass roomId=null for pass-and-play, where
// there's no room-level override concept -- always resolves to the
// admin's global default in that case (or 'ring' if Supabase isn't
// configured at all).
// ---------------------------------------------------------------------------
export function useTurnHighlightStyle(roomId) {
  const [style, setStyle] = useState("ring");

  useEffect(() => {
    let cancelled = false;
    api
      .getEffectiveTurnHighlightStyle(roomId)
      .then((s) => {
        if (!cancelled) setStyle(s);
      })
      .catch((e) => console.error("Failed to fetch turn highlight style:", e));
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return style;
}
