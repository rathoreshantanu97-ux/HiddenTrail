import { useState, useCallback } from "react";
import * as E from "./gameEngine.js";

// ---------------------------------------------------------------------------
// LOCAL GAME STORE — same-device pass-and-play. See gameStoreInterface.js
// for the contract this implements. This is intentionally "dumb": it just
// holds one `match` object in React state and calls into gameEngine.js
// (the single source of truth for rules) on every action.
// ---------------------------------------------------------------------------
export function useLocalGameStore() {
  const [match, setMatch] = useState(null);

  const startGame = useCallback((map, { mapId, numDetectives }) => {
    setMatch(E.initMatch({ map, mapId, numDetectives }));
  }, []);

  const submitDetectiveMove = useCallback((map, detId, to, mode) => {
    setMatch((prev) => (prev ? E.applyDetectiveMove(map, prev, detId, to, mode) : prev));
  }, []);

  const submitMrXMove = useCallback((map, to, edgeMode, ticketUsed) => {
    setMatch((prev) => (prev ? E.applyMrXMove(map, prev, to, edgeMode, ticketUsed) : prev));
  }, []);

  const activateDoubleMove = useCallback(() => {
    setMatch((prev) => (prev ? E.applyActivateDoubleMove(prev) : prev));
  }, []);

  const beginTurnScreen = useCallback(() => {
    setMatch((prev) => (prev ? { ...prev, phase: "playing" } : prev));
  }, []);

  const resetToSetup = useCallback(() => {
    setMatch(null);
  }, []);

  return {
    match,
    myRole: null, // local mode: no role restriction, this device sees/controls everyone
    isMultiplayer: false,
    startGame,
    submitDetectiveMove,
    submitMrXMove,
    activateDoubleMove,
    beginTurnScreen,
    resetToSetup,
  };
}
