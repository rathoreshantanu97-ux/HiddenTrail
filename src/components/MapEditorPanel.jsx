import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MAP_LIST } from "../maps/index.js";
import * as auth from "../lib/accessControlApi.js";
import { applyMapOverride } from "../lib/useMapWithOverrides.js";

// ---------------------------------------------------------------------------
// MAP EDITOR PANEL — lets an admin visually drag a route's curve (like
// bending a line in a slide editor) instead of hand-computing an offset
// number, plus small, deliberately-LOW-RISK station adjustments
// (reposition a little, relabel, rename, toggle prominence). Everything
// here only ever changes how the map LOOKS -- never which stations
// exist, which edges connect them, or any ticket/round-timing value --
// see set_map_visual_overrides in access_control_functions.sql for the
// full reasoning on why that split keeps this safe to hand to an admin
// with no engine/graph knowledge.
//
// Reuses the EXACT SAME override mechanism already used for ticket/ratio
// overrides (map_settings + applyMapOverride) rather than inventing a
// second system -- a curve/station edit is just another field in the
// same per-map override row, merged onto the map the same way at load
// time everywhere else in the app already expects.
//
// Live preview reuses applyMapOverride itself: the canvas always renders
// `rawMap` merged with the CURRENT DRAFT (not yet saved) overrides, so
// what the admin sees while dragging is pixel-for-pixel what a player
// would see if they saved right now.
// ---------------------------------------------------------------------------

