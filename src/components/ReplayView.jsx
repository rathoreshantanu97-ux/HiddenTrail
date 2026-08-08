import React, { useState, useEffect, useMemo, useRef } from "react";
import { buildReplayTimeline } from "../lib/gameEngine.js";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";

// Label-placement helpers, matching GameBoard.jsx exactly, so a station's
// name lands in the same spot in replay as it did during live play.
const DIR_VECS = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
  NE: [0.707, -0.707],
  NW: [-0.707, -0.707],
  SE: [0.707, 0.707],
  SW: [-0.707, 0.707],
};
const ANCHOR_FOR_DIR = {
  E: "start",
  NE: "start",
  SE: "start",
  W: "end",
  NW: "end",
  SW: "end",
  N: "middle",
  S: "middle",
};

// ---------------------------------------------------------------------------
// REPLAY VIEW — full-screen overlay on top of EndedScreen. Lets players
// step through (Next/Prev + scrub bar) or auto-play (Play/Pause) the
// just-finished match, with the map, ticket panel, and log all updating
// in sync at every step -- a genuinely faithful replay, not just token
// movement with details left for elsewhere.
//
// Renders the SAME visual map players saw during live play: background
// art, frame/compass, curved parallel-route fan-out, station name labels,
// and transport-mode dots all match GameBoard.jsx's rendering. Still a
// separate component from GameBoard rather than reusing it directly,
// since GameBoard is built entirely around interactive play (click
// handlers, legal-move computation, route explorer, pending-move state)
// that a read-only historical replay has no use for -- but the parts that
// affect what the map actually LOOKS like are kept in sync with it.
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
          <svg viewBox={`-0.5 -1.5 ${(map.viewW || 100) + 1} ${(map.viewH || 100) + 2}`} preserveAspectRatio="none" style={styles.svg}>
            <MapBackground map={map} />
            <MapFrameAndCompass map={map} />
            {[...map.allRenderEdges]
              .map((e, i) => [e, i])
              // Same render-order fix as GameBoard.jsx: taxi first, then
              // bus, then underground/metro, then ferry -- so the rarer
              // tiers always draw on top instead of getting visually
              // buried under a dense taxi mesh.
              .sort(([[, , modeA]], [[, , modeB]]) => {
                const order = { taxi: 0, bus: 1, underground: 2, ferry: 3 };
                return (order[modeA] ?? 0) - (order[modeB] ?? 0);
              })
              .map(([[a, b, mode], i]) => {
              const [ax, ay] = map.stations[a];
              const [bx, by] = map.stations[b];
              // Same parallel-edge fan-out as the live GameBoard: when two
              // stations share more than one connection (e.g. a taxi edge
              // and a bus edge between the same pair), curve them apart
              // instead of drawing directly on top of each other. Replay
              // is meant to show the exact map players saw during the
              // game, not a simplified version, so this needed to match.
              const key = a < b ? `${a}-${b}` : `${b}-${a}`;
              const group = map.edgeGroups[key] || [mode];
              const slot = group.indexOf(mode);
              const total = group.length;
              const mx = (ax + bx) / 2;
              const my = (ay + by) / 2;
              // Compute the perpendicular normal from a FIXED reference
              // direction (lower station id -> higher station id), matching
              // GameBoard.jsx's fix -- see that file for why this matters
              // (using each edge's own (a,b) order let two parallel edges'
              // offsets cancel out and land on the exact same point instead
              // of mirroring apart, when their raw endpoint order differed).
              const [refX0, refY0] = a < b ? [ax, ay] : [bx, by];
              const [refX1, refY1] = a < b ? [bx, by] : [ax, ay];
              const dx = refX1 - refX0,
                dy = refY1 - refY0;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const nx = -dy / len,
                ny = dx / len;
              // Widened from 1.6 to 2.8, matching GameBoard.jsx's fix --
              // see that file for why (a thicker tier's casing could
              // visually swallow a thinner parallel line at the old spread).
              const spread = 2.8;
              const offset = total > 1 ? (slot - (total - 1) / 2) * spread : 0;
              const cx = mx + nx * offset;
              const cy = my + ny * offset;
              return (
                <path
                  key={i}
                  d={`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`}
                  fill="none"
                  stroke={activeMode[mode]?.color || "#ccc"}
                  strokeWidth={mode === "underground" ? 0.5 : mode === "bus" ? 0.35 : 0.2}
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
              const nodeR = 1.6;
              const isMajor = map.majorStations && map.majorStations.has(numId);
              const labelDir = isMajor ? map.majorLabelDir && map.majorLabelDir[numId] : map.minorLabelDir && map.minorLabelDir[numId];
              const isTiny = map.tinyLabelStations && map.tinyLabelStations.has(numId);
              const dvec = DIR_VECS[labelDir];
              const labelDist = isMajor ? 3.0 : isTiny ? 1.8 : 2.3;
              const lx = dvec ? x + dvec[0] * labelDist : x;
              const ly = dvec ? y + dvec[1] * labelDist + (dvec[1] === 0 ? 0.5 : 0) : y;

              return (
                <g key={id}>
                  <circle cx={x} cy={y} r={nodeR} fill={fill} stroke={stroke} strokeWidth={0.35} />
                  {[...(map.stationModes?.[id] || [])].map((m, mi, arr) => {
                    const angle = (mi / arr.length) * 2 * Math.PI - Math.PI / 2;
                    const dotR = nodeR + 0.55;
                    return (
                      <circle
                        key={m}
                        cx={x + Math.cos(angle) * dotR}
                        cy={y + Math.sin(angle) * dotR}
                        r={0.42}
                        fill={activeMode[m]?.color || "#ccc"}
                        stroke="#fff"
                        strokeWidth={0.12}
                      />
                    );
                  })}
                  <text
                    x={x}
                    y={y + 0.55}
                    fontSize={1.35}
                    textAnchor="middle"
                    fill={detHere || mrXHere ? "#ffffff" : map.id === "bengaluru" ? "#3c4043" : "#5c5648"}
                    fontWeight="700"
                  >
                    {id}
                  </text>
                  {map.names && labelDir && (
                    <text
                      x={lx}
                      y={ly}
                      fontSize={isMajor ? 1.6 : isTiny ? 0.75 : 1.1}
                      textAnchor={ANCHOR_FOR_DIR[labelDir]}
                      fill={isMajor ? "#1a1a1a" : "#5f6368"}
                      fontWeight={isMajor ? 700 : 600}
                      stroke="#ffffff"
                      strokeWidth={isMajor ? 0.35 : 0.28}
                      paintOrder="stroke"
                    >
                      {map.names[id]}
                    </text>
                  )}
                </g>
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
