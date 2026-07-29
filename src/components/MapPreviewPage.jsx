import React, { useState } from "react";
import { MAP_LIST } from "../maps/index.js";
import MapCanvas from "./MapCanvas.jsx";

// ---------------------------------------------------------------------------
// MAP PREVIEW PAGE — a lightweight standalone screen for checking a map
// while you're editing it, without needing to start a full pass-and-play
// or multiplayer game. Shows the rendered map, lets you click a station to
// see its raw data (coords, connections, name), and surfaces the same
// checks as validateMap.js so mistakes are visible without leaving the
// browser.
//
// This is intentionally NOT a map editor (it can't move nodes or add
// edges) -- it's a fast feedback loop for the edit-in-code workflow: edit
// a map file, save, refresh this page, see the result immediately instead
// of clicking through Setup -> Start Game -> squinting at the board.
// ---------------------------------------------------------------------------
export default function MapPreviewPage() {
  const [mapId, setMapId] = useState(MAP_LIST[0].id);
  const [selectedStation, setSelectedStation] = useState(null);
  const map = MAP_LIST.find((m) => m.id === mapId);

  const issues = validateMapInline(map);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Map Preview</h1>
        <div style={styles.mapPicker}>
          {MAP_LIST.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMapId(m.id);
                setSelectedStation(null);
              }}
              style={{ ...styles.pill, ...(mapId === m.id ? styles.pillActive : {}) }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.body}>
        <div style={styles.canvasCol}>
          <MapCanvas map={map} highlightStationId={selectedStation} onStationClick={setSelectedStation} />
        </div>

        <div style={styles.sidebar}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>Map summary</div>
            <div style={styles.statRow}>Stations: {Object.keys(map.stations).length}</div>
            <div style={styles.statRow}>Edges: {map.edges.length}</div>
            <div style={styles.statRow}>Ferry edges: {map.ferryEdges.length}</div>
            <div style={styles.statRow}>Named: {map.names ? "yes" : "no"}</div>
            <div style={styles.statRow}>Custom mode theme: {map.modeTheme ? "yes" : "no (default colors)"}</div>
          </div>

          <div style={{ ...styles.card, ...(issues.length ? styles.cardWarn : styles.cardOk) }}>
            <div style={styles.cardTitle}>{issues.length ? `${issues.length} issue(s) found` : "No issues found"}</div>
            {issues.map((issue, i) => (
              <div key={i} style={styles.issueRow}>
                {issue}
              </div>
            ))}
            {issues.length === 0 && (
              <div style={styles.issueRowOk}>Run <code>node src/maps/validateMap.js {map.id}</code> for the full check.</div>
            )}
          </div>

          {selectedStation != null && (
            <div style={styles.card}>
              <div style={styles.cardTitle}>
                Station {selectedStation}
                {map.names?.[selectedStation] ? ` — ${map.names[selectedStation]}` : ""}
              </div>
              <div style={styles.statRow}>Position: [{map.stations[selectedStation].join(", ")}]</div>
              <div style={styles.statRow}>
                Connections: {(map.graph[selectedStation] || []).length === 0 ? (
                  <span style={{ color: "#c0392b", fontWeight: 700 }}>NONE — unreachable!</span>
                ) : (
                  (map.graph[selectedStation] || [])
                    .map((e) => `#${e.to} (${e.mode})`)
                    .join(", ")
                )}
              </div>
              <div style={styles.statRow}>Is major station: {map.majorStations?.has(selectedStation) ? "yes" : "no"}</div>
            </div>
          )}

          <div style={styles.card}>
            <div style={styles.cardTitle}>Editing this map</div>
            <div style={styles.helpText}>
              Edit <code>src/maps/{map.id}.js</code> directly, save, then refresh this page. Positions are on a{" "}
              {map.viewW}×{map.viewH} coordinate grid (0,0 = top-left). Click any station above to inspect its data.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lightweight inline version of validateMap.js's checks, for immediate
// in-browser feedback. The full validateMap.js script (run via `node`) is
// the authoritative check to run before deploying -- this is just a fast
// subset for the preview page.
function validateMapInline(map) {
  const issues = [];
  const stationIds = Object.keys(map.stations).map(Number);
  const stationIdSet = new Set(stationIds);

  const connected = new Set();
  for (const [a, b] of map.edges) {
    connected.add(a);
    connected.add(b);
  }
  for (const [a, b] of map.ferryEdges) {
    connected.add(a);
    connected.add(b);
  }
  for (const id of stationIds) {
    if (!connected.has(id)) issues.push(`Station ${id} has no connections (unreachable).`);
  }

  if (stationIds.length < 6) {
    issues.push(`Only ${stationIds.length} stations — need at least 6 to support 5 detectives + Mr. X.`);
  }

  if (map.names) {
    for (const id of Object.keys(map.names).map(Number)) {
      if (!stationIdSet.has(id)) issues.push(`names has an entry for non-existent station ${id}.`);
    }
  }
  if (map.majorStations) {
    for (const id of map.majorStations) {
      if (!stationIdSet.has(id)) issues.push(`majorStations references non-existent station ${id}.`);
    }
  }

  return issues;
}

const styles = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh", background: "#f7f6f3", padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 },
  title: { margin: 0, fontSize: 22 },
  mapPicker: { display: "flex", gap: 8 },
  pill: { border: "1.5px solid #ddd", background: "#fff", borderRadius: 999, padding: "6px 14px", fontSize: 13, cursor: "pointer" },
  pillActive: { borderColor: "#111", background: "#111", color: "#fff" },
  body: { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" },
  canvasCol: { flex: "1 1 500px", minWidth: 320 },
  sidebar: { flex: "0 0 320px", display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "#fff", borderRadius: 12, padding: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
  cardOk: { border: "1.5px solid #b7dfc0" },
  cardWarn: { border: "1.5px solid #e0a8a8" },
  cardTitle: { fontWeight: 700, fontSize: 13, marginBottom: 8 },
  statRow: { fontSize: 12.5, color: "#444", marginBottom: 4, lineHeight: 1.5 },
  issueRow: { fontSize: 12, color: "#a33", marginBottom: 4, lineHeight: 1.4 },
  issueRowOk: { fontSize: 12, color: "#888" },
  helpText: { fontSize: 12.5, color: "#666", lineHeight: 1.6 },
};
