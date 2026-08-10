import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MAP_LIST } from "../maps/index.js";
import * as auth from "../lib/accessControlApi.js";
import { applyMapOverride } from "../lib/useMapWithOverrides.js";
import { curvePathD, curveControlPoints, sampleCurvePoints, normalizeCurveOffsets } from "../lib/curveGeometry.js";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import DecorationsLayer, { DecorationItem } from "./DecorationsLayer.jsx";
import { ICON_LIBRARY, ICON_LABELS, ICON_CATEGORIES, renderIconPaths } from "../lib/decorationIcons.jsx";

// ---------------------------------------------------------------------------
// MAP EDITOR PANEL — lets an admin visually drag a route's curve (like
// bending a line in a slide editor) instead of hand-computing an offset
// number, plus small, deliberately-LOW-RISK station adjustments
// (reposition a little, relabel, rename, toggle prominence). Everything
// here only ever changes how the map LOOKS -- never which stations
// exist, which edges connect them, or any ticket/round-timing value.
//
// Renders with the EXACT SAME background art, edge casing/width/opacity,
// and station styling as GameBoard.jsx (same MapBackground/
// MapFrameAndCompass components, same MODE_DEFAULT/modeTheme colors,
// same nodeR/strokeW constants) -- previously this screen used its own
// flat placeholder background and generic colors, which made it look
// like a completely different map from the one players actually see.
// Now what the admin edits against IS what the admin (and everyone
// else) sees elsewhere.
//
// Curve handles are deliberately small (design-tool anchor-point sized,
// not station-sized) so they read as editing chrome rather than as part
// of the map art, with an inline "+" button riding along the selected
// curve to add another bend point and a small "×" per handle to remove
// just that one -- both directly on the canvas next to the handle
// itself, not buried only in the side panel, so multi-point curves are
// obviously available the moment a curve is selected.
// ---------------------------------------------------------------------------

