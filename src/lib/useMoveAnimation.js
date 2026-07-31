import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// useMoveAnimation — detects when a detective's position actually changes
// between renders (a real move just happened, whether made by this
// client or synced in from another player's multiplayer move) and drives
// a short visual transition from the old station to the new one, rather
// than the token silently snapping. Works identically regardless of
// WHO made the move or WHICH client is watching -- it's purely a
// function of "did match.detectives[i].pos change since last render,"
// so it's naturally consistent across every player's screen without any
// extra network messages: the move itself (already synced via the
// existing game-state channel) is the only signal needed.
//
// Returns a map of detectiveId -> {fromPos, toPos, progress (0 to 1)} for
// every detective CURRENTLY mid-animation, so the renderer can draw an
// interpolated token position; a detective not in this map has finished
// animating (or never moved) and should just render at its normal
// static position.
// ---------------------------------------------------------------------------
const ANIMATION_DURATION_MS = 700;

export function useMoveAnimation(detectives) {
  const prevPositionsRef = useRef({}); // detectiveId -> last known pos
  const [animations, setAnimations] = useState({}); // detectiveId -> {fromPos, toPos, startTime}
  const [, forceTick] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const prev = prevPositionsRef.current;
    const newAnimations = {};
    let anyNew = false;

    for (const d of detectives) {
      const prevPos = prev[d.id];
      if (prevPos !== undefined && prevPos !== d.pos) {
        newAnimations[d.id] = { fromPos: prevPos, toPos: d.pos, startTime: Date.now() };
        anyNew = true;
      }
      prev[d.id] = d.pos;
    }

    if (anyNew) {
      setAnimations((existing) => ({ ...existing, ...newAnimations }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectives]);

  // Drive a render loop while any animation is in flight, so progress
  // updates smoothly -- stops itself once nothing's animating, rather
  // than running an interval unconditionally for the whole game.
  useEffect(() => {
    if (Object.keys(animations).length === 0) return;

    function tick() {
      const now = Date.now();
      let stillAnimating = false;
      setAnimations((existing) => {
        const next = {};
        for (const [id, anim] of Object.entries(existing)) {
          const elapsed = now - anim.startTime;
          if (elapsed < ANIMATION_DURATION_MS) {
            next[id] = anim;
            stillAnimating = true;
          }
          // else: drop it -- animation finished, detective renders at its normal static position again
        }
        return next;
      });
      forceTick((t) => t + 1);
      if (stillAnimating) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [animations]);

  const getProgress = (detectiveId) => {
    const anim = animations[detectiveId];
    if (!anim) return null;
    const elapsed = Date.now() - anim.startTime;
    const progress = Math.min(1, elapsed / ANIMATION_DURATION_MS);
    return { fromPos: anim.fromPos, toPos: anim.toPos, progress };
  };

  return { getProgress };
}
