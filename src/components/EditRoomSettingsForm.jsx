import React, { useState, useEffect } from "react";
import { useActiveMaps } from "../lib/useActiveMaps.js";
import { useMapWithOverrides } from "../lib/useMapWithOverrides.js";
import { computeRoundsAndRevealSchedule } from "../maps/mapSchema.js";
import { computeTurnSchedule, actingWindowSeconds } from "../lib/turnSchedule.js";
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
  const [planningTimeSeconds, setPlanningTimeSeconds] = useState(null);
  // null = "not configured", which the schedule treats as one full base
  // act window per extra detective. Kept as a separate concept from 0
  // ("no extra time at all"), which is a legitimate deliberate choice.
  const [extraDetectiveSeconds, setExtraDetectiveSeconds] = useState(null);
  // v3.22 -- per-detective sub-turn cap (rooms.detective_cap_seconds).
  // null/blank means "same as the base act time."
  const [detectiveCapSeconds, setDetectiveCapSeconds] = useState(null);
  // v3.28 -- the two stay-reward thresholds. X (black) and Y (double) are
  // FULLY INDEPENDENT arbitrary integers: nothing requires Y to be a
  // multiple of X, larger than X, or related to it at all. X=2 with Y=7
  // is a perfectly valid configuration and behaves exactly as the rule
  // reads (black at every multiple of 2 except those also multiples of
  // 7 -- so 14 is the first double). Both are PRE-FILLED with their
  // defaults (X = detective count, Y = 3X) rather than left blank, per
  // the explicit request that the defaults be visible but freely
  // editable; a blank field falls back to the same defaults server-side.
  const [stayBlackThreshold, setStayBlackThreshold] = useState(null);
  const [stayDoubleThreshold, setStayDoubleThreshold] = useState(null);
  const [publicConfig, setPublicConfig] = useState({
    turnTimerMin: 30,
    turnTimerMax: 300,
    defaultInviteLimit: 20,
    planningTimeMin: 30,
    planningTimeMax: 600,
    mrxSecondsMin: 15,
    mrxSecondsMax: 900,
  });
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
    Promise.all([api.fetchRoom(roomId), auth.getPublicConfig()])
      .then(([room, cfg]) => {
        if (!room) return;
        // Both timer fields treat a null DB value the same way: default
        // it ON with a real number rather than leaving it blank, matching
        // CreateRoomForm's own default and keeping the two fields
        // consistent with each other. A host can still explicitly clear
        // either field afterward to opt out.
        setTurnTimerSeconds(room.turn_timer_seconds ?? cfg.turnTimerMin);
        setPlanningTimeSeconds(room.planning_time_seconds ?? cfg.planningTimeMin);
        // Unlike the two fields above, this one is deliberately NOT
        // defaulted to a concrete number when unset: leaving it blank is
        // the meaningful default ("give each extra detective a full act
        // window"), and pre-filling a number would silently bake in a
        // different, smaller value the host never chose.
        setExtraDetectiveSeconds(room.extra_detective_seconds ?? null);
        setDetectiveCapSeconds(room.detective_cap_seconds ?? null);
        // Pre-fill with the room's stored value, or -- when it has never
        // been overridden -- with the same default the server would
        // resolve, so the host sees the real numbers in effect rather
        // than two empty boxes. Editing either one is independent of the
        // other; changing X does NOT re-derive Y.
        setStayBlackThreshold(room.stay_black_threshold ?? room.num_detectives ?? 3);
        setStayDoubleThreshold(room.stay_double_threshold ?? (room.stay_black_threshold ?? room.num_detectives ?? 3) * 3);
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
          draw: room.draw_enabled_override,
          peek: room.peek_enabled_override,
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
        planningTimeSeconds,
        extraDetectiveSeconds: extraDetectiveSeconds === "" || extraDetectiveSeconds == null ? null : parseInt(extraDetectiveSeconds, 10),
        detectiveCapSeconds: detectiveCapSeconds === "" || detectiveCapSeconds == null ? null : parseInt(detectiveCapSeconds, 10),
        stayBlackThreshold: stayBlackThreshold === "" || stayBlackThreshold == null ? null : parseInt(stayBlackThreshold, 10),
        stayDoubleThreshold: stayDoubleThreshold === "" || stayDoubleThreshold == null ? null : parseInt(stayDoubleThreshold, 10),
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
          {featureConfig.drawOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow the freehand drawing / annotation layer</span>
              <input
                type="checkbox"
                checked={featureOverrides.draw ?? featureConfig.drawEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, draw: e.target.checked }))}
              />
            </label>
          )}
          {featureConfig.peekOverridable && (
            <label style={styles.featureOverrideRow}>
              <span>Allow peeking into a teammate's screen</span>
              <input
                type="checkbox"
                checked={featureOverrides.peek ?? featureConfig.peekEnabled}
                onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, peek: e.target.checked }))}
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

          {publicConfig && turnTimerSeconds && (
            <label style={styles.featureOverrideRow}>
              <span>Planning time (seconds) — shared team thinking time right after Mr. X moves; blank means no shared pause</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-label="Decrease planning time by 10 seconds"
                  style={styles.timerStepBtn}
                  onClick={() => {
                    const current = planningTimeSeconds === null || planningTimeSeconds === "" ? publicConfig.planningTimeMin : parseInt(planningTimeSeconds, 10) || publicConfig.planningTimeMin;
                    const next = Math.max(publicConfig.planningTimeMin, Math.min(publicConfig.planningTimeMax, current - 10));
                    setPlanningTimeSeconds(next);
                  }}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="No shared pause"
                  style={{ ...styles.featureOverrideSelect, textAlign: "center" }}
                  value={planningTimeSeconds ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*$/.test(v)) {
                      setPlanningTimeSeconds(v === "" ? null : v);
                    }
                  }}
                  onBlur={() => {
                    if (planningTimeSeconds === null || planningTimeSeconds === "") {
                      setPlanningTimeSeconds(null);
                      return;
                    }
                    const n = Math.max(publicConfig.planningTimeMin, Math.min(publicConfig.planningTimeMax, parseInt(planningTimeSeconds, 10) || publicConfig.planningTimeMin));
                    setPlanningTimeSeconds(n);
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase planning time by 10 seconds"
                  style={styles.timerStepBtn}
                  onClick={() => {
                    const current = planningTimeSeconds === null || planningTimeSeconds === "" ? publicConfig.planningTimeMin : parseInt(planningTimeSeconds, 10) || publicConfig.planningTimeMin;
                    const next = Math.max(publicConfig.planningTimeMin, Math.min(publicConfig.planningTimeMax, current + 10));
                    setPlanningTimeSeconds(next);
                  }}
                >
                  +
                </button>
              </div>
            </label>
          )}

          {publicConfig && turnTimerSeconds && (
            <label style={styles.featureOverrideRow}>
              <span>
                Extra acting time per additional detective (seconds) — when one player controls several detectives, they act on them one after another inside the shared acting phase, so the phase is lengthened by this much for each detective beyond their first. Blank means a full act window each.
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-label="Decrease extra detective time by 5 seconds"
                  style={styles.timerStepBtn}
                  onClick={() => {
                    const base = parseInt(turnTimerSeconds, 10) || 0;
                    const current = extraDetectiveSeconds === null || extraDetectiveSeconds === "" ? base : parseInt(extraDetectiveSeconds, 10) || 0;
                    setExtraDetectiveSeconds(Math.max(0, current - 5));
                  }}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={`Same as act time (${parseInt(turnTimerSeconds, 10) || 0}s)`}
                  style={{ ...styles.featureOverrideSelect, textAlign: "center" }}
                  value={extraDetectiveSeconds ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*$/.test(v)) {
                      setExtraDetectiveSeconds(v === "" ? null : v);
                    }
                  }}
                  onBlur={() => {
                    if (extraDetectiveSeconds === null || extraDetectiveSeconds === "") {
                      setExtraDetectiveSeconds(null);
                      return;
                    }
                    // Server enforces the same 0..turnTimerMax range --
                    // clamping here just avoids a pointless round trip.
                    const n = Math.max(0, Math.min(publicConfig.turnTimerMax, parseInt(extraDetectiveSeconds, 10) || 0));
                    setExtraDetectiveSeconds(n);
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase extra detective time by 5 seconds"
                  style={styles.timerStepBtn}
                  onClick={() => {
                    const base = parseInt(turnTimerSeconds, 10) || 0;
                    const current = extraDetectiveSeconds === null || extraDetectiveSeconds === "" ? base : parseInt(extraDetectiveSeconds, 10) || 0;
                    setExtraDetectiveSeconds(Math.min(publicConfig.turnTimerMax, current + 5));
                  }}
                >
                  +
                </button>
              </div>
            </label>
          )}

          {/* v3.22 -- per-detective sub-turn cap. Distinct from the field
              above: that one lengthens the POOLED acting window, this one
              caps a single detective's own sub-turn inside it. It is the
              number the acting player actually races against, so it's
              also what the board shows as the primary countdown. */}
          {publicConfig && turnTimerSeconds && (
            <label style={styles.featureOverrideRow}>
              <span>
                Time limit per detective's own move (seconds) — during the acting phase, each detective gets at most this long before their move is
                automatically passed and play moves on to that player's next detective. Blank means the same as the act time. Never exceeds the time
                actually left in the round.
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-label="Decrease per-detective cap by 5 seconds"
                  style={styles.timerStepBtn}
                  onClick={() => {
                    const base = parseInt(turnTimerSeconds, 10) || 0;
                    const current = detectiveCapSeconds === null || detectiveCapSeconds === "" ? base : parseInt(detectiveCapSeconds, 10) || 0;
                    setDetectiveCapSeconds(Math.max(5, current - 5));
                  }}
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={`Same as act time (${parseInt(turnTimerSeconds, 10) || 0}s)`}
                  style={{ ...styles.featureOverrideSelect, textAlign: "center" }}
                  value={detectiveCapSeconds ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*$/.test(v)) {
                      setDetectiveCapSeconds(v === "" ? null : v);
                    }
                  }}
                  onBlur={() => {
                    if (detectiveCapSeconds === null || detectiveCapSeconds === "") {
                      setDetectiveCapSeconds(null);
                      return;
                    }
                    // Server enforces the same 5..turnTimerMax range --
                    // clamping here just avoids a pointless round trip.
                    const n = Math.max(5, Math.min(publicConfig.turnTimerMax, parseInt(detectiveCapSeconds, 10) || 5));
                    setDetectiveCapSeconds(n);
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase per-detective cap by 5 seconds"
                  style={styles.timerStepBtn}
                  onClick={() => {
                    const base = parseInt(turnTimerSeconds, 10) || 0;
                    const current = detectiveCapSeconds === null || detectiveCapSeconds === "" ? base : parseInt(detectiveCapSeconds, 10) || 0;
                    setDetectiveCapSeconds(Math.min(publicConfig.turnTimerMax, current + 5));
                  }}
                >
                  +
                </button>
              </div>
            </label>
          )}

          {/* v3.28 -- STAY-REWARD THRESHOLDS. The server keeps a single
              running count of EVERY detective stay action across the
              whole game (voluntary, auto-passed, or timed out; Mr.X's own
              stays never count). Each time that count reaches a multiple
              of X, Mr.X is granted a black ticket -- unless that same
              count is ALSO a multiple of Y, in which case he gets a
              double-move card instead. The two numbers are completely
              independent: X=2 with Y=7 means black at 2,4,6,8,10,12 and
              the first double at 14, with nothing at all happening at 7.
              Deliberately NOT presented as "X and a multiple of X". */}
          <label style={styles.featureOverrideRow}>
            <span>
              Detective stays per black ticket for Mr.&nbsp;X — every this-many stays by the detective team (counted across all detectives and all
              rounds) earns Mr.&nbsp;X one black ticket. Blank uses the default of one per detective in the room.
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder={`Default (${numDetectives})`}
              style={{ ...styles.featureOverrideSelect, textAlign: "center" }}
              value={stayBlackThreshold ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*$/.test(v)) setStayBlackThreshold(v === "" ? null : v);
              }}
              onBlur={() => {
                if (stayBlackThreshold === null || stayBlackThreshold === "") return;
                setStayBlackThreshold(Math.max(1, Math.min(999, parseInt(stayBlackThreshold, 10) || 1)));
              }}
            />
          </label>

          <label style={styles.featureOverrideRow}>
            <span>
              Detective stays per double-move card — when the running stay count hits a multiple of the number above AND a multiple of this one, Mr.&nbsp;X
              gets a double-move card instead of a black ticket. Independent of the number above; it does not have to be a multiple of it. Blank uses
              three times the black-ticket threshold.
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder={`Default (${(parseInt(stayBlackThreshold, 10) || numDetectives) * 3})`}
              style={{ ...styles.featureOverrideSelect, textAlign: "center" }}
              value={stayDoubleThreshold ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*$/.test(v)) setStayDoubleThreshold(v === "" ? null : v);
              }}
              onBlur={() => {
                if (stayDoubleThreshold === null || stayDoubleThreshold === "") return;
                setStayDoubleThreshold(Math.max(1, Math.min(999, parseInt(stayDoubleThreshold, 10) || 1)));
              }}
            />
          </label>

          {/* Live preview of the ACTUAL reward sequence the two numbers
              above produce. Derived by the same rule the server uses, not
              a hand-written description, so a surprising configuration
              (like X=2, Y=7) shows its real behavior instead of an
              assumed one. */}
          {(() => {
            const x = Math.max(1, parseInt(stayBlackThreshold, 10) || numDetectives);
            const y = Math.max(1, parseInt(stayDoubleThreshold, 10) || x * 3);
            const seq = [];
            for (let t = 1; t <= x * 8 && seq.length < 8; t++) {
              if (t % x !== 0) continue;
              seq.push(`${t}→${t % y === 0 ? "2x" : "black"}`);
            }
            return <div style={{ fontSize: 12, color: "#777", marginBottom: 10 }}>First rewards at stay count: {seq.join(", ")}…</div>;
          })()}

          {publicConfig && turnTimerSeconds && (() => {
            // Host sets these TWO numbers above directly -- everything
            // else here is a READ-ONLY preview, derived the exact same
            // way the live game clock will derive it (computeTurnSchedule),
            // using the admin-configured ratios/bounds. Hosts never see
            // or set the ratios/bounds themselves, per explicit design
            // decision.
            const n = parseInt(turnTimerSeconds, 10);
            if (!n) return null;
            const buf = planningTimeSeconds ? parseInt(planningTimeSeconds, 10) : null;
            const extra = extraDetectiveSeconds === null || extraDetectiveSeconds === "" ? null : parseInt(extraDetectiveSeconds, 10);
            const schedule = computeTurnSchedule(
              n,
              buf,
              { mrxTimeRatio: publicConfig.mrxTimeRatio, extraSeatTimeRatio: publicConfig.extraSeatTimeRatio },
              { mrxSecondsMin: publicConfig.mrxSecondsMin, mrxSecondsMax: publicConfig.mrxSecondsMax },
              extra
            );
            // Worst case for THIS room: one player could end up holding
            // every detective seat, so that's the longest the acting
            // phase could ever run. The live game sizes it from the
            // actual seat allocation instead (see App.jsx).
            const worstCaseActing = actingWindowSeconds(schedule, numDetectives);
            return (
              <div style={styles.timerSchedulePreview}>
                <div style={styles.timerSchedulePreviewTitle}>How this plays out each round</div>
                <div>1. Mr. X's turn: up to {schedule.mrxSeconds}s to move</div>
                {schedule.bufferSeconds ? (
                  <div>2. Detectives' shared planning time: up to {schedule.bufferSeconds}s — no one can move yet, but everyone can preview routes and discuss</div>
                ) : (
                  <div>2. No shared planning window — detectives go straight to the acting phase.</div>
                )}
                <div>
                  3. Detectives' acting phase: every player acts at the same time, but each one now gets their OWN clock, sized off how many detectives THEY
                  hold — {schedule.actSeconds}s for a single detective, plus {schedule.extraSeatSeconds}s for each extra one (so up to {worstCaseActing}s for a
                  player holding all {numDetectives}). When a player's own clock runs out, only THEIR unmoved detectives stay put and forfeit a ticket to
                  Mr. X; nobody else is affected. The round itself can never run past {worstCaseActing}s as an outer safety limit.
                </div>
              </div>
            );
          })()}
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
