import { useState, useEffect } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useFeatureEnabled — checks whether a named feature toggle is currently
// enabled for a room (room override -> admin global -> enabled-by-default
// fallback). Pass roomId=null for pass-and-play, where only the admin's
// global default applies (no per-room override concept there).
//
// v3.30 -- THE "DISABLED FEATURE STILL SHOWS" FIX. This used to fetch the
// flag EXACTLY ONCE, on mount, and never again for the entire lifetime of
// the component. Every consumer of this hook (RedistributeRolesVote,
// PauseVote, EndGameVote, TakeoverReversalVote, and the draw/peek/route-
// explorer gates inside GameBoard) mounts once when the board mounts and
// then stays mounted for the whole game -- so an admin flipping a feature
// off in the admin panel had NO effect on any client that was already
// open. The reported symptom ("Redistribute roles still shows even though
// it's disabled") is exactly that: the gate was there and correct, the
// VALUE behind it was stale. Confirmed against the live database, where
// app_settings.redistribute_roles_enabled is false and
// is_feature_enabled('redistribute_roles_enabled', <room>) correctly
// returns false -- the server was never the problem.
//
// Fixed by re-checking on a slow interval and whenever the tab regains
// focus/visibility. The check is a single scalar RPC, so the cost is
// negligible, and the state is only ever written when the value actually
// CHANGES -- an unchanged poll causes no re-render at all.
// ---------------------------------------------------------------------------
const REFRESH_MS = 30000;

export function useFeatureEnabled(featureName, roomId) {
  const [enabled, setEnabled] = useState(true); // default to enabled while loading, rather than hiding a feature during the brief fetch window

  useEffect(() => {
    let cancelled = false;

    const check = () => {
      api
        .isFeatureEnabled({ featureName, roomId })
        .then((v) => {
          if (cancelled) return;
          // Functional update + equality check: an unchanged value must
          // not schedule a re-render, otherwise a 30s poll would force
          // the whole board to re-render forever for no reason.
          setEnabled((prev) => (prev === v ? prev : v));
        })
        .catch((e) => console.error(`Failed to check feature "${featureName}":`, e));
    };

    check();
    const timer = setInterval(check, REFRESH_MS);
    // Re-check immediately on focus too, so an admin who flips a toggle
    // and switches back to the game tab sees it apply at once rather
    // than up to 30 seconds later.
    const onFocus = () => {
      if (document.visibilityState !== "hidden") check();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [featureName, roomId]);

  return enabled;
}
