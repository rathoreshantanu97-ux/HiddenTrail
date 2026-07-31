import React, { useState, useEffect, useMemo, useRef } from "react";
import { buildReplayTimeline } from "../lib/gameEngine.js";
import { MODE_DEFAULT } from "../maps/mapSchema.js";

// ---------------------------------------------------------------------------
// REPLAY VIEW — full-screen overlay on top of EndedScreen. Lets players
// step through (Next/Prev + scrub bar) or auto-play (Play/Pause) the
// just-finished match, with the map, ticket panel, and log all updating
// in sync at every step -- a genuinely faithful replay, not just token
// movement with details left for elsewhere.
//
// Deliberately a SEPARATE, simpler renderer from the live GameBoard
// rather than reusing it directly: GameBoard is built entirely around
// interactive play (click handlers, legal-move computation, route
// explorer, pending-move state), none of which applies to a read-only
// historical replay. A dedicated renderer that draws exactly what's
// needed is more maintainable than threading a "read only" flag through
// ~1500 lines of interactive logic.
// ---------------------------------------------------------------------------
export default function ReplayView({ map, match, mrxName, detectiveName, onClose }) {
  const timeline = useMemo(() => buildReplayTimeline(match), [match]);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef(null);

  const activeMode = map.modeTheme || MODE_DEFAULT;
  const isWesteros = map.id === "westeros";
  const mrxLabel = mrxName ? mrxName() : "Mr. X";
  const detLabel = (id) => (detectiveName ? detectiveName(id) : `Detective ${id + 1}`);

  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }
    playTimerRef.current = setInterval(() => {
      setStepIndex((i) => {
        if (i >= timeline.length - 1) {
          setIsPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1100);
    return () => clearInterval(playTimerRef.current);
  }, [isPlaying, timeline.length]);

  const step = timeline[stepIndex] || timeline[0];
  if (!step) return null;

  const stationLabel = (id) => (map.names ? map.names[id] : `station ${id}`);

  function stepDescription(s) {
    if (s.actor === null) return "Starting positions";
    if (s.actor === "mrx") {
      return `${mrxLabel} moved (${s.mode === "black" ? "Black" : activeMode[s.mode]?.label || s.mode})`;
    }
    const detId = parseInt(s.actor.slice(1), 10);
    return `${detLabel(detId)} moved to ${stationLabel(s.detectivePositions[detId])} (${activeMode[s.mode]?.label || s.mode})`;
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <div style={styles.title}>Replay</div>
        <button style={styles.closeBtn} onClick={onClose}>
          ✕ Back to Results
        </button>
      </div>

      <div style={styles.body}>
        <div style={styles.boardWrap}>
          <svg viewBox={`0 0 ${map.viewW || 100} ${map.viewH || 100}`} style={styles.svg}>
            {map.allRenderEdges.map(([a, b, mode], i) => {
              const [ax, ay] = map.stations[a];
              const [bx, by] = map.stations[b];
              return (
                <line
                  key={i}
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke={activeMode[mode]?.color || "#ccc"}
                  strokeWidth={mode === "underground" ? 0.45 : mode === "bus" ? 0.35 : 0.2}
                  opacity={0.5}
                />
              );
            })}
            {Object.entries(map.stations).map(([id, [x, y]]) => {
              const numId = Number(id);
              const detHere = Object.entries(step.detectivePositions).find(([, pos]) => pos === numId);
              const mrXHere = step.mrXPos === numId;
              let fill = "#fff";
              let stroke = "#999";
              if (detHere) {
                fill = match.detectives.find((d) => d.id === Number(detHere[0]))?.color || "#3b82f6";
                stroke = "#fff";
              }
              if (mrXHere) {
                fill = "#1a1a1a";
                stroke = "#fff";
              }
              return (
                <circle
                  key={id}
                  cx={x}
                  cy={y}
                  r={1.6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.35}
                />
              );
            })}
          </svg>
        </div>

        <div style={styles.sidePanel}>
          <div style={styles.roundLabel}>Round {step.round}</div>
          <div style={styles.stepDesc}>{stepDescription(step)}</div>

          <div style={styles.ticketsPanel}>
            <div style={styles.ticketsTitle}>{mrxLabel}</div>
            <div style={styles.ticketsRow}>
              {Object.entries(step.mrXTickets || {}).map(([mode, count]) => (
                <span key={mode} style={styles.miniChip}>
                  {mode === "double" ? "2x" : mode === "black" ? "Blk" : activeMode[mode]?.short || mode}
                  {count}
                </span>
              ))}
            </div>
            {match.detectives.map((d) => (
              <div key={d.id}>
                <div style={styles.ticketsTitle}>
                  <span style={{ ...styles.dot, background: d.color }} /> {detLabel(d.id)}
                </div>
                <div style={styles.ticketsRow}>
                  {Object.entries(step.detectiveTickets?.[d.id] || {}).map(([mode, count]) => (
                    <span key={mode} style={styles.miniChip}>
                      {activeMode[mode]?.short || mode}
                      {count}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.controls}>
        <input
          type="range"
          min={0}
          max={timeline.length - 1}
          value={stepIndex}
          onChange={(e) => {
            setIsPlaying(false);
            setStepIndex(Number(e.target.value));
          }}
          style={styles.scrubBar}
        />
        <div style={styles.controlsRow}>
          <button
            style={styles.controlBtn}
            onClick={() => {
              setIsPlaying(false);
              setStepIndex((i) => Math.max(0, i - 1));
            }}
            disabled={stepIndex === 0}
          >
            ← Prev
          </button>
          <button style={styles.playBtn} onClick={() => setIsPlaying((p) => !p)} disabled={stepIndex >= timeline.length - 1 && !isPlaying}>
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            style={styles.controlBtn}
            onClick={() => {
              setIsPlaying(false);
              setStepIndex((i) => Math.min(timeline.length - 1, i + 1));
            }}
            disabled={stepIndex >= timeline.length - 1}
          >
            Next →
          </button>
          <span style={styles.stepCounter}>
            {stepIndex} / {timeline.length - 1}
          </span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "#f7f6f3",
    zIndex: 2000,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #e5e2d8",
    background: "#fff",
    flexShrink: 0,
  },
  title: { fontSize: 18, fontWeight: 700 },
  closeBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    cursor: "pointer",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    padding: 16,
    gap: 16,
  },
  boardWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  },
  svg: {
    width: "100%",
    height: "100%",
    maxWidth: 700,
    maxHeight: "100%",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  },
  sidePanel: {
    width: 260,
    flexShrink: 0,
    overflowY: "auto",
  },
  roundLabel: { fontSize: 13, color: "#888" },
  stepDesc: { fontSize: 15, fontWeight: 700, marginBottom: 14 },
  ticketsPanel: { display: "flex", flexDirection: "column", gap: 8 },
  ticketsTitle: { fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, marginTop: 8 },
  ticketsRow: { display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 },
  miniChip: {
    fontSize: 11,
    fontWeight: 700,
    border: "1px solid #ddd",
    borderRadius: 5,
    padding: "1px 5px",
  },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  controls: {
    flexShrink: 0,
    padding: "10px 16px 16px",
    background: "#fff",
    borderTop: "1px solid #e5e2d8",
  },
  scrubBar: { width: "100%" },
  controlsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  controlBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    cursor: "pointer",
  },
  playBtn: {
    border: "none",
    background: "#111",
    color: "#fff",
    borderRadius: 8,
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  stepCounter: { fontSize: 12, color: "#999", marginLeft: 8 },
};
