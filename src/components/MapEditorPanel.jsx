import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MAP_LIST } from "../maps/index.js";
import * as auth from "../lib/accessControlApi.js";
import { applyMapOverride } from "../lib/useMapWithOverrides.js";
import { curvePathD, curveControlPoints, sampleCurvePoints, normalizeCurveOffsets } from "../lib/curveGeometry.js";

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
//
// Multi-point curves: an edge's manual offset can now be a single number
// (one bend handle, exactly the original behavior) or an array of 2-3
// numbers (2-3 independently-draggable handles for a longer route that
// needs an S-shape). "+add point" / "remove point" buttons switch a
// curve between these shapes; curveGeometry.js (shared with GameBoard.jsx
// and ReplayView.jsx) guarantees the editor's preview renders pixel-
// identical to what a player actually sees.
// ---------------------------------------------------------------------------

const CLEARANCE_WARN_DISTANCE = 4.2; // matches the min-gap standard used across this project's map validation
const MAX_STATION_NUDGE = 8; // units -- keeps station repositioning to "small adjustment," not a redesign
const MAX_CURVE_POINTS = 3;
const LABEL_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const MODE_COLORS = { underground: "#c12115", bus: "#109347", ferry: "#1a1a1a", taxi: "#a0740d" };

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function perpendicular(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { dx, dy, len, nx: -dy / len, ny: dx / len };
}

