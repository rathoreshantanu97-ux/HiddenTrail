import React from "react";
import { styles } from "./GameBoard.jsx";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import { formatLogEntry } from "../lib/gameEngine.js";

export default function EndedScreen({ map, match, mrxName, detectiveName, onNewGame }) {
  const activeMode = map.modeTheme || MODE_DEFAULT;
  const stationLabel = (id) => (map.names ? `${map.names[id]} (#${id})` : `station ${id}`);
  const theme = { mrxName, detectiveName, stationLabel, modeLabel: (m) => activeMode[m].label };

  const readableLog = match.log
    .filter((e) => e.kind !== "reveal_full_route")
    .map((e) => formatLogEntry(e, theme))
    .filter(Boolean);

  const revealEntry = [...match.log].reverse().find((e) => e.kind === "reveal_full_route");
  const positionLog = revealEntry?.payload?.positionLog || match.mrX.positionLog || [];

  return (
    <div style={styles.page}>
      <div style={styles.setupCard}>
        <h1 style={styles.title}>{match.winner === "mrx" ? `${mrxName()} Wins` : "Detectives Win"}</h1>
        <p style={styles.subtitle}>
          {match.winner === "mrx"
            ? `${mrxName()} evaded capture for 22 rounds.`
            : `A detective landed on ${mrxName()}'s station.`}
        </p>
        <div style={styles.logBox}>
          {readableLog.slice(-8).map((l, i) => (
            <div key={i} style={styles.logLine}>
              {l}
            </div>
          ))}
        </div>
        {positionLog.length > 0 && (
          <div style={styles.revealPathBox}>
            <div style={styles.travelLogTitle}>{mrxName()}'s full route, revealed</div>
            <div style={styles.travelLogRow}>
              {positionLog.map((entry, i) => (
                <span
                  key={i}
                  style={{
                    ...styles.travelLogChip,
                    background: entry.mode ? activeMode[entry.mode].color : "#ddd",
                    color: entry.mode === "black" ? "#fff" : "#1a1a1a",
                  }}
                  title={entry.mode ? `Round ${entry.round}: ${activeMode[entry.mode].label}` : "Start"}
                >
                  {entry.round === 0 ? "Start" : entry.round}: {map.names ? map.names[entry.pos] : `#${entry.pos}`}
                </span>
              ))}
            </div>
          </div>
        )}
        <button style={styles.primaryBtn} onClick={onNewGame}>
          New Game
        </button>
      </div>
    </div>
  );
}
