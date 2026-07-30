import React, { useState, useEffect } from "react";
import { useActiveMaps } from "../lib/useActiveMaps.js";
import { DETECTIVE_COLORS } from "../lib/gameEngine.js";
import { styles } from "./GameBoard.jsx";

// ---------------------------------------------------------------------------
// SETUP SCREEN — map + detective-count picker, used by same-device
// pass-and-play. (Online multiplayer's equivalent choices happen in
// LandingScreen's CreateRoomForm instead, since the host picks these once
// for everyone rather than each device picking independently.)
// ---------------------------------------------------------------------------
export default function SetupScreen({ onStart, onBack }) {
  const MAP_LIST = useActiveMaps();
  // IMPORTANT: mapId must never default to a hardcoded string like "city"
  // -- if an owner deactivates that specific map, MAP_LIST.find() would
  // return undefined and crash the whole screen (this was a real bug).
  // Instead it starts null and snaps to the first available active map
  // once MAP_LIST loads/changes.
  const [mapId, setMapId] = useState(null);
  const [numDetectives, setNumDetectives] = useState(3);
  const [selectedDetectiveNames, setSelectedDetectiveNames] = useState(["", "", "", "", ""]);

  useEffect(() => {
    if (MAP_LIST.length === 0) return;
    // if there's no selection yet, OR the previously selected map is no
    // longer in the active list (e.g. it just got deactivated while this
    // screen was open), snap to the first available map instead of
    // silently pointing at something that no longer exists.
    if (!mapId || !MAP_LIST.some((m) => m.id === mapId)) {
      setMapId(MAP_LIST[0].id);
    }
  }, [MAP_LIST, mapId]);

  const map = MAP_LIST.find((m) => m.id === mapId);

  function swapDetectiveNameAt(slotIdx, newName) {
    setSelectedDetectiveNames((prev) => {
      const next = [...prev];
      const otherIdx = next.indexOf(newName);
      if (otherIdx !== -1 && otherIdx !== slotIdx) {
        next[otherIdx] = prev[slotIdx];
      }
      next[slotIdx] = newName;
      return next;
    });
  }

  // Guard against rendering before a map is ready (empty active-map list,
  // or the very first render before the useEffect above has run) --
  // shows a plain loading state instead of crashing on map.characterNames.
  if (!map) {
    return (
      <div style={styles.page}>
        <div style={styles.setupCard}>
          <h1 style={styles.title}>Scotland Yard</h1>
          <p style={styles.subtitle}>
            {MAP_LIST.length === 0 ? "No maps are currently available. Check back later." : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.setupCard}>
        <h1 style={styles.title}>Scotland Yard</h1>
        <p style={styles.subtitle}>Pass-and-play · hidden Mr. X · laptop-sized board</p>

        <label style={styles.label}>Map</label>
        <div style={styles.rowCenter}>
          {MAP_LIST.map((m) => (
            <button
              key={m.id}
              onClick={() => setMapId(m.id)}
              style={{ ...styles.mapPill, ...(mapId === m.id ? styles.mapPillActive : {}) }}
            >
              <div style={{ fontWeight: 700 }}>{m.label}</div>
              <div style={{ fontSize: 11, opacity: 0.75 }}>{m.subtitle}</div>
            </button>
          ))}
        </div>

        <label style={styles.label}>Number of detectives (2–5)</label>
        <div style={styles.rowCenter}>
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setNumDetectives(n)}
              style={{ ...styles.pill, ...(numDetectives === n ? styles.pillActive : {}) }}
            >
              {n}
            </button>
          ))}
        </div>

        {map.characterNames && (
          <>
            <label style={styles.label}>Choose your detectives</label>
            <div style={styles.characterPickerGrid}>
              {Array.from({ length: numDetectives }, (_, slotIdx) => (
                <div key={slotIdx} style={styles.characterPickerRow}>
                  <span style={{ ...styles.detectiveOverviewDot, background: DETECTIVE_COLORS[slotIdx] }} />
                  <select
                    value={selectedDetectiveNames[slotIdx]}
                    onChange={(e) => swapDetectiveNameAt(slotIdx, e.target.value)}
                    style={styles.characterSelect}
                  >
                    <option value="">— choose a name —</option>
                    {map.characterNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={styles.rulesBox}>
          <b>How it works</b>
          <ul style={{ margin: "8px 0 0 18px", padding: 0, lineHeight: 1.5 }}>
            <li>Mr. X moves first each round, then each detective moves once.</li>
            <li>Mr. X's position is hidden except on reveal rounds (3, 8, 13, 18, 22).</li>
            <li>Detectives always see Mr. X's travel log — the sequence of transport modes he's used — just not where he is.</li>
            <li>Taxi tickets cover short hops, Bus skips further, Underground jumps between hubs.</li>
            <li>Ferry crossings (dashed blue lines, over rivers or lakes depending on the map) are Mr. X only, and always cost a black ticket.</li>
            <li>On real-city maps, major areas are always named; zoom in (pinch, scroll, or the +/− buttons) to reveal every neighborhood's name and the full local street mesh.</li>
            <li>Black tickets camouflage a move on the log, or unlock a ferry. Mr. X has 5 for the whole game.</li>
            <li>Mr. X also holds two 2x cards, each letting him take two moves in one turn before detectives respond.</li>
            <li>Detectives win by landing on Mr. X's station. Mr. X wins by surviving 22 rounds.</li>
            <li>Screen will say "pass to [player]" between turns — hand the device over then.</li>
          </ul>
        </div>
        <button
          style={styles.primaryBtn}
          onClick={() => onStart({ mapId, numDetectives, detectiveNames: selectedDetectiveNames })}
        >
          Start Game
        </button>
        {onBack && (
          <button style={styles.linkBtn} onClick={onBack}>
            Back
          </button>
        )}
      </div>
    </div>
  );
}
