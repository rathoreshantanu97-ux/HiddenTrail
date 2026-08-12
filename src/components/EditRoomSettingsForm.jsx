import React, { useState, useEffect } from "react";
import { useActiveMaps } from "../lib/useActiveMaps.js";
import { useMapWithOverrides } from "../lib/useMapWithOverrides.js";
import { computeRoundsAndRevealSchedule } from "../maps/mapSchema.js";
import * as auth from "../lib/accessControlApi.js";
import * as api from "../lib/supabaseApi.js";
import { styles } from "./GameBoard.jsx";

// ---------------------------------------------------------------------------
// EDIT ROOM SETTINGS FORM — lets the HOST return from the lobby to a
// settings-adjustment view without leaving/recreating the room (the
// alternative being a full leave, which could delete the whole room if
// the host was alone there so far).
//
// EXPANDED from an earlier, deliberately-narrow version that only
// covered map/detective count/turn timer -- this now mirrors
// CreateRoomForm's FULL feature-override surface (takeovers, highlight
// styles, route explorer, round scaling, public/room name), since
// there was no longer a good reason a setting choosable at creation
// couldn't also be revisited before the game actually starts.
//
// CRITICAL FIX vs the old version: the old form initialized every field
// to a hardcoded default (turnTimerSeconds always started at `null`,
// i.e. "no limit") regardless of what the room ACTUALLY had configured
// -- so simply opening this screen and clicking Save would silently
// reset the turn timer (and would have silently reset every other
// setting added here too) even if the host changed nothing. This
// version fetches the room's actual current row on mount and prefills
// every field from it, so "open, look, cancel" or "open, save with no
// changes" are both true no-ops.
// ---------------------------------------------------------------------------
export default function EditRoomSettingsForm({ roomId, myPlayerId, mySecret, currentMapId, currentNumDetectives, currentTotalPlayers, onSaved, onCancel }) {
  const MAP_LIST = useActiveMaps();
  const [mapId, setMapId] = useState(currentMapId);
  const [numDetectives, setNumDetectives] = useState(currentNumDetectives);
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(null);
  const [publicConfig, setPublicConfig] = useState({ turnTimerMin: 30, turnTimerMax: 300, defaultInviteLimit: 20 });
  const [featureConfig, setFeatureConfig] = useState(null);
  const [featureOverrides, setFeatureOverrides] = useState({});
  const [isPublic, setIsPublic] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    auth.getPublicConfig().then(setPublicConfig).catch((e) => console.error("Failed to fetch public config:", e));
    auth.getFeatureConfig().then(setFeatureConfig).catch((e) => console.error("Failed to fetch feature config:", e));
  }, []);

  // Prefill every field from the room's ACTUAL current settings -- see
  // the file-level comment above for why this matters. A null
  // *_override column means "this room never overrode it, currently
  // inheriting the admin's global default" -- represented here the same
  // way CreateRoomForm represents "not yet touched" (undefined key in
  // featureOverrides, falls back to the global default at render time),
  // so re-saving without touching a field keeps inheriting the global
  // default rather than baking in whatever it happened to resolve to.
  useEffect(() => {
    api
      .fetchRoom(roomId)
      .then((room) => {
        if (!room) return;
        setTurnTimerSeconds(room.turn_timer_seconds ?? null);
        setIsPublic(!!room.is_public);
        setRoomName(room.room_name || "");
        setFeatureOverrides({
          takeovers: room.takeovers_enabled_override,
          takeoverReversal: room.takeover_reversal_enabled_override,
          endGameVote: room.end_game_vote_enabled_override,
          pauseResume: room.pause_resume_enabled_override,
          redistributeRoles: room.redistribute_roles_enabled_override,
          positionHighlightStyle: room.position_highlight_style_override,
          destinationHighlightStyle: room.destination_highlight_style_override,
          routeExplorer: room.route_explorer_enabled_override,
          roundScalingRatio: room.round_scaling_ratio_override,
        });
      })
      .catch((e) => console.error("Failed to fetch current room settings:", e))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const rawSelectedMap = MAP_LIST.find((m) => m.id === mapId);
  const selectedMap = useMapWithOverrides(rawSelectedMap) || rawSelectedMap;
  const mapLimits = selectedMap?.mapLimits || { minDetectives: 3, maxDetectives: 8 };

  async function handleSave() {
    if (isPublic && !roomName.trim()) {
      setErr("Public rooms need a name so others can find them.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api.updateRoomSettings({
        roomId,
        callerPlayerId: myPlayerId,
        callerSecret: mySecret,
        mapId,
        numDetectives,
        totalPlayers: numDetectives + 1,
        mapStationCount: selectedMap ? Object.keys(selectedMap.stations).length : null,
        turnTimerSeconds,
        featureOverrides,
        isPublic,
        roomName: isPublic ? roomName.trim() : null,
      });
      onSaved();
    } catch (e) {
      setErr(e.message || "Failed to save settings.");
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div style={styles.page}>
        <div style={styles.setupCard}>
          <h2 style={{ margin: "0 0 4px" }}>Edit Room Settings</h2>
          <p style={{ color: "#777", fontSize: 13 }}>Loading current settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
    <div style={styles.setupCard}>
      <h2 style={{ margin: "0 0 4px" }}>Edit Room Settings</h2>
      <p style={{ color: "#777", fontSize: 13, marginBottom: 20 }}>Changes apply to everyone currently in the lobby.</p>

      {err && <div style={{ color: "#a33", fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <label style={styles.label}>Map</label>
      <div style={styles.rowCenter}>
        {MAP_LIST.map((m) => (
          <button key={m.id} onClick={() => setMapId(m.id)} style={{ ...styles.mapPill, ...(mapId === m.id ? styles.mapPillActive : {}) }}>
            <div style={{ fontWeight: 700 }}>{m.label}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>{m.subtitle}</div>
          </button>
        ))}
      </div>

      <label style={styles.label}>Number of detectives</label>
      <div style={styles.rowCenter}>
        {Array.from({ length: mapLimits.maxDetectives - mapLimits.minDetectives + 1 }, (_, i) => mapLimits.minDetectives + i).map((n) => (
          <button key={n} onClick={() => setNumDetectives(n)} style={{ ...styles.pill, ...(numDetectives === n ? styles.pillActive : {}) }}>
            {n}
          </button>
        ))}
      </div>

      {featureConfig?.publicRoomsEnabled && (
        <>
          <label style={styles.label}>Room visibility</label>
          <div style={styles.rowCenter}>
            <button style={{ ...styles.pill, ...(!isPublic ? styles.pillActive : {}) }} onClick={() => setIsPublic(false)} type="button">
              Private (code only)
            </button>
            <button style={{ ...styles.pill, ...(isPublic ? styles.pillActive : {}) }} onClick={() => setIsPublic(true)} type="button">
              Public (listed)
            </button>
          </div>
          {isPublic && (
            <>
              <label style={styles.label}>Room name (shown to others browsing public rooms)</label>
              <input
                style={styles.textInput}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Friday Night Hunt"
                maxLength={40}
              />
            </>
          )}
        </>
      )}

      {featureConfig && (
        <div style={styles.featureOverridesBox}>
          <div style={styles.featureOverridesTitle}>Game options for this room</div>
          {featureConfig.takeoversOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow takeovers for inactive players</span>
              <input
                type="checkbox"
                checked={featureOverrides.takeovers ?? featureConfig.takeoversEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, takeovers: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.takeoverReversalOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow takeover reversal votes</span>
              <input
                type="checkbox"
                checked={featureOverrides.takeoverReversal ?? featureConfig.takeoverReversalEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, takeoverReversal: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.endGameVoteOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow vote-to-end-game</span>
              <input
                type="checkbox"
                checked={featureOverrides.endGameVote ?? featureConfig.endGameVoteEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, endGameVote: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.pauseResumeOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow pause / resume</span>
              <input
                type="checkbox"
                checked={featureOverrides.pauseResume ?? featureConfig.pauseResumeEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, pauseResume: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.redistributeRolesOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow host to redistribute roles mid-game</span>
              <input
                type="checkbox"
                checked={featureOverrides.redistributeRoles ?? featureConfig.redistributeRolesEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, redistributeRoles: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.routeExplorerOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow route explorer</span>
              <input
                type="checkbox"
                checked={featureOverrides.routeExplorer ?? featureConfig.routeExplorerEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, routeExplorer: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.positionHighlightStyleOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Position highlight style (your turn / Mr. X's own view)</span>
              <select
                style={styles.featureOverrideSelect}
                value={featureOverrides.positionHighlightStyle ?? featureConfig.positionHighlightStyle}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, positionHighlightStyle: e.target.value }))}
              >
                <option value="ring">Pulsing ring</option>
                <option value="rotating">Rotating ring</option>
                <option value="blink">Blink</option>
                <option value="static">Static ring</option>
                <option value="none">None</option>
              </select>
            </label>
          )}
          {featureConfig.destinationHighlightStyleOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Destination highlight style (legal moves)</span>
              <select
                style={styles.featureOverrideSelect}
                value={featureOverrides.destinationHighlightStyle ?? featureConfig.destinationHighlightStyle}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, destinationHighlightStyle: e.target.value }))}
              >
                <option value="ring">Pulsing ring</option>
                <option value="rotating">Rotating ring</option>
                <option value="blink">Blink</option>
                <option value="static">Static ring</option>
                <option value="none">None</option>
              </select>
            </label>
          )}
          {featureConfig.roundScalingOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>
                Game length (rounds) —{" "}
                {selectedMap
                  ? computeRoundsAndRevealSchedule(
                      selectedMap.graph,
                      Object.keys(selectedMap.stations).map(Number),
                      featureOverrides.roundScalingRatio ?? 1.0
                    ).totalRounds
                  : "?"}{" "}
                rounds at current setting
              </span>
              <select
                style={styles.featureOverrideSelect}
                value={featureOverrides.roundScalingRatio ?? 1.0}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, roundScalingRatio: Number(e.target.value) }))}
              >
                <option value={0.6}>Shorter</option>
                <option value={1.0}>Standard</option>
                <option value={1.4}>Longer</option>
              </select>
            </label>
          )}

          {publicConfig && (
            <label style={styles.featureOverrideRow}>
              <span>Turn timer (seconds) — blank means no time limit</span>
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
            </label>
          )}
        </div>
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
    </div>
  );
}
