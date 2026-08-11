import React, { useState, useEffect } from "react";
import { useActiveMaps } from "../lib/useActiveMaps.js";
import { useMapWithOverrides } from "../lib/useMapWithOverrides.js";
import * as auth from "../lib/accessControlApi.js";
import * as api from "../lib/supabaseApi.js";
import { styles } from "./GameBoard.jsx";

// ---------------------------------------------------------------------------
// EDIT ROOM SETTINGS FORM — lets the HOST return from the lobby to a
// settings-adjustment view (map, detective count, turn timer) without
// leaving/recreating the room -- fixes a real gap where the only way
// out of the lobby was a full leave (which could delete the whole room
// if the host was alone there so far).
//
// Deliberately a FOCUSED subset of Create Room's full options (map,
// detective count, turn timer only) -- the less commonly-adjusted
// feature-override surface is left as-is once a room is created, since
// re-exposing the FULL create-room form here would meaningfully grow
// this component's scope for a case that's mostly about "oops, wrong
// map" or "let's allow more players," not deep reconfiguration.
// ---------------------------------------------------------------------------
export default function EditRoomSettingsForm({ roomId, myPlayerId, currentMapId, currentNumDetectives, currentTotalPlayers, onSaved, onCancel }) {
  const MAP_LIST = useActiveMaps();
  const [mapId, setMapId] = useState(currentMapId);
  const [numDetectives, setNumDetectives] = useState(currentNumDetectives);
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(null);
  const [publicConfig, setPublicConfig] = useState({ turnTimerMin: 30, turnTimerMax: 300, defaultInviteLimit: 20 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    auth
      .getPublicConfig()
      .then(setPublicConfig)
      .catch((e) => console.error("Failed to fetch public config:", e));
  }, []);

  const rawSelectedMap = MAP_LIST.find((m) => m.id === mapId);
  const selectedMap = useMapWithOverrides(rawSelectedMap) || rawSelectedMap;
  const mapLimits = selectedMap?.mapLimits || { minDetectives: 3, maxDetectives: 8 };

  async function handleSave() {
    setBusy(true);
    setErr("");
    try {
      await api.updateRoomSettings({
        roomId,
        callerPlayerId: myPlayerId,
        mapId,
        numDetectives,
        totalPlayers: numDetectives + 1,
        mapStationCount: selectedMap ? Object.keys(selectedMap.stations).length : null,
        turnTimerSeconds,
      });
      onSaved();
    } catch (e) {
      setErr(e.message || "Failed to save settings.");
      setBusy(false);
    }
  }

  return (
    <div style={styles.setupCard}>
      <h2 style={{ margin: "0 0 4px" }}>Edit Room Settings</h2>
      <p style={{ color: "#777", fontSize: 13, marginBottom: 20 }}>
        Changes apply to everyone currently in the lobby.
      </p>

      {err && <div style={{ color: "#a33", fontSize: 13, marginBottom: 12 }}>{err}</div>}

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

      <label style={styles.label}>Number of detectives</label>
      <div style={styles.rowCenter}>
        {Array.from({ length: mapLimits.maxDetectives - mapLimits.minDetectives + 1 }, (_, i) => mapLimits.minDetectives + i).map((n) => (
          <button
            key={n}
            onClick={() => setNumDetectives(n)}
            style={{ ...styles.pill, ...(numDetectives === n ? styles.pillActive : {}) }}
          >
            {n}
          </button>
        ))}
      </div>

      {publicConfig && (
        <>
          <label style={styles.label}>Turn timer (seconds) — blank means no time limit</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              aria-label="Decrease turn timer by 10 seconds"
              style={styles.timerStepBtn}
              onClick={() => {
                const current = turnTimerSeconds === null || turnTimerSeconds === "" ? publicConfig.turnTimerMin : parseInt(turnTimerSeconds, 10) || publicConfig.turnTimerMin;
                const next = Math.max(publicConfig.turnTimerMin, Math.min(publicConfig.turnTimerMax, current - 10));
                setTurnTimerSeconds(next);
              }}
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              placeholder="No limit"
              style={{ ...styles.featureOverrideSelect, textAlign: "center" }}
              value={turnTimerSeconds ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*$/.test(v)) {
                  setTurnTimerSeconds(v === "" ? null : v);
                }
              }}
              onBlur={() => {
                if (turnTimerSeconds === null || turnTimerSeconds === "") {
                  setTurnTimerSeconds(null);
                  return;
                }
                const n = Math.max(publicConfig.turnTimerMin, Math.min(publicConfig.turnTimerMax, parseInt(turnTimerSeconds, 10) || publicConfig.turnTimerMin));
                setTurnTimerSeconds(n);
              }}
            />
            <button
              type="button"
              aria-label="Increase turn timer by 10 seconds"
              style={styles.timerStepBtn}
              onClick={() => {
                const current = turnTimerSeconds === null || turnTimerSeconds === "" ? publicConfig.turnTimerMin : parseInt(turnTimerSeconds, 10) || publicConfig.turnTimerMin;
                const next = Math.max(publicConfig.turnTimerMin, Math.min(publicConfig.turnTimerMax, current + 10));
                setTurnTimerSeconds(next);
              }}
            >
              +
            </button>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button style={{ ...styles.primaryBtn, background: "#fff", color: "#111", border: "1.5px solid #ddd" }} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button style={styles.primaryBtn} onClick={handleSave} disabled={busy}>
          {busy ? "Saving..." : "Save & Return to Lobby"}
        </button>
      </div>
    </div>
  );
}
