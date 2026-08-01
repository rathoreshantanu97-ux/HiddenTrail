import { useState, useCallback, useEffect } from "react";
import * as E from "./gameEngine.js";

const LOCAL_MATCH_KEY = "scotlandyard_passandplay_match";

// ---------------------------------------------------------------------------
// LOCAL GAME STORE — same-device pass-and-play. See gameStoreInterface.js
// for the contract this implements. This is intentionally "dumb": it just
// holds one `match` object in React state and calls into gameEngine.js
// (the single source of truth for rules) on every action.
//
// Persistence: unlike multiplayer (which lives in Supabase and survives
// a refresh by design), pass-and-play previously lived ONLY in React
// state -- refreshing the page mid-game lost everything and bounced back
// to the landing screen with no way to resume. This now mirrors the
// match (plus which map it's using, needed to interpret it) to
// localStorage on every change, and restores it on mount, so a refresh
// during pass-and-play resumes exactly where you left off instead of
// silently discarding the game.
// ---------------------------------------------------------------------------
export function useLocalGameStore() {
  const [match, setMatchRaw] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_MATCH_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      return parsed.match || null;
    } catch {
      return null;
    }
  });

  // Wraps setMatch so every update also persists to localStorage,
  // without needing every call site below to remember to do it manually.
  const setMatch = useCallback((updater) => {
    setMatchRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        if (next) {
          localStorage.setItem(LOCAL_MATCH_KEY, JSON.stringify({ match: next }));
        } else {
          localStorage.removeItem(LOCAL_MATCH_KEY);
        }
      } catch (e) {
        console.error("Failed to persist pass-and-play match:", e);
      }
      return next;
    });
  }, []);

  const startGame = useCallback(
    (map, { mapId, numDetectives, roundScalingRatio }) => {
      setMatch(E.initMatch({ map, mapId, numDetectives, roundScalingRatio }));
    },
    [setMatch]
  );

  const submitDetectiveMove = useCallback(
    (map, detId, to, mode) => {
      setMatch((prev) => (prev ? E.applyDetectiveMove(map, prev, detId, to, mode) : prev));
    },
    [setMatch]
  );

  const submitMrXMove = useCallback(
    (map, to, edgeMode, ticketUsed) => {
      setMatch((prev) => (prev ? E.applyMrXMove(map, prev, to, edgeMode, ticketUsed) : prev));
    },
    [setMatch]
  );

  const activateDoubleMove = useCallback(() => {
    setMatch((prev) => (prev ? E.applyActivateDoubleMove(prev) : prev));
  }, [setMatch]);

  const endGameEarly = useCallback(() => {
    setMatch((prev) => (prev ? E.applyEndGameEarly(prev) : prev));
  }, [setMatch]);

  const beginTurnScreen = useCallback(() => {
    setMatch((prev) => (prev ? { ...prev, phase: "playing" } : prev));
  }, [setMatch]);

  const resetToSetup = useCallback(() => {
    setMatch(null);
  }, [setMatch]);

  return {
    match,
    myRole: null, // local mode: no role restriction, this device sees/controls everyone
    isMultiplayer: false,
    startGame,
    submitDetectiveMove,
    submitMrXMove,
    activateDoubleMove,
    endGameEarly,
    beginTurnScreen,
    resetToSetup,
  };
}