const CLEARANCE_WARN_DISTANCE = 4.2; // matches the min-gap standard used across this project's map validation
const MAX_STATION_NUDGE = 8; // units -- keeps station repositioning to "small adjustment," not a redesign
const MAX_CURVE_POINTS = 3;
const LABEL_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const NODE_R = 1.6; // matches GameBoard.jsx's own station radius exactly
const HANDLE_R = 0.65; // small, design-tool-anchor sized -- not station-sized
const HANDLE_R_SELECTED = 0.85;
const MAX_DECORATIONS = 60; // matches the server-side cap in set_map_visual_overrides
const SHAPE_LIST = ["rect", "circle", "line"];
const SHAPE_LABELS = { rect: "Rectangle", circle: "Circle", line: "Line" };
// Presets chosen to sit comfortably behind every mode color on every map
// (light, low-saturation) -- a background this light never fights the
// route colors for attention, the same principle the maps' own default
// parchment tone (#f6f1e5) was tuned around.
const BACKGROUND_PRESETS = [
  { label: "Default", value: null },
  { label: "Parchment", value: "#f6f1e5" },
  { label: "Cool grey", value: "#eef0f2" },
  { label: "Sage", value: "#eef3e5" },
  { label: "Sand", value: "#f3ecd9" },
  { label: "Sky", value: "#e8f0f6" },
  { label: "Blush", value: "#f6ebe9" },
];
function makeDecorationId() {
  return `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  const [selectedEdge, setSelectedEdge] = useState(null); // edge key of the curve currently focused
  const [hoveredEdge, setHoveredEdge] = useState(null);
  // "edit" = curves + stations (the original tool); "decorate" = the new
  // icons/shapes/text/background beautification layer. Kept as separate
  // modes (rather than one giant always-on canvas) so the canvas's click/
  // drag behavior is never ambiguous about which kind of thing you're
  // about to grab.
  const [editorMode, setEditorMode] = useState("edit"); // named editorMode (not "mode") to avoid shadowing the per-edge transport "mode" variable used throughout this file's edge-rendering code
  const [decorationDraft, setDecorationDraft] = useState([]); // ordered array, same shape saved to the server
  const [backgroundDraft, setBackgroundDraft] = useState(null);
  const [selectedDecorationId, setSelectedDecorationId] = useState(null);
  const [placementTool, setPlacementTool] = useState(null); // {type:"icon",icon} | {type:"shape",shape} | {type:"text"} -- armed, next canvas click places it
  const [iconCategory, setIconCategory] = useState(Object.keys(ICON_CATEGORIES)[0]); // which icon category tab is showing in the palette -- 48 icons is too many for one flat grid
  const [dragState, setDragState] = useState(null); // { type: "curve"|"station"|"decoration", key/id, pointIndex }
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
      // Seed the draft with whatever's ACTUALLY in effect right now: the
      // admin's saved override if one exists, otherwise the map's own
      // built-in default decorations (rawMap.decorations -- landmarks like
      // the lake/airport/parks are ordinary defaults now, not separate
      // fixed art). Without this fallback the editor's canvas would show
      // ZERO decorations on first load even though players see the full
      // set, and hitting Save for an unrelated reason (e.g. nudging a
      // curve) would wipe every default landmark for all players.
      setDecorationDraft(existing?.decorations ?? rawMap?.decorations ?? []);
      setBackgroundDraft(existing?.backgroundOverrideColor || null);
    } catch (e) {
      setErr(e.message);
    }
  }, [mapId]);

  useEffect(() => {
    setSelectedStation(null);
    setSelectedEdge(null);
    setSelectedDecorationId(null);
    setPlacementTool(null);
    setEditorMode("edit");
    setWarning("");
    setZoom(1);
    loadOverrides();
  }, [loadOverrides]);

  // Live preview: rawMap merged with whatever's currently in the drafts,
  // via the SAME applyMapOverride every other part of the app uses.
  const displayMap = useMemo(() => {
    if (!rawMap) return null;
    return applyMapOverride(rawMap, {
      curveOffsetOverrides: curveDraft,
      stationOverrides: stationDraft,
      decorations: decorationDraft,
      backgroundOverrideColor: backgroundDraft,
    });
  }, [rawMap, curveDraft, stationDraft, decorationDraft, backgroundDraft]);

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

  const activeMode = displayMap.modeTheme || MODE_DEFAULT;
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
      // Same baseline fallback as addCurvePoint -- if this edge hasn't
      // been touched by the admin yet this session, the point count/
      // positions must come from the map's own default curve, not [0].
      const baseline = curveDraft[key] !== undefined ? curveDraft[key] : rawMap?.manualCurveOffsets?.[key];
      const existing = normalizeCurveOffsets(baseline) || [0];
      const k = existing.length;
      const t = (pointIndex + 1) / (k + 1);
      const baseX = ax + (bx - ax) * t;
      const baseY = ay + (by - ay) * t;
      const offset = (p.x - baseX) * nx + (p.y - baseY) * ny;
      const nextOffsets = existing.slice();
      nextOffsets[pointIndex] = Math.round(offset * 100) / 100;
      const toStore = nextOffsets.length === 1 ? nextOffsets[0] : nextOffsets;
      setCurveDraft((prev) => ({ ...prev, [key]: toStore }));
      checkCurveClearance(a, b, nextOffsets);
    } else if (dragState.type === "station") {
      const { id } = dragState;
      const [origX, origY] = rawMap.stations[id];
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
    } else if (dragState.type === "decoration") {
      const { id } = dragState;
      setDecorationDraft((prev) => prev.map((d) => (d.id === id ? { ...d, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 } : d)));
    }
  }

  function handlePointerUp() {
    setDragState(null);
    setWarning("");
  }

  // ---- decorations (icons/shapes/text/background) ----------------------
  function placeDecorationAt(evt) {
    if (!placementTool) return;
    const p = screenToSVG(evt);
    if (decorationDraft.length >= MAX_DECORATIONS) {
      setErr(`This map already has the maximum of ${MAX_DECORATIONS} decorations.`);
      setPlacementTool(null);
      return;
    }
    const base = {
      id: makeDecorationId(),
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      rotation: 0,
      opacity: 1,
      color: "#5c5648",
    };
    let created;
    if (placementTool.type === "icon") {
      created = { ...base, type: "icon", icon: placementTool.icon, size: 6 };
    } else if (placementTool.type === "shape") {
      created = { ...base, type: "shape", shape: placementTool.shape, w: 8, h: 8, strokeWidth: 0, color: "#9dc48a" };
    } else if (placementTool.type === "text") {
      created = { ...base, type: "text", text: "Label", fontSize: 2.5 };
    } else {
      return;
    }
    setDecorationDraft((prev) => [...prev, created]);
    setSelectedDecorationId(created.id);
    setPlacementTool(null);
  }

  function startDecorationDrag(evt, id) {
    evt.stopPropagation();
    setSelectedDecorationId(id);
    setDragState({ type: "decoration", id });
  }

  function selectDecoration(evt, id) {
    evt.stopPropagation();
    setSelectedDecorationId(id);
  }

  function updateDecoration(id, fields) {
    setDecorationDraft((prev) => prev.map((d) => (d.id === id ? { ...d, ...fields } : d)));
  }

  function removeDecoration(id) {
    setDecorationDraft((prev) => prev.filter((d) => d.id !== id));
    if (selectedDecorationId === id) setSelectedDecorationId(null);
  }

  // Layer order = array order (index 0 painted first/furthest back).
  // "Send backward"/"Bring forward" swap the item with its neighbor,
  // same one-step-at-a-time convention as PowerPoint's arrow buttons.
  function moveDecorationLayer(id, direction) {
    setDecorationDraft((prev) => {
      const idx = prev.findIndex((d) => d.id === id);
      if (idx === -1) return prev;
      const swapWith = direction === "back" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
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
      // Fall back to the map's own default bend (rawMap.manualCurveOffsets)
      // when this edge has no admin override yet -- otherwise the first
      // "+Add point" click on an edge that already has a real default
      // curve would silently reset it to straight (0) before adding.
      const baseline = prev[key] !== undefined ? prev[key] : rawMap?.manualCurveOffsets?.[key];
      const existing = normalizeCurveOffsets(baseline) || [0];
      if (existing.length >= MAX_CURVE_POINTS) return prev;
      const insertAt = Math.ceil(existing.length / 2);
      const neighborLeft = existing[insertAt - 1] ?? 0;
      const neighborRight = existing[insertAt] ?? neighborLeft;
      const mid = (neighborLeft + neighborRight) / 2;
      // Nudge the new point's offset away from its neighbor's value when
      // they'd otherwise match exactly (e.g. adding a 2nd point to a
      // perfectly straight edge would put both points AT 0 -- invisible,
      // sitting right on the baseline). Without this, a freshly-added
      // point is indistinguishable from "no point at all", which is what
      // made removing/re-adding points look like nothing was happening.
      const nudge = Math.abs(neighborLeft - neighborRight) > 0.5 ? 0 : 1.5;
      const next = existing.slice();
      next.splice(insertAt, 0, Math.round((mid + nudge) * 100) / 100);
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
      // Only send decorations as an explicit override if the admin actually
      // changed something this session. If untouched, keep sending whatever
      // was already saved (null if there was no prior override) -- NOT the
      // draft, which is seeded from the map's own defaults purely for
      // preview purposes. Otherwise every save (even one that only moved a
      // curve) would freeze the current defaults into the DB forever,
      // silently ignoring any future code changes to the map's landmarks.
      const decorationsToSave = decorationsChanged ? decorationDraft : (savedOverride?.decorations ?? null);
      await auth.setMapVisualOverrides({
        callerAccountId: accountId,
        mapId,
        curveOffsetOverrides: curvesToSave,
        stationOverrides: stationsToSave,
        decorations: decorationsToSave,
        backgroundOverrideColor: backgroundDraft,
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
      await auth.setMapVisualOverrides({
        callerAccountId: accountId,
        mapId,
        curveOffsetOverrides: null,
        stationOverrides: null,
        decorations: null,
        backgroundOverrideColor: null,
      });
      setCurveDraft({});
      setStationDraft({});
      setDecorationDraft(rawMap?.decorations ?? []); // reset means "back to the map's own defaults", not "zero decorations"
      setBackgroundDraft(null);
      setSelectedEdge(null);
      setSelectedDecorationId(null);
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
  // Baseline = whatever's actually in effect right now (saved override if
  // one exists, else the map's own built-in defaults) -- NOT just "[]" --
  // so simply loading the editor (draft seeded from defaults) doesn't
  // read as an unsaved change.
  const baselineDecorationsJSON = JSON.stringify(savedOverride?.decorations ?? rawMap?.decorations ?? []);
  const draftDecorationsJSON = JSON.stringify(decorationDraft);
  const decorationsChanged = baselineDecorationsJSON !== draftDecorationsJSON;
  const backgroundChanged = (savedOverride?.backgroundOverrideColor || null) !== backgroundDraft;
  const hasUnsavedChanges = curveEditCount > 0 || stationEditCount > 0 || decorationsChanged || backgroundChanged;
  const selectedDecoration = decorationDraft.find((d) => d.id === selectedDecorationId) || null;

  const selectedEdgeBaseline = selectedEdge != null && curveDraft[selectedEdge] !== undefined ? curveDraft[selectedEdge] : rawMap?.manualCurveOffsets?.[selectedEdge];
  const selectedEdgePoints = selectedEdge != null ? (normalizeCurveOffsets(selectedEdgeBaseline) || [0]).length : 0;

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

      <div style={styles.modeTabs}>
        <button
          style={{ ...styles.modeTab, ...(editorMode === "edit" ? styles.modeTabActive : {}) }}
          onClick={() => {
            setEditorMode("edit");
            setSelectedDecorationId(null);
            setPlacementTool(null);
          }}
        >
          Curves &amp; Stations
        </button>
        <button
          style={{ ...styles.modeTab, ...(editorMode === "decorate" ? styles.modeTabActive : {}) }}
          onClick={() => {
            setEditorMode("decorate");
            setSelectedStation(null);
            setSelectedEdge(null);
          }}
        >
          Decorate
        </button>
      </div>

      <div style={styles.helpBar}>
        <span style={styles.helpIcon}>i</span>
        {editorMode === "edit" ? (
          <span>
            Click any route to select it, then drag its small circular handle to bend it — a <strong>+</strong>{" "}
            button appears next to the handle so you can add up to 3 bend points for a smooth S-curve on longer
            routes. Drag a station a little to nudge its position, or click it to rename/relabel. Nothing here can
            change connectivity, tickets, or round timing, and nothing is live for players until you hit{" "}
            <strong>Save</strong>.
          </span>
        ) : (
          <span>
            Pick an icon, shape, or text from the palette, then click anywhere on the map to place it. Drag a
            placed item to move it, use the layer list to send it forward/backward, and set a background color for
            the whole map. Purely decorative — never affects gameplay — and nothing is live until you hit{" "}
            <strong>Save</strong>.
          </span>
        )}
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
                <span style={styles.edgeToolbarLabel}>
                  {selectedEdgePoints} bend point{selectedEdgePoints === 1 ? "" : "s"}
                </span>
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
              viewBox={`-1 -1.5 ${viewW + 2} ${viewH + 2.5}`}
              style={{ ...styles.svg, transform: `scale(${zoom})`, cursor: placementTool ? "crosshair" : "default" }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onClick={(e) => {
                if (editorMode === "decorate" && placementTool) {
                  placeDecorationAt(e);
                  return;
                }
                setSelectedEdge(null);
                setSelectedStation(null);
                setSelectedDecorationId(null);
              }}
            >
              <defs>
                <linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#bcdcea" />
                  <stop offset="100%" stopColor="#a7cede" />
                </linearGradient>
                <radialGradient id="lakeGrad" cx="50%" cy="40%" r="65%">
                  <stop offset="0%" stopColor="#7aa8c7" />
                  <stop offset="100%" stopColor="#5f93b8" />
                </radialGradient>
                <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#a8cbdb" />
                  <stop offset="100%" stopColor="#88b3c9" />
                </linearGradient>
                <filter id="regionShadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0.4" stdDeviation="0.6" floodColor="#3d4a3a" floodOpacity="0.18" />
                </filter>
              </defs>

              {/* Same background art the actual game renders -- this is
                  what makes the editor look like the real map instead of
                  a generic placeholder. */}
              <MapBackground map={displayMap} />
              <MapFrameAndCompass map={displayMap} />

              {/* Decorations layer: read-only (via the same shared
                  DecorationsLayer GameBoard/ReplayView use) while editing
                  curves/stations, so it's visible as context but never
                  gets in the way of route/station clicks; swapped for an
                  interactive, selectable/draggable version in Decorate
                  mode. Always painted before edges/stations either way,
                  matching the "always behind transit" rule everywhere
                  else. */}
              {editorMode === "edit" ? (
                <DecorationsLayer decorations={decorationDraft} />
              ) : (
                <g>
                  {decorationDraft.map((d, idx) => {
                    const isSelected = selectedDecorationId === d.id;
                    return (
                      <g key={d.id}>
                        <DecorationItem d={d} />
                        {/* Invisible generous hit-target + selection ring,
                            drawn on top so a thin shape/line is still easy
                            to grab and a selected item is obviously
                            outlined. */}
                        <circle
                          cx={d.x}
                          cy={d.y}
                          r={Math.max(2.2, (d.size || d.w || d.fontSize || 6) / 2 + 1)}
                          fill="transparent"
                          stroke={isSelected ? "#2937c9" : "transparent"}
                          strokeWidth={0.25}
                          strokeDasharray={isSelected ? "0.8,0.6" : undefined}
                          style={{ cursor: "grab" }}
                          onPointerDown={(e) => startDecorationDrag(e, d.id)}
                          onClick={(e) => selectDecoration(e, d.id)}
                        />
                        {isSelected && (
                          <text x={d.x} y={d.y - Math.max(2.2, (d.size || d.w || d.fontSize || 6) / 2) - 1} fontSize="1.1" textAnchor="middle" fill="#2937c9" pointerEvents="none" fontWeight={700}>
                            {idx + 1}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {displayMap.edges.map(([a, b, mode], i) => {
                const key = `${a}-${b}-${mode}-${i}`;
                const gKey = edgeKey(a, b);
                const group = displayMap.edgeGroups?.[gKey] || [mode];
                const canManuallyCurve = group.length === 1; // multi-mode parallel edges use automatic spacing, not manual curves
                const manualOffset = displayMap.manualCurveOffsets?.[gKey];
                const offsets = normalizeCurveOffsets(manualOffset) || [0];
                const [ax, ay] = displayMap.stations[a];
                const [bx, by] = displayMap.stations[b];
                const pathD = curvePathD(ax, ay, bx, by, manualOffset != null ? manualOffset : 0);
                const modeInfo = activeMode[mode] || MODE_DEFAULT.taxi;
                const isEdgeSelected = selectedEdge === gKey;
                const isEdgeHovered = hoveredEdge === gKey && !isEdgeSelected;
                const handlePts = canManuallyCurve ? curveControlPoints(ax, ay, bx, by, offsets) : [];
                // Same width/opacity convention GameBoard.jsx uses, so a
                // route reads with the same visual weight here as in an
                // actual game -- just with an extra highlight state for
                // whichever curve is currently selected/hovered.
                const strokeW = mode === "underground" ? 0.5 : mode === "bus" ? 0.35 : mode === "ferry" ? 0.22 : 0.32;
                const baseOpacity = mode === "ferry" ? 0.4 : 0.85;

                return (
                  <g key={key}>
                    <path d={pathD} fill="none" stroke="#ffffff" strokeWidth={strokeW + 0.35} strokeLinecap="round" opacity={0.9} />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={modeInfo.color}
                      strokeWidth={isEdgeSelected ? strokeW + 0.25 : strokeW}
                      strokeLinecap="round"
                      opacity={isEdgeSelected ? 1 : isEdgeHovered ? 0.95 : baseOpacity}
                    />
                    {/* Wide, invisible hit-target so a thin route is still
                        easy to click without needing to hit the visible
                        line pixel-perfectly. */}
                    {canManuallyCurve && (
                      <path
                        d={pathD}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={2.2}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHoveredEdge(gKey)}
                        onMouseLeave={() => setHoveredEdge((h) => (h === gKey ? null : h))}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedStation(null);
                          setSelectedEdge(gKey);
                        }}
                      />
                    )}
                    {isEdgeSelected && (
                      <path d={`M ${ax} ${ay} L ${bx} ${by}`} stroke="#2937c9" strokeWidth={0.1} strokeDasharray="0.5,0.5" opacity={0.4} />
                    )}
                    {canManuallyCurve &&
                      handlePts.map((pt) => (
                        <g key={pt.index}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isEdgeSelected ? HANDLE_R_SELECTED : HANDLE_R}
                            fill={isEdgeSelected ? "#2937c9" : "#fff"}
                            stroke={isEdgeSelected ? "#fff" : "#2937c9"}
                            strokeWidth={0.22}
                            style={{ cursor: "grab", filter: "drop-shadow(0 0.15px 0.4px rgba(0,0,0,0.35))" }}
                            onPointerDown={(e) => startCurveDrag(e, gKey, a, b, pt.index)}
                            // The browser fires a synthetic "click" AFTER
                            // pointerup on the same element, as a totally
                            // separate event -- stopPropagation() on
                            // pointerdown does NOT stop it. Without this,
                            // that click bubbles up to the canvas's
                            // click-empty-space-to-deselect handler and
                            // immediately clears the selection the instant
                            // you let go of a handle, which is exactly the
                            // "options disappear the moment I unhold"
                            // symptom this fixes.
                            onClick={(e) => e.stopPropagation()}
                          />
                          {isEdgeSelected && offsets.length > 1 && (
                            <text x={pt.x} y={pt.y - 1.15} fontSize="1.1" textAnchor="middle" fill="#2937c9" pointerEvents="none" style={{ fontWeight: 700 }}>
                              {pt.index + 1}
                            </text>
                          )}
                          {/* Inline remove control per handle -- only once
                              there's more than one point, so a single
                              default handle can't be accidentally deleted
                              down to "no curve at all" from the canvas. */}
                          {isEdgeSelected && offsets.length > 1 && (
                            <g
                              transform={`translate(${pt.x + 1.3}, ${pt.y - 1.3})`}
                              style={{ cursor: "pointer" }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                removeCurvePoint(gKey, pt.index);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <circle r={0.55} fill="#fff" stroke="#c0392b" strokeWidth={0.18} />
                              <line x1={-0.28} y1={-0.28} x2={0.28} y2={0.28} stroke="#c0392b" strokeWidth={0.18} strokeLinecap="round" />
                              <line x1={-0.28} y1={0.28} x2={0.28} y2={-0.28} stroke="#c0392b" strokeWidth={0.18} strokeLinecap="round" />
                            </g>
                          )}
                        </g>
                      ))}
                    {/* Inline "add point" control -- rides along just past
                        the last handle on the selected curve, so growing
                        to a multi-point curve is one click right where
                        you're already looking, not a trip to the sidebar. */}
                    {isEdgeSelected && canManuallyCurve && offsets.length < MAX_CURVE_POINTS && handlePts.length > 0 && (
                      <g
                        transform={`translate(${handlePts[handlePts.length - 1].x}, ${handlePts[handlePts.length - 1].y - 2.6})`}
                        style={{ cursor: "pointer" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          addCurvePoint(gKey);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <circle r={0.7} fill="#2937c9" stroke="#fff" strokeWidth={0.2} style={{ filter: "drop-shadow(0 0.15px 0.4px rgba(0,0,0,0.35))" }} />
                        <line x1={-0.35} y1={0} x2={0.35} y2={0} stroke="#fff" strokeWidth={0.2} strokeLinecap="round" />
                        <line x1={0} y1={-0.35} x2={0} y2={0.35} stroke="#fff" strokeWidth={0.2} strokeLinecap="round" />
                      </g>
                    )}
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
                      r={isSelected ? NODE_R + 0.3 : NODE_R}
                      fill={isSelected ? "#2937c9" : isChanged ? "#fff4de" : "#fff"}
                      stroke={isSelected ? "#2937c9" : isChanged ? "#c98a1f" : "#8a8375"}
                      strokeWidth={isSelected ? 0.45 : 0.35}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => startStationDrag(e, id)}
                      onClick={(e) => selectStation(e, id)}
                    />
                    <text x={x} y={y + 0.55} fontSize="1.35" textAnchor="middle" fill="#5c5648" pointerEvents="none" fontWeight={600}>
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
          {editorMode === "decorate" ? (
            <div>
              {selectedDecoration ? (
                <div>
                  <div style={styles.sideTitle}>
                    {selectedDecoration.type === "icon"
                      ? ICON_LABELS[selectedDecoration.icon] || "Icon"
                      : selectedDecoration.type === "shape"
                      ? SHAPE_LABELS[selectedDecoration.shape] || "Shape"
                      : selectedDecoration.type === "text"
                      ? "Text"
                      : "Item"}
                  </div>

                  {selectedDecoration.type === "text" && (
                    <label style={styles.configLabel}>
                      Text
                      <input
                        type="text"
                        style={styles.configInput}
                        value={selectedDecoration.text}
                        onChange={(e) => updateDecoration(selectedDecoration.id, { text: e.target.value.slice(0, 40) })}
                      />
                    </label>
                  )}

                  <div style={styles.configLabelPlain}>Color</div>
                  <input
                    type="color"
                    style={styles.colorInput}
                    value={selectedDecoration.color || "#5c5648"}
                    onChange={(e) => updateDecoration(selectedDecoration.id, { color: e.target.value })}
                  />

                  <div style={styles.configLabelPlain}>Size</div>
                  <div style={styles.stepperRow}>
                    <button
                      style={styles.stepperBtn}
                      onClick={() => {
                        const field = selectedDecoration.type === "icon" ? "size" : selectedDecoration.type === "text" ? "fontSize" : "w";
                        const cur = selectedDecoration[field] || 6;
                        const next = Math.max(1, Math.round((cur - 1) * 10) / 10);
                        if (selectedDecoration.type === "shape") {
                          updateDecoration(selectedDecoration.id, { w: next, h: next * (selectedDecoration.h / selectedDecoration.w || 1) });
                        } else {
                          updateDecoration(selectedDecoration.id, { [field]: next });
                        }
                      }}
                    >
                      −
                    </button>
                    <span style={styles.stepperVal}>
                      {Math.round((selectedDecoration.size || selectedDecoration.fontSize || selectedDecoration.w || 6) * 10) / 10}
                    </span>
                    <button
                      style={styles.stepperBtn}
                      onClick={() => {
                        const field = selectedDecoration.type === "icon" ? "size" : selectedDecoration.type === "text" ? "fontSize" : "w";
                        const cur = selectedDecoration[field] || 6;
                        const next = Math.round((cur + 1) * 10) / 10;
                        if (selectedDecoration.type === "shape") {
                          updateDecoration(selectedDecoration.id, { w: next, h: next * (selectedDecoration.h / selectedDecoration.w || 1) });
                        } else {
                          updateDecoration(selectedDecoration.id, { [field]: next });
                        }
                      }}
                    >
                      +
                    </button>
                  </div>

                  <div style={styles.configLabelPlain}>Rotation</div>
                  <div style={styles.stepperRow}>
                    <button style={styles.stepperBtn} onClick={() => updateDecoration(selectedDecoration.id, { rotation: (selectedDecoration.rotation || 0) - 15 })}>
                      ↺
                    </button>
                    <span style={styles.stepperVal}>{Math.round(selectedDecoration.rotation || 0)}°</span>
                    <button style={styles.stepperBtn} onClick={() => updateDecoration(selectedDecoration.id, { rotation: (selectedDecoration.rotation || 0) + 15 })}>
                      ↻
                    </button>
                  </div>

                  <div style={styles.configLabelPlain}>Opacity</div>
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.05"
                    value={selectedDecoration.opacity != null ? selectedDecoration.opacity : 1}
                    onChange={(e) => updateDecoration(selectedDecoration.id, { opacity: Number(e.target.value) })}
                    style={styles.rangeInput}
                  />

                  <div style={styles.configLabelPlain}>Layer order</div>
                  <div style={styles.layerBtnRow}>
                    <button style={styles.smallActionBtn} onClick={() => moveDecorationLayer(selectedDecoration.id, "back")}>
                      ⬇ Send backward
                    </button>
                    <button style={styles.smallActionBtn} onClick={() => moveDecorationLayer(selectedDecoration.id, "front")}>
                      ⬆ Bring forward
                    </button>
                  </div>

                  <button style={{ ...styles.smallBtn, marginTop: 10, color: "#c0392b" }} onClick={() => removeDecoration(selectedDecoration.id)}>
                    Delete
                  </button>
                  <button style={{ ...styles.smallBtn, marginTop: 6 }} onClick={() => setSelectedDecorationId(null)}>
                    Deselect
                  </button>
                </div>
              ) : (
                <div>
                  <div style={styles.sideTitle}>Add to map</div>
                  <div style={styles.smallNote}>Pick an item, then click anywhere on the map to place it.</div>

                  <div style={styles.configLabelPlain}>
                    Icons ({ICON_LIBRARY.length})
                  </div>
                  <div style={styles.iconCategoryPicker}>
                    {Object.keys(ICON_CATEGORIES).map((cat) => (
                      <button
                        key={cat}
                        style={{ ...styles.categoryPill, ...(iconCategory === cat ? styles.categoryPillActive : {}) }}
                        onClick={() => setIconCategory(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div style={styles.iconGrid}>
                    {ICON_CATEGORIES[iconCategory].map((icon) => (
                      <button
                        key={icon}
                        title={ICON_LABELS[icon]}
                        style={{
                          ...styles.iconBtn,
                          ...(placementTool?.type === "icon" && placementTool.icon === icon ? styles.iconBtnActive : {}),
                        }}
                        onClick={() => setPlacementTool({ type: "icon", icon })}
                      >
                        <svg viewBox="-6 -6 12 12" width="18" height="18">
                          <g fill="#5c5648" style={{ color: "#5c5648" }}>
                            {renderIconPaths(icon)}
                          </g>
                        </svg>
                        {/* Visible label, not just a hover tooltip -- with
                            100 icons in the library, "hover to find out
                            what this is" isn't good enough, especially on
                            touch devices where hover doesn't exist at all. */}
                        <span style={styles.iconBtnLabel}>{ICON_LABELS[icon]}</span>
                      </button>
                    ))}
                  </div>

                  <div style={styles.configLabelPlain}>Shapes</div>
                  <div style={styles.iconGrid}>
                    {SHAPE_LIST.map((shape) => (
                      <button
                        key={shape}
                        title={SHAPE_LABELS[shape]}
                        style={{
                          ...styles.iconBtn,
                          ...(placementTool?.type === "shape" && placementTool.shape === shape ? styles.iconBtnActive : {}),
                        }}
                        onClick={() => setPlacementTool({ type: "shape", shape })}
                      >
                        <svg viewBox="-6 -6 12 12" width="18" height="18">
                          {shape === "circle" && <circle cx="0" cy="0" r="5" fill="#9dc48a" />}
                          {shape === "rect" && <rect x="-5" y="-3.5" width="10" height="7" fill="#9dc48a" />}
                          {shape === "line" && <line x1="-5" y1="0" x2="5" y2="0" stroke="#9dc48a" strokeWidth="1.4" />}
                        </svg>
                        <span style={styles.iconBtnLabel}>{SHAPE_LABELS[shape]}</span>
                      </button>
                    ))}
                    <button
                      title="Text label"
                      style={{ ...styles.iconBtn, ...(placementTool?.type === "text" ? styles.iconBtnActive : {}) }}
                      onClick={() => setPlacementTool({ type: "text" })}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#5c5648" }}>Aa</span>
                      <span style={styles.iconBtnLabel}>Text</span>
                    </button>
                  </div>
                  {placementTool && (
                    <button style={{ ...styles.smallBtn, marginTop: 8 }} onClick={() => setPlacementTool(null)}>
                      Cancel placing
                    </button>
                  )}

                  <div style={styles.divider} />

                  <div style={styles.sideTitle}>Background color</div>
                  <div style={styles.bgSwatchGrid}>
                    {BACKGROUND_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        title={preset.label}
                        style={{
                          ...styles.bgSwatch,
                          background: preset.value || "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 8px 8px",
                          ...(backgroundDraft === preset.value ? styles.bgSwatchActive : {}),
                        }}
                        onClick={() => setBackgroundDraft(preset.value)}
                      />
                    ))}
                    <input
                      type="color"
                      style={styles.colorInput}
                      value={backgroundDraft || "#f6f1e5"}
                      onChange={(e) => setBackgroundDraft(e.target.value)}
                      title="Custom color"
                    />
                  </div>

                  {decorationDraft.length > 0 && (
                    <>
                      <div style={styles.divider} />
                      <div style={styles.sideTitle}>Layers ({decorationDraft.length})</div>
                      <div style={styles.layerList}>
                        {decorationDraft
                          .slice()
                          .map((d, idx) => idx)
                          .reverse()
                          .map((idx) => {
                            const d = decorationDraft[idx];
                            const label =
                              d.type === "icon" ? ICON_LABELS[d.icon] : d.type === "shape" ? SHAPE_LABELS[d.shape] : d.type === "text" ? `"${d.text}"` : "Item";
                            return (
                              <div
                                key={d.id}
                                style={{ ...styles.layerRow, ...(selectedDecorationId === d.id ? styles.layerRowActive : {}) }}
                                onClick={() => setSelectedDecorationId(d.id)}
                              >
                                <span>
                                  {idx + 1}. {label}
                                </span>
                                <button
                                  style={styles.tinyBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeDecoration(d.id);
                                  }}
                                >
                                  delete
                                </button>
                              </div>
                            );
                          })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : selectedStation != null && selectedStationData ? (
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
                {selectedEdgePoints} bend point{selectedEdgePoints === 1 ? "" : "s"}. Drag a handle on the map to
                bend the route there, or use the blue <strong>+</strong> button right on the canvas to add another
                point. Longer routes look best with 2-3 points for a smooth S-shape.
              </div>
              <button style={styles.smallBtn} onClick={() => addCurvePoint(selectedEdge)} disabled={selectedEdgePoints >= MAX_CURVE_POINTS}>
                + Add another point ({selectedEdgePoints}/{MAX_CURVE_POINTS})
              </button>
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
              <div style={styles.smallNote}>Click a station or a route on the map to edit it.</div>
            </div>
          )}

          <div style={styles.divider} />

          <div style={styles.sideTitle}>Unsaved edits</div>
          <div style={styles.editSummaryRow}>
            <span style={styles.editSummaryPill}>{curveEditCount} curve{curveEditCount === 1 ? "" : "s"}</span>
            <span style={styles.editSummaryPill}>{stationEditCount} station{stationEditCount === 1 ? "" : "s"}</span>
            {decorationsChanged && <span style={styles.editSummaryPill}>decorations changed</span>}
            {backgroundChanged && <span style={styles.editSummaryPill}>background changed</span>}
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
  modeTabs: { display: "flex", gap: 6, marginBottom: 12 },
  modeTab: { flex: 1, border: "1.5px solid #ddd", background: "#fff", borderRadius: 9, padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#8a8375" },
  modeTabActive: { background: "#2937c9", color: "#fff", borderColor: "#2937c9" },
  colorInput: { width: "100%", height: 34, border: "1.5px solid #ddd", borderRadius: 8, padding: 2, cursor: "pointer", marginBottom: 12 },
  stepperRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 },
  stepperBtn: { width: 28, height: 28, borderRadius: 6, border: "1px solid #ddd", background: "#fafafa", fontSize: 15, cursor: "pointer", lineHeight: 1 },
  stepperVal: { fontSize: 12.5, fontWeight: 700, color: "#5c5648", minWidth: 34, textAlign: "center" },
  rangeInput: { width: "100%", marginBottom: 12 },
  layerBtnRow: { display: "flex", gap: 6, marginBottom: 8 },
  iconCategoryPicker: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 },
  categoryPill: { border: "1px solid #ddd", background: "#fafafa", borderRadius: 12, padding: "3px 9px", fontSize: 10.5, fontWeight: 600, color: "#8a8375", cursor: "pointer" },
  categoryPillActive: { background: "#2937c9", color: "#fff", borderColor: "#2937c9" },
  iconGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14, maxHeight: 260, overflowY: "auto" },
  iconBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: "5px 2px",
    border: "1px solid #ddd",
    background: "#fafafa",
    borderRadius: 7,
    cursor: "pointer",
  },
  iconBtnLabel: { fontSize: 9, fontWeight: 600, color: "#8a8375", textAlign: "center", lineHeight: 1.1, wordBreak: "break-word" },
  iconBtnActive: { background: "#eef1fb", borderColor: "#2937c9" },
  bgSwatchGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" },
  bgSwatch: { width: 26, height: 26, borderRadius: "50%", border: "2px solid #ddd", cursor: "pointer", padding: 0 },
  bgSwatchActive: { borderColor: "#2937c9", boxShadow: "0 0 0 2px #eef1fb" },
  layerList: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" },
  layerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "6px 8px", borderRadius: 6, background: "#fafafa", cursor: "pointer", gap: 6 },
  layerRowActive: { background: "#eef1fb", fontWeight: 700, color: "#2937c9" },
};
