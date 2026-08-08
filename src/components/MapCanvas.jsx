import React, { useState } from "react";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";
import { MODE_DEFAULT } from "../maps/mapSchema.js";

// ---------------------------------------------------------------------------
// MAP CANVAS — renders just the map itself (stations, edges, labels,
// background), with NO game state required (no detectives, no Mr. X, no
// turns). This is what lets you preview a map you're editing without
// starting a whole game.
//
// Used by the /preview page (mapPreviewMain.jsx). GameBoard.jsx has its
// own copy of this same rendering logic plus game-state overlays (detective
// dots, Mr. X's dot, legal-move highlighting) -- kept separate on purpose
// so editing this preview tool can never risk breaking the tested,
// deployed game board.
// ---------------------------------------------------------------------------
export default function MapCanvas({ map, highlightStationId, onStationClick }) {
  const [zoom, setZoom] = useState(1);
  const activeMode = map.modeTheme || MODE_DEFAULT;
  const baseW = map.viewW || 100;
  const baseH = map.viewH || 100;

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 900, margin: "0 auto" }}>
      <svg
        viewBox={`-0.5 -1.5 ${baseW + 1} ${baseH + 2}`}
        style={{ width: "100%", borderRadius: 12, boxShadow: "0 2px 14px rgba(0,0,0,0.1)", background: "#fff" }}
      >
        <defs>
          <linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#bcdcea" />
            <stop offset="100%" stopColor="#a7cede" />
          </linearGradient>
          <radialGradient id="lakeGrad" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#bfe0ec" />
            <stop offset="100%" stopColor="#9ccbdb" />
          </radialGradient>
          <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a8cbdb" />
            <stop offset="100%" stopColor="#88b3c9" />
          </linearGradient>
          <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0.3" stdDeviation="0.4" floodColor="#000" floodOpacity="0.25" />
          </filter>
          <filter id="regionShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0.4" stdDeviation="0.6" floodColor="#3d4a3a" floodOpacity="0.18" />
          </filter>
        </defs>

        <MapBackground map={map} />
        <MapFrameAndCompass map={map} />

        {map.allRenderEdges.map(([a, b, mode], i) => {
          const sa = map.stations[a];
          const sb = map.stations[b];
          if (!sa || !sb) return null; // defensive: don't crash the whole preview on one bad edge
          const [ax, ay] = sa;
          const [bx, by] = sb;
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          const group = map.edgeGroups[key] || [mode];
          const slot = group.indexOf(mode);
          const total = group.length;
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2;
          const dx = bx - ax,
            dy = by - ay;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len,
            ny = dx / len;
          const spread = 1.6;
          const offset = total > 1 ? (slot - (total - 1) / 2) * spread : 0;
          const cx = mx + nx * offset;
          const cy = my + ny * offset;
          const strokeW = mode === "underground" ? 0.45 : mode === "bus" ? 0.35 : mode === "ferry" ? 0.42 : 0.24;
          const modeInfo = activeMode[mode] || MODE_DEFAULT.taxi;
          return (
            <g key={`${key}-${mode}-${i}`}>
              <path
                d={`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`}
                fill="none"
                stroke="#ffffff"
                strokeWidth={strokeW + 0.35}
                strokeLinecap="round"
                opacity={0.9}
              />
              <path
                d={`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`}
                fill="none"
                stroke={modeInfo.color}
                strokeWidth={strokeW}
                strokeDasharray={mode === "ferry" ? "1.2,0.8" : undefined}
                opacity={0.85}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {Object.entries(map.stations).map(([id, [x, y]]) => {
          const numId = Number(id);
          const isHighlighted = highlightStationId === numId;
          const isMajor = map.majorStations && map.majorStations.has(numId);
          const labelDir = isMajor ? map.majorLabelDir && map.majorLabelDir[numId] : map.minorLabelDir && map.minorLabelDir[numId];
          const nodeR = 1.6;

          const DIR_VECS = {
            N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
            NE: [0.707, -0.707], NW: [-0.707, -0.707], SE: [0.707, 0.707], SW: [-0.707, 0.707],
          };
          const ANCHOR_FOR_DIR = { E: "start", NE: "start", SE: "start", W: "end", NW: "end", SW: "end", N: "middle", S: "middle" };

          return (
            <g
              key={id}
              onClick={() => onStationClick && onStationClick(numId)}
              style={{ cursor: onStationClick ? "pointer" : "default" }}
            >
              <circle cx={x} cy={y} r={2.6} fill="transparent" />
              {isHighlighted && (
                <circle cx={x} cy={y} r={nodeR + 1} fill="none" stroke="#2563eb" strokeWidth={0.4} strokeDasharray="0.6,0.6" />
              )}
              <circle cx={x} cy={y} r={nodeR} fill="#ffffff" stroke="#8a8375" strokeWidth={0.35} filter="url(#softShadow)" />
              {map.stationModes[id] &&
                [...map.stationModes[id]].map((m, mi, arr) => {
                  const angle = (mi / arr.length) * 2 * Math.PI - Math.PI / 2;
                  const dotR = nodeR + 0.55;
                  const modeInfo = activeMode[m] || MODE_DEFAULT.taxi;
                  return (
                    <circle
                      key={m}
                      cx={x + Math.cos(angle) * dotR}
                      cy={y + Math.sin(angle) * dotR}
                      r={0.42}
                      fill={modeInfo.color}
                      stroke="#fff"
                      strokeWidth={0.12}
                    />
                  );
                })}
              <text x={x} y={y + 0.55} fontSize={1.35} textAnchor="middle" fill="#5c5648" fontWeight="700">
                {id}
              </text>
              {map.names &&
                labelDir &&
                (() => {
                  const dvec = DIR_VECS[labelDir];
                  const dist = isMajor ? 3.0 : 2.3;
                  const lx = x + dvec[0] * dist;
                  const ly = y + dvec[1] * dist + (dvec[1] === 0 ? 0.5 : 0);
                  return (
                    <text
                      x={lx}
                      y={ly}
                      fontSize={isMajor ? 1.6 : 1.1}
                      textAnchor={ANCHOR_FOR_DIR[labelDir]}
                      fill={isMajor ? "#1a1a1a" : "#5f6368"}
                      fontWeight={isMajor ? 700 : 600}
                      stroke="#ffffff"
                      strokeWidth={isMajor ? 0.35 : 0.28}
                      paintOrder="stroke"
                    >
                      {map.names[id]}
                    </text>
                  );
                })()}
              {map.names && <title>{map.names[id]}</title>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
