import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// useDelayedEndedTransition — holds back the transition to EndedScreen
// for a moment specifically when the game just ended via an actual
// capture (a detective moving onto Mr.X, or Mr.X moving onto a
// detective), so players get to SEE the collision effect on the board
// before being whisked to the results screen. Every other ending reason
// (round limit, vote-to-end, pause expiry, early end, no-takeover-
// volunteer) transitions immediately, same as before -- there's no
// "moment of capture" to show for those, so a pause would just feel like
// a delay for no reason.
//
// Returns `showEndedScreen`: false while the deliberate pause is active
// (caller should keep rendering the board, with the collision effect
// visible), true once it's safe to switch to EndedScreen.
// ---------------------------------------------------------------------------
const CAPTURE_PAUSE_MS = 1800;
const CAPTURE_LOG_KINDS = new Set(["detective_capture", "mrx_walked_into_detective"]);

export function useDelayedEndedTransition(match) {
  const [showEndedScreen, setShowEndedScreen] = useState(false);
  const handledRef = useRef(false); // guards against re-triggering the timer on every re-render while already ended

  useEffect(() => {
    if (!match || match.phase !== "ended") {
      setShowEndedScreen(false);
      handledRef.current = false;
      return;
    }
    if (handledRef.current) return; // already decided for this ended-state, don't restart the timer
    handledRef.current = true;

    const lastEntry = match.log[match.log.length - 1];
    const isCaptureEnding = lastEntry && CAPTURE_LOG_KINDS.has(lastEntry.kind);

    if (!isCaptureEnding) {
      setShowEndedScreen(true);
      return;
    }

    const timer = setTimeout(() => setShowEndedScreen(true), CAPTURE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [match]);

  return { showEndedScreen };
}
