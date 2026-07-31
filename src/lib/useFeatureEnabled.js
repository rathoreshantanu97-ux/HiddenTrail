import { useState, useEffect } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useFeatureEnabled — checks whether a named feature toggle is currently
// enabled for a room (room override -> admin global -> enabled-by-default
// fallback). Pass roomId=null for pass-and-play, where only the admin's
// global default applies (no per-room override concept there).
// ---------------------------------------------------------------------------
export function useFeatureEnabled(featureName, roomId) {
  const [enabled, setEnabled] = useState(true); // default to enabled while loading, rather than hiding a feature during the brief fetch window

  useEffect(() => {
    let cancelled = false;
    api
      .isFeatureEnabled({ featureName, roomId })
      .then((v) => {
        if (!cancelled) setEnabled(v);
      })
      .catch((e) => console.error(`Failed to check feature "${featureName}":`, e));
    return () => {
      cancelled = true;
    };
  }, [featureName, roomId]);

  return enabled;
}