const SPREAD = 2.8; // matches GameBoard.jsx's parallel-edge spacing
const CLEARANCE_WARN_DISTANCE = 4.2; // matches the min-gap standard used across this project's map validation
const MAX_STATION_NUDGE = 8; // units -- keeps station repositioning to "small adjustment," not a redesign
const LABEL_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function normalFor(map, a, b) {
  const [ax, ay] = map.stations[a];
  const [bx, by] = map.stations[b];
  const [refX0, refY0] = a < b ? [ax, ay] : [bx, by];
  const [refX1, refY1] = a < b ? [bx, by] : [ax, ay];
  const dx = refX1 - refX0;
  const dy = refY1 - refY0;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

function controlPoint(map, a, b, offset) {
  const [ax, ay] = map.stations[a];
  const [bx, by] = map.stations[b];
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const { nx, ny } = normalFor(map, a, b);
  return { cx: mx + nx * offset, cy: my + ny * offset, mx, my, nx, ny };
}

function bezierPoint(ax, ay, cx, cy, bx, by, t) {
  const x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t ** 2 * bx;
  const y = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t ** 2 * by;
  return [x, y];
}

function minDistanceCurveToStation(ax, ay, cx, cy, bx, by, sx, sy) {
  let best = Infinity;
  for (let i = 0; i <= 40; i++) {
    const [x, y] = bezierPoint(ax, ay, cx, cy, bx, by, i / 40);
    const d = Math.hypot(x - sx, y - sy);
    if (d < best) best = d;
  }
  return best;
}

export default function MapEditorPanel({ accountId, onBack }) {
  const [mapId, setMapId] = useState(MAP_LIST[0]?.id || null);
  const [savedOverride, setSavedOverride] = useState(null);
  const [curveDraft, setCurveDraft] = useState({});
  const [stationDraft, setStationDraft] = useState({});
  const [selectedStation, setSelectedStation] = useState(null);
  const [dragState, setDragState] = useState(null); // { type: "curve"|"station", key/id }
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");
  const svgRef = useRef(null);

  const rawMap = MAP_LIST.find((m) => m.id === mapId);

  const loadOverrides = useCallback(async () => {
    try {
      const all = await auth.getMapOverrides();
      const existing = all[mapId] || null;
      setSavedOverride(existing);
      setCurveDraft(existing?.curveOffsetOverrides || {});
      setStationDraft(existing?.stationOverrides || {});
    } catch (e) {
      setErr(e.message);
    }
  }, [mapId]);

  useEffect(() => {
    setSelectedStation(null);
    setWarning("");
    loadOverrides();
  }, [loadOverrides]);

  // Live preview: rawMap merged with whatever's currently in the drafts,
  // via the SAME applyMapOverride every other part of the app uses --
  // this is what makes "what you see while dragging" and "what a player
  // would actually see after saving" identical by construction, not
  // just by careful bookkeeping.
  const displayMap = useMemo(() => {
    if (!rawMap) return null;
    return applyMapOverride(rawMap, { curveOffsetOverrides: curveDraft, stationOverrides: stationDraft });
  }, [rawMap, curveDraft, stationDraft]);

  if (!rawMap || !displayMap) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.title}>Map Editor</h1>
          <button style={styles.backBtn} onClick={onBack}>
            Back to Admin
          </button>
        </div>
        <p>No maps available.</p>
      </div>
    );
  }

  const viewW = displayMap.viewW || 100;
  const viewH = displayMap.viewH || 100;

  function screenToSVG(evt) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  // ---- curve dragging -------------------------------------------------
  function startCurveDrag(evt, key, a, b) {
    evt.stopPropagation();
    setDragState({ type: "curve", key, a, b });
  }

  function handlePointerMove(evt) {
    if (!dragState) return;
    const p = screenToSVG(evt);

    if (dragState.type === "curve") {
      const { key, a, b } = dragState;
      const { mx, my, nx, ny } = controlPoint(displayMap, a, b, 0);
      // Project the drag point onto the edge's normal direction to get
      // the equivalent offset value -- this is the whole trick that
      // turns "drag a handle" into "the same offset number the map data
      // already uses," with no separate representation to keep in sync.
      const offset = (p.x - mx) * nx + (p.y - my) * ny;
      setCurveDraft((prev) => ({ ...prev, [key]: Math.round(offset * 100) / 100 }));

      // Live clearance check against every OTHER station (not this
      // edge's own two endpoints).
      const { cx, cy } = controlPoint(displayMap, a, b, offset);
      const [ax, ay] = displayMap.stations[a];
      const [bx, by] = displayMap.stations[b];
      let worst = Infinity;
      let worstId = null;
      for (const [idStr, [sx, sy]] of Object.entries(displayMap.stations)) {
        const id = Number(idStr);
        if (id === a || id === b) continue;
        const d = minDistanceCurveToStation(ax, ay, cx, cy, bx, by, sx, sy);
        if (d < worst) {
          worst = d;
          worstId = id;
        }
      }
      if (worst < CLEARANCE_WARN_DISTANCE) {
        setWarning(`This curve passes close to ${displayMap.names?.[worstId] || `station ${worstId}`} (${worst.toFixed(1)} units) — consider a different bend.`);
      } else {
        setWarning("");
      }
    } else if (dragState.type === "station") {
      const { id } = dragState;
      const [origX, origY] = rawMap.stations[id]; // clamp against the TRUE original, not the already-nudged position, so repeated edits can't creep arbitrarily far
      let nx = p.x;
      let ny = p.y;
      const dx = nx - origX;
      const dy = ny - origY;
      const dist = Math.hypot(dx, dy);
      if (dist > MAX_STATION_NUDGE) {
        const scale = MAX_STATION_NUDGE / dist;
        nx = origX + dx * scale;
        ny = origY + dy * scale;
      }
      setStationDraft((prev) => ({
        ...prev,
        [id]: { ...(prev[id] || {}), x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100 },
      }));

      let worst = Infinity;
      let worstId = null;
      for (const [idStr, [sx, sy]] of Object.entries(rawMap.stations)) {
        const otherId = Number(idStr);
        if (otherId === id) continue;
        const d = Math.hypot(nx - sx, ny - sy);
        if (d < worst) {
          worst = d;
          worstId = otherId;
        }
      }
      if (worst < CLEARANCE_WARN_DISTANCE) {
        setWarning(`This station is now close to ${displayMap.names?.[worstId] || `station ${worstId}`} (${worst.toFixed(1)} units) — consider a smaller nudge.`);
      } else {
        setWarning("");
      }
    }
  }

  function handlePointerUp() {
    setDragState(null);
    setWarning("");
  }

  function resetCurve(key) {
    setCurveDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function startStationDrag(evt, id) {
    evt.stopPropagation();
    setDragState({ type: "station", id });
  }

  function selectStation(evt, id) {
    evt.stopPropagation();
    setSelectedStation(id);
  }

  function updateStationField(id, field, value) {
    setStationDraft((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  }

  function resetStation(id) {
    setStationDraft((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    setErr("");
    setSaved("");
    try {
      const curvesToSave = Object.keys(curveDraft).length > 0 ? curveDraft : null;
      const stationsToSave = Object.keys(stationDraft).length > 0 ? stationDraft : null;
      await auth.setMapVisualOverrides({
        callerAccountId: accountId,
        mapId,
        curveOffsetOverrides: curvesToSave,
        stationOverrides: stationsToSave,
      });
      await loadOverrides();
      setSaved("Saved — live for every player now.");
      setTimeout(() => setSaved(""), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetAll() {
    setBusy(true);
    setErr("");
    try {
      await auth.setMapVisualOverrides({ callerAccountId: accountId, mapId, curveOffsetOverrides: null, stationOverrides: null });
      setCurveDraft({});
      setStationDraft({});
      await loadOverrides();
      setSaved("Reset to the map's original defaults.");
      setTimeout(() => setSaved(""), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedStationData = selectedStation != null ? displayMap.stations[selectedStation] : null;
  const selectedIsMajor = selectedStation != null && displayMap.majorStations?.has(selectedStation);
  const selectedLabelDir =
    selectedStation != null
      ? selectedIsMajor
        ? displayMap.majorLabelDir?.[selectedStation]
        : displayMap.minorLabelDir?.[selectedStation]
      : null;

  const hasUnsavedChanges = Object.keys(curveDraft).length > 0 || Object.keys(stationDraft).length > 0;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Map Editor</h1>
        <button style={styles.backBtn} onClick={onBack}>
          Back to Admin
        </button>
      </div>

      {err && <div style={styles.errText}>{err}</div>}

      <div style={styles.mapPicker}>
        {MAP_LIST.map((m) => (
          <button
            key={m.id}
            onClick={() => setMapId(m.id)}
            style={{ ...styles.mapPill, ...(mapId === m.id ? styles.mapPillActive : {}) }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={styles.smallNote}>
        Drag any route's curve to bend it, like adjusting a curve in a slide editor. Drag a station a little to
        nudge its position, or click it to rename/relabel it. Changes only affect how the map LOOKS — never
        connectivity, tickets, or round timing — and only take effect for players once you hit Save.
      </div>

      <div style={styles.body}>
        <div style={styles.canvasWrap}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${viewW} ${viewH}`}
            style={styles.svg}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <rect x="0" y="0" width={viewW} height={viewH} fill="#f6f1e5" />

            {displayMap.edges.map(([a, b, mode], i) => {
              const key = `${a}-${b}-${mode}-${i}`;
              const gKey = edgeKey(a, b);
              const group = displayMap.edgeGroups?.[gKey] || [mode];
              const canManuallyCurve = group.length === 1; // multi-mode parallel edges use automatic spacing -- see file header comment
              const manualOffset = displayMap.manualCurveOffsets?.[gKey];
              const offset = manualOffset != null ? manualOffset : 0;
              const { cx, cy } = controlPoint(displayMap, a, b, offset);
              const [ax, ay] = displayMap.stations[a];
              const [bx, by] = displayMap.stations[b];
              const color = mode === "underground" ? "#c12115" : mode === "bus" ? "#109347" : mode === "ferry" ? "#1a1a1a" : "#a0740d";
              return (
                <g key={key}>
                  <path d={`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`} fill="none" stroke={color} strokeWidth={0.35} opacity={0.75} />
                  {canManuallyCurve && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={1.1}
                      fill="#fff"
                      stroke="#666"
                      strokeWidth={0.3}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => startCurveDrag(e, gKey, a, b)}
                    />
                  )}
                </g>
              );
            })}

            {Object.entries(displayMap.stations).map(([idStr, [x, y]]) => {
              const id = Number(idStr);
              const isSelected = selectedStation === id;
              return (
                <g key={id}>
                  <circle
                    cx={x}
                    cy={y}
                    r={1.6}
                    fill={isSelected ? "#2937c9" : "#fff"}
                    stroke={isSelected ? "#2937c9" : "#8a8375"}
                    strokeWidth={0.35}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => startStationDrag(e, id)}
                    onClick={(e) => selectStation(e, id)}
                  />
                  <text x={x} y={y + 3} fontSize="1.6" textAnchor="middle" fill="#5c5648" pointerEvents="none">
                    {displayMap.names?.[id] || id}
                  </text>
                </g>
              );
            })}
          </svg>
          {warning && <div style={styles.warningBar}>{warning}</div>}
        </div>

        <div style={styles.sidePanel}>
          {selectedStation != null && selectedStationData ? (
            <div>
              <div style={styles.sideTitle}>Station {selectedStation}</div>
              <label style={styles.configLabel}>
                Name
                <input
                  type="text"
                  style={styles.configInput}
                  value={displayMap.names?.[selectedStation] || ""}
                  onChange={(e) => updateStationField(selectedStation, "name", e.target.value)}
                />
              </label>
              <label style={styles.configLabel}>
                <input
                  type="checkbox"
                  checked={!!selectedIsMajor}
                  onChange={(e) => updateStationField(selectedStation, "isMajor", e.target.checked)}
                />{" "}
                Always show label (major station)
              </label>
              <label style={styles.configLabel}>
                Label direction
                <div style={styles.dirGrid}>
                  {LABEL_DIRS.map((dir) => (
                    <button
                      key={dir}
                      style={{ ...styles.dirBtn, ...(selectedLabelDir === dir ? styles.dirBtnActive : {}) }}
                      onClick={() => updateStationField(selectedStation, "labelDir", dir)}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </label>
              <button style={styles.smallBtn} onClick={() => resetStation(selectedStation)}>
                Reset this station to default
              </button>
              <button style={{ ...styles.smallBtn, marginTop: 6 }} onClick={() => setSelectedStation(null)}>
                Deselect
              </button>
            </div>
          ) : (
            <div style={styles.smallNote}>Click a station to edit its name, label direction, or prominence.</div>
          )}

          <div style={styles.divider} />

          <div style={styles.sideTitle}>Unsaved edits</div>
          <div style={styles.smallNote}>
            {Object.keys(curveDraft).length} curve{Object.keys(curveDraft).length === 1 ? "" : "s"},{" "}
            {Object.keys(stationDraft).length} station{Object.keys(stationDraft).length === 1 ? "" : "s"} changed
            {savedOverride && " (relative to what's already saved)"}.
          </div>
          {Object.keys(curveDraft).length > 0 && (
            <div>
              {Object.entries(curveDraft).map(([key, val]) => (
                <div key={key} style={styles.editedRow}>
                  <span>
                    {key}: {val}
                  </span>
                  <button style={styles.tinyBtn} onClick={() => resetCurve(key)}>
                    reset
                  </button>
                </div>
              ))}
            </div>
          )}

          <button style={styles.toggleBtn} onClick={handleSave} disabled={busy || !hasUnsavedChanges}>
            {busy ? "Saving..." : "Save changes"}
          </button>
          {saved && <div style={{ color: "#2a8", fontSize: 12.5, marginTop: 6 }}>{saved}</div>}
          <button style={{ ...styles.smallBtn, marginTop: 10 }} onClick={handleResetAll} disabled={busy}>
            Reset entire map to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh", background: "#f7f6f3", padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { margin: 0, fontSize: 22 },
  backBtn: { border: "1.5px solid #ddd", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  mapPicker: { display: "flex", gap: 8, marginBottom: 10 },
  mapPill: { border: "1.5px solid #ddd", background: "#fff", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  mapPillActive: { background: "#111", color: "#fff", borderColor: "#111" },
  smallNote: { fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5 },
  body: { display: "flex", gap: 16 },
  canvasWrap: { flex: 1, position: "relative" },
  svg: { width: "100%", height: "auto", aspectRatio: "1 / 1", background: "#fff", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", touchAction: "none" },
  warningBar: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    background: "#fdecea",
    color: "#a33",
    fontSize: 12.5,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #e0a8a8",
  },
  sidePanel: { width: 260, flexShrink: 0, background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
  sideTitle: { fontWeight: 700, fontSize: 14, marginBottom: 8 },
  configLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "#555", fontWeight: 600, marginBottom: 10 },
  configInput: { padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 },
  dirGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: 4 },
  dirBtn: { border: "1px solid #ddd", background: "#fafafa", borderRadius: 6, padding: "4px 0", fontSize: 11, cursor: "pointer" },
  dirBtnActive: { background: "#2937c9", color: "#fff", borderColor: "#2937c9" },
  divider: { borderTop: "1px solid #f0f0f0", margin: "14px 0" },
  editedRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, padding: "3px 0", color: "#555" },
  tinyBtn: { border: "1px solid #ddd", background: "#fff", borderRadius: 5, padding: "1px 6px", fontSize: 10.5, cursor: "pointer" },
  toggleBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    marginTop: 14,
  },
  smallBtn: { border: "1px solid #ddd", background: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", width: "100%" },
  errText: { fontSize: 13, color: "#c0392b", background: "#fdecea", borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
};