function minDistanceCurveToStation(ax, ay, bx, by, offsets, sx, sy) {
  const pts = sampleCurvePoints(ax, ay, bx, by, offsets, 40);
  let best = Infinity;
  for (const [x, y] of pts) {
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
  const [selectedEdge, setSelectedEdge] = useState(null); // edge key of the curve currently focused, for the add/remove-point controls
  const [dragState, setDragState] = useState(null); // { type: "curve"|"station", key/id, pointIndex }
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(1);
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
    setSelectedEdge(null);
    setWarning("");
    setZoom(1);
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
            ← Back to Admin
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

  // ---- curve dragging ---------------------------------------------------
  // pointIndex identifies WHICH handle on a (possibly multi-point) curve
  // is being dragged, so each handle moves independently.
  function startCurveDrag(evt, key, a, b, pointIndex) {
    evt.stopPropagation();
    setSelectedStation(null);
    setSelectedEdge(key);
    setDragState({ type: "curve", key, a, b, pointIndex });
  }

  function checkCurveClearance(a, b, offsets) {
    const [ax, ay] = displayMap.stations[a];
    const [bx, by] = displayMap.stations[b];
    let worst = Infinity;
    let worstId = null;
    for (const [idStr, [sx, sy]] of Object.entries(displayMap.stations)) {
      const id = Number(idStr);
      if (id === a || id === b) continue;
      const d = minDistanceCurveToStation(ax, ay, bx, by, offsets, sx, sy);
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
  }

  function handlePointerMove(evt) {
    if (!dragState) return;
    const p = screenToSVG(evt);

    if (dragState.type === "curve") {
      const { key, a, b, pointIndex } = dragState;
      const [ax, ay] = displayMap.stations[a];
      const [bx, by] = displayMap.stations[b];
      const { nx, ny } = perpendicular(ax, ay, bx, by);
      const existing = normalizeCurveOffsets(curveDraft[key]) || [0];
      const k = existing.length;
      const t = (pointIndex + 1) / (k + 1);
      const baseX = ax + (bx - ax) * t;
      const baseY = ay + (by - ay) * t;
      // Project the drag point onto the edge's normal direction to get
      // the equivalent offset value -- this is the whole trick that
      // turns "drag a handle" into "the same offset number the map data
      // already uses," with no separate representation to keep in sync.
      const offset = (p.x - baseX) * nx + (p.y - baseY) * ny;
      const nextOffsets = existing.slice();
      nextOffsets[pointIndex] = Math.round(offset * 100) / 100;
      const toStore = nextOffsets.length === 1 ? nextOffsets[0] : nextOffsets;
      setCurveDraft((prev) => ({ ...prev, [key]: toStore }));
      checkCurveClearance(a, b, nextOffsets);
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
    if (selectedEdge === key) setSelectedEdge(null);
  }

  function addCurvePoint(key) {
    setCurveDraft((prev) => {
      const existing = normalizeCurveOffsets(prev[key]) || [0];
      if (existing.length >= MAX_CURVE_POINTS) return prev;
      // Insert a new point at the midpoint value of its two nearest
      // neighbors so it starts roughly on the existing curve, not at 0
      // (which would visually kink the line at the moment it's added).
      const mid = existing.length ? existing[Math.floor(existing.length / 2)] : 0;
      const next = existing.slice();
      next.splice(Math.ceil(next.length / 2), 0, mid);
      return { ...prev, [key]: next };
    });
  }

  function removeCurvePoint(key, pointIndex) {
    setCurveDraft((prev) => {
      const existing = normalizeCurveOffsets(prev[key]) || [0];
      if (existing.length <= 1) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const next = existing.slice();
      next.splice(pointIndex, 1);
      return { ...prev, [key]: next };
    });
  }

  function startStationDrag(evt, id) {
    evt.stopPropagation();
    setSelectedEdge(null);
    setDragState({ type: "station", id });
  }

  function selectStation(evt, id) {
    evt.stopPropagation();
    setSelectedEdge(null);
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
      setSelectedEdge(null);
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

  const curveEditCount = Object.keys(curveDraft).length;
  const stationEditCount = Object.keys(stationDraft).length;
  const hasUnsavedChanges = curveEditCount > 0 || stationEditCount > 0;

  const selectedEdgePoints = selectedEdge != null ? (normalizeCurveOffsets(curveDraft[selectedEdge]) || [0]).length : 0;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Map Editor</h1>
          <div style={styles.subtitle}>Visual, drag-to-adjust map tuning — safe by design</div>
        </div>
        <button style={styles.backBtn} onClick={onBack}>
          ← Back to Admin
        </button>
      </div>

      {err && <div style={styles.errText}>{err}</div>}
      {saved && <div style={styles.savedBanner}>✓ {saved}</div>}

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

      <div style={styles.helpBar}>
        <span style={styles.helpIcon}>i</span>
        <span>
          <strong>Curves:</strong> drag a white handle to bend a route. Click a curve to select it, then add up to
          3 handles for long, S-shaped routes. <strong>Stations:</strong> drag a small nudge, or click to rename /
          relabel. Nothing here can change connectivity, tickets, or round timing, and nothing is live for players
          until you hit <strong>Save</strong>.
        </span>
      </div>

      <div style={styles.body}>
        <div style={styles.canvasCard}>
          <div style={styles.canvasToolbar}>
            <div style={styles.zoomGroup}>
              <button style={styles.zoomBtn} onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))} disabled={zoom <= 1}>
                −
              </button>
              <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
              <button style={styles.zoomBtn} onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))} disabled={zoom >= 2.5}>
                +
              </button>
            </div>
            {selectedEdge && (
              <div style={styles.edgeToolbar}>
                <span style={styles.edgeToolbarLabel}>Curve {selectedEdge}: {selectedEdgePoints} point{selectedEdgePoints === 1 ? "" : "s"}</span>
                <button
                  style={styles.smallActionBtn}
                  onClick={() => addCurvePoint(selectedEdge)}
                  disabled={selectedEdgePoints >= MAX_CURVE_POINTS}
                  title="Add another bend point to this route"
                >
                  + Add point
                </button>
                <button style={styles.smallActionBtn} onClick={() => resetCurve(selectedEdge)}>
                  Reset curve
                </button>
              </div>
            )}
          </div>

          <div style={styles.canvasWrap}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${viewW} ${viewH}`}
              style={{ ...styles.svg, transform: `scale(${zoom})` }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onClick={() => {
                setSelectedEdge(null);
                setSelectedStation(null);
              }}
            >
              <rect x="0" y="0" width={viewW} height={viewH} fill="#f6f1e5" />

              {displayMap.edges.map(([a, b, mode], i) => {
                const key = `${a}-${b}-${mode}-${i}`;
                const gKey = edgeKey(a, b);
                const group = displayMap.edgeGroups?.[gKey] || [mode];
                const canManuallyCurve = group.length === 1; // multi-mode parallel edges use automatic spacing -- see file header comment
                const manualOffset = displayMap.manualCurveOffsets?.[gKey];
                const offsets = normalizeCurveOffsets(manualOffset) || [0];
                const [ax, ay] = displayMap.stations[a];
                const [bx, by] = displayMap.stations[b];
                const pathD = curvePathD(ax, ay, bx, by, manualOffset != null ? manualOffset : 0);
                const color = MODE_COLORS[mode] || "#a0740d";
                const isEdgeSelected = selectedEdge === gKey;
                const handlePts = canManuallyCurve ? curveControlPoints(ax, ay, bx, by, offsets) : [];

                return (
                  <g key={key}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={isEdgeSelected ? color : color}
                      strokeWidth={isEdgeSelected ? 0.55 : 0.35}
                      opacity={isEdgeSelected ? 0.95 : 0.7}
                      style={{ cursor: canManuallyCurve ? "pointer" : "default" }}
                      onClick={(e) => {
                        if (!canManuallyCurve) return;
                        e.stopPropagation();
                        setSelectedStation(null);
                        setSelectedEdge(gKey);
                      }}
                    />
                    {isEdgeSelected && (
                      <path d={`M ${ax} ${ay} L ${bx} ${by}`} stroke="#2937c9" strokeWidth={0.12} strokeDasharray="0.6,0.6" opacity={0.5} />
                    )}
                    {canManuallyCurve &&
                      handlePts.map((pt) => (
                        <g key={pt.index}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isEdgeSelected ? 1.35 : 1.0}
                            fill={isEdgeSelected ? "#2937c9" : "#fff"}
                            stroke={isEdgeSelected ? "#fff" : "#666"}
                            strokeWidth={0.3}
                            style={{ cursor: "grab" }}
                            onPointerDown={(e) => startCurveDrag(e, gKey, a, b, pt.index)}
                          />
                          {isEdgeSelected && offsets.length > 1 && (
                            <text
                              x={pt.x}
                              y={pt.y - 2}
                              fontSize="1.4"
                              textAnchor="middle"
                              fill="#2937c9"
                              pointerEvents="none"
                              style={{ fontWeight: 700 }}
                            >
                              {pt.index + 1}
                            </text>
                          )}
                        </g>
                      ))}
                  </g>
                );
              })}

              {Object.entries(displayMap.stations).map(([idStr, [x, y]]) => {
                const id = Number(idStr);
                const isSelected = selectedStation === id;
                const isChanged = !!stationDraft[id];
                return (
                  <g key={id}>
                    <circle
                      cx={x}
                      cy={y}
                      r={isSelected ? 2.0 : 1.6}
                      fill={isSelected ? "#2937c9" : isChanged ? "#fff4de" : "#fff"}
                      stroke={isSelected ? "#2937c9" : isChanged ? "#c98a1f" : "#8a8375"}
                      strokeWidth={isSelected ? 0.45 : 0.35}
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
            {warning && <div style={styles.warningBar}>⚠ {warning}</div>}
          </div>
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
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={!!selectedIsMajor}
                  onChange={(e) => updateStationField(selectedStation, "isMajor", e.target.checked)}
                />
                Always show label (major station)
              </label>
              <div style={styles.configLabelPlain}>Label direction</div>
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
              <button style={styles.smallBtn} onClick={() => resetStation(selectedStation)}>
                Reset this station to default
              </button>
              <button style={{ ...styles.smallBtn, marginTop: 6 }} onClick={() => setSelectedStation(null)}>
                Deselect
              </button>
            </div>
          ) : selectedEdge != null ? (
            <div>
              <div style={styles.sideTitle}>Curve {selectedEdge}</div>
              <div style={styles.smallNote}>
                {selectedEdgePoints} handle{selectedEdgePoints === 1 ? "" : "s"}. Drag a numbered handle on the map
                to bend the route at that point. Longer routes look best with 2-3 handles for a smooth S-shape.
              </div>
              <button
                style={styles.smallBtn}
                onClick={() => addCurvePoint(selectedEdge)}
                disabled={selectedEdgePoints >= MAX_CURVE_POINTS}
              >
                + Add another handle ({selectedEdgePoints}/{MAX_CURVE_POINTS})
              </button>
              {selectedEdgePoints > 1 && (
                <div style={{ marginTop: 8 }}>
                  {Array.from({ length: selectedEdgePoints }).map((_, idx) => (
                    <button key={idx} style={{ ...styles.smallBtn, marginTop: 6 }} onClick={() => removeCurvePoint(selectedEdge, idx)}>
                      Remove handle {idx + 1}
                    </button>
                  ))}
                </div>
              )}
              <button style={{ ...styles.smallBtn, marginTop: 6 }} onClick={() => resetCurve(selectedEdge)}>
                Reset this curve to default
              </button>
              <button style={{ ...styles.smallBtn, marginTop: 6 }} onClick={() => setSelectedEdge(null)}>
                Deselect
              </button>
            </div>
          ) : (
            <div style={styles.emptyState}>
              <div style={styles.emptyStateIcon}>✎</div>
              <div style={styles.smallNote}>Click a station or a route curve on the map to edit it.</div>
            </div>
          )}

          <div style={styles.divider} />

          <div style={styles.sideTitle}>Unsaved edits</div>
          <div style={styles.editSummaryRow}>
            <span style={styles.editSummaryPill}>{curveEditCount} curve{curveEditCount === 1 ? "" : "s"}</span>
            <span style={styles.editSummaryPill}>{stationEditCount} station{stationEditCount === 1 ? "" : "s"}</span>
          </div>
          {savedOverride && <div style={styles.smallNote}>Compared to what's already saved.</div>}
          {curveEditCount > 0 && (
            <div style={{ marginTop: 6 }}>
              {Object.entries(curveDraft).map(([key, val]) => {
                const arr = normalizeCurveOffsets(val) || [];
                return (
                  <div key={key} style={styles.editedRow}>
                    <span>
                      {key}: {arr.join(", ")}
                    </span>
                    <button style={styles.tinyBtn} onClick={() => resetCurve(key)}>
                      reset
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button style={styles.saveBtn} onClick={handleSave} disabled={busy || !hasUnsavedChanges}>
            {busy ? "Saving..." : "Save changes"}
          </button>
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
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  title: { margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.3 },
  subtitle: { fontSize: 12.5, color: "#8a8375", marginTop: 2 },
  backBtn: { border: "1.5px solid #ddd", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", fontWeight: 600 },
  mapPicker: { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  mapPill: { border: "1.5px solid #ddd", background: "#fff", borderRadius: 20, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.12s" },
  mapPillActive: { background: "#111", color: "#fff", borderColor: "#111" },
  helpBar: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    fontSize: 12.5,
    color: "#5c5648",
    lineHeight: 1.6,
    marginBottom: 14,
    background: "#eef1fb",
    border: "1px solid #d6ddf5",
    borderRadius: 10,
    padding: "10px 14px",
  },
  helpIcon: {
    flexShrink: 0,
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#2937c9",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    fontStyle: "italic",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  smallNote: { fontSize: 12, color: "#8a8375", marginBottom: 10, lineHeight: 1.5 },
  body: { display: "flex", gap: 16, alignItems: "flex-start" },
  canvasCard: { flex: 1, background: "#fff", borderRadius: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", overflow: "hidden" },
  canvasToolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: "1px solid #f0eee8",
    gap: 10,
    flexWrap: "wrap",
  },
  zoomGroup: { display: "flex", alignItems: "center", gap: 8 },
  zoomBtn: { width: 26, height: 26, borderRadius: 6, border: "1px solid #ddd", background: "#fafafa", fontSize: 15, cursor: "pointer", lineHeight: 1 },
  zoomLabel: { fontSize: 12, color: "#8a8375", minWidth: 40, textAlign: "center" },
  edgeToolbar: { display: "flex", alignItems: "center", gap: 8, background: "#eef1fb", borderRadius: 8, padding: "5px 10px" },
  edgeToolbarLabel: { fontSize: 12, fontWeight: 600, color: "#2937c9" },
  smallActionBtn: { border: "1px solid #c7d0f2", background: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 11.5, fontWeight: 600, color: "#2937c9", cursor: "pointer" },
  canvasWrap: { position: "relative", padding: 14, overflow: "auto" },
  svg: { width: "100%", height: "auto", aspectRatio: "1 / 1", background: "#fff", touchAction: "none", transformOrigin: "center center" },
  warningBar: {
    position: "absolute",
    bottom: 22,
    left: 22,
    right: 22,
    background: "#fdecea",
    color: "#a33",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid #e0a8a8",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  sidePanel: { width: 280, flexShrink: 0, background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", position: "sticky", top: 20 },
  sideTitle: { fontWeight: 700, fontSize: 14, marginBottom: 10 },
  emptyState: { textAlign: "center", padding: "20px 10px" },
  emptyStateIcon: { fontSize: 22, color: "#c7c2b3", marginBottom: 6 },
  configLabel: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "#555", fontWeight: 600, marginBottom: 12 },
  configLabelPlain: { fontSize: 12.5, color: "#555", fontWeight: 600, marginBottom: 6 },
  configInput: { padding: "9px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13 },
  checkboxLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#555", fontWeight: 600, marginBottom: 12, cursor: "pointer" },
  dirGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginBottom: 14 },
  dirBtn: { border: "1px solid #ddd", background: "#fafafa", borderRadius: 6, padding: "6px 0", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  dirBtnActive: { background: "#2937c9", color: "#fff", borderColor: "#2937c9" },
  divider: { borderTop: "1px solid #f0eee8", margin: "16px 0" },
  editSummaryRow: { display: "flex", gap: 6, marginBottom: 6 },
  editSummaryPill: { fontSize: 11.5, fontWeight: 700, color: "#2937c9", background: "#eef1fb", borderRadius: 12, padding: "3px 10px" },
  editedRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, padding: "4px 0", color: "#555", gap: 6 },
  tinyBtn: { border: "1px solid #ddd", background: "#fff", borderRadius: 5, padding: "2px 7px", fontSize: 10.5, cursor: "pointer", flexShrink: 0 },
  saveBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
    marginTop: 16,
  },
  smallBtn: { border: "1px solid #ddd", background: "#fff", borderRadius: 7, padding: "8px 10px", fontSize: 12, cursor: "pointer", width: "100%", fontWeight: 600 },
  errText: { fontSize: 13, color: "#c0392b", background: "#fdecea", borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
  savedBanner: { fontSize: 13, color: "#1e8e5a", background: "#e8f7f0", border: "1px solid #b9e6cf", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontWeight: 600 },
};
