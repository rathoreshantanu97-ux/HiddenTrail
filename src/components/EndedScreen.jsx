import React, { useState } from "react";
import { styles } from "./GameBoard.jsx";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import { formatLogEntry } from "../lib/gameEngine.js";
import ReplayView from "./ReplayView.jsx";

export default function EndedScreen({ map, match, mrxName, detectiveName, onNewGame }) {
  const [showReplay, setShowReplay] = useState(false);
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
        <h1 style={styles.title}>
          {match.winner === "mrx" ? `${mrxName()} Wins` : match.winner === "detectives" ? `${map.detectiveTeamName || "Detectives"} Win` : "Game Ended"}
        </h1>
        <p style={styles.subtitle}>
          {match.winner === "mrx"
            ? `${mrxName()} evaded capture for ${match.maxRounds} rounds.`
            : match.winner === "detectives"
            ? map.detectiveTeamName && map.detectiveTeamName !== "Detectives"
              ? `${map.detectiveTeamName} caught up with ${mrxName()}.`
              : `A detective landed on ${mrxName()}'s station.`
            : "All players agreed to end the game early."}
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
                    // v3.25: "stay" rounds (Mr.X stood still) get the
                    // same muted grey treatment as the live travel log,
                    // never a ticket color -- the revealed route should
                    // make the standing-still rounds obvious too.
                    background: entry.mode === "stay" ? "#e2e2e2" : entry.mode ? activeMode[entry.mode].color : "#ddd",
                    color: entry.mode === "black" ? "#fff" : entry.mode === "stay" ? "#6b6b6b" : "#1a1a1a",
                    ...(entry.mode === "stay" ? { border: "1.5px dashed #b3b3b3" } : {}),
                  }}
                  title={
                    entry.mode === "stay"
                      ? `Round ${entry.round}: did not move${entry.ticket ? ` (forfeited a ${activeMode[entry.ticket]?.label || entry.ticket} ticket)` : ""}`
                      : entry.mode
                        ? `Round ${entry.round}: ${activeMode[entry.mode]?.label || entry.mode}`
                        : "Start"
                  }
                >
                  {entry.round === 0 ? "Start" : entry.round}: {map.names ? map.names[entry.pos] : `#${entry.pos}`}
                  {entry.mode === "stay" ? " (stayed)" : ""}
                </span>
              ))}
            </div>
          </div>
        )}
        <button style={styles.primaryBtn} onClick={onNewGame}>
          New Game
        </button>
        <button style={{ ...styles.primaryBtn, background: "#fff", color: "#111", border: "1.5px solid #ddd" }} onClick={() => setShowReplay(true)}>
          Replay Game
        </button>
      </div>
      {showReplay && (
        <ReplayView map={map} match={match} mrxName={mrxName} detectiveName={detectiveName} onClose={() => setShowReplay(false)} />
      )}
    </div>
  );
}
