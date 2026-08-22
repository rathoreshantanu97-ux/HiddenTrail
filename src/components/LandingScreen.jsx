import React, { useState, useEffect } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useActiveMaps } from "../lib/useActiveMaps.js";
import { MAP_LIST } from "../maps/index.js";
import { computeSeatLayout, computeSeatLayoutSafe, seatLabel } from "../lib/seatLayout.js";
import { useMapWithOverrides, applyMapOverride } from "../lib/useMapWithOverrides.js";
import { usePublicRooms } from "../lib/usePublicRooms.js";
import * as auth from "../lib/accessControlApi.js";
import * as api from "../lib/supabaseApi.js";
import { computeRoundsAndRevealSchedule } from "../maps/mapSchema.js";
import RulebookButton from "./RulebookButton.jsx";
import InfoIcon from "./InfoIcon.jsx";

// ---------------------------------------------------------------------------
// LANDING SCREEN — the very first thing a player sees.
//   - Same-device pass-and-play: top-level, always available
//   - "Play Online": a sub-choice revealing Create Room / Join Room
//   - Logout: always available (clears the account session or guest flag)
// ---------------------------------------------------------------------------
export default function LandingScreen({
  onChoosePassAndPlay,
  onChooseCreateRoom,
  onChooseJoinRoom,
  showAdminPanelLink,
  onOpenAdminPanel,
  accountDisplayName,
  onLogout,
  onOpenRulebook,
}) {
  const [mode, setMode] = useState(null); // null | "online" | "create" | "join"
  const configured = isSupabaseConfigured();

  function goBack() {
    if (mode === "create" || mode === "join") {
      setMode("online");
    } else {
      setMode(null);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Hidden Trail</h1>
            <p style={styles.subtitle}>Hidden-movement detective game</p>
          </div>
          {mode !== null ? (
            <button style={styles.backBtn} onClick={goBack}>
              ← Back
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              {onOpenRulebook && <RulebookButton compact onClick={onOpenRulebook} />}
              {onLogout && (
                <button style={styles.logoutBtn} onClick={onLogout}>
                  Log out
                </button>
              )}
            </div>
          )}
        </div>

        {mode === null && (
          <div style={styles.choiceStack}>
            <button style={styles.choiceBtn} onClick={onChoosePassAndPlay}>
              <div style={styles.choiceTitle}>Same-Device Pass & Play</div>
              <div style={styles.choiceDesc}>Everyone shares one screen, hand off between turns.</div>
            </button>

            <button
              style={{ ...styles.choiceBtn, ...(configured ? {} : styles.choiceBtnDisabled) }}
              onClick={() => configured && setMode("online")}
              disabled={!configured}
            >
              <div style={styles.choiceTitle}>Play Online</div>
              <div style={styles.choiceDesc}>
                {configured
                  ? "Create a room for friends to join, or join one with a code."
                  : "Online multiplayer isn't configured yet (see console for setup steps)."}
              </div>
            </button>
          </div>
        )}

        {mode === "online" && (
          <div style={styles.choiceStack}>
            <button style={styles.choiceBtn} onClick={() => setMode("create")}>
              <div style={styles.choiceTitle}>Create Online Room</div>
              <div style={styles.choiceDesc}>Start a new game, invite friends with a room code.</div>
            </button>
            <button style={styles.choiceBtn} onClick={() => setMode("join")}>
              <div style={styles.choiceTitle}>Join Online Room</div>
              <div style={styles.choiceDesc}>Enter a room code a friend shared with you.</div>
            </button>
          </div>
        )}

        {mode === null && showAdminPanelLink && (
          <button style={styles.adminLinkBtn} onClick={onOpenAdminPanel}>
            Admin Panel
          </button>
        )}

        {mode === "create" && (
          <CreateRoomForm onCreate={onChooseCreateRoom} accountDisplayName={accountDisplayName} />
        )}

        {mode === "join" && (
          <JoinRoomForm
            onJoin={{ lookup: onChooseJoinRoom.lookup, confirm: onChooseJoinRoom.confirm }}
            accountDisplayName={accountDisplayName}
          />
        )}
      </div>
    </div>
  );
}

function CreateRoomForm({ onCreate, accountDisplayName }) {
  const activeMaps = useActiveMaps();
  const [displayName, setDisplayName] = useState(accountDisplayName || "");
  const [mapId, setMapId] = useState(null);
  const [numDetectives, setNumDetectives] = useState(3);
  const [totalPlayers, setTotalPlayers] = useState(2);
  const [hostRole, setHostRole] = useState("mrx");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seatErr, setSeatErr] = useState("");
  const [featureConfig, setFeatureConfig] = useState(null);
  const [featureOverrides, setFeatureOverrides] = useState({});
  const [timingConfig, setTimingConfig] = useState(null);
  const [publicConfig, setPublicConfig] = useState({
    turnTimerMin: 30,
    turnTimerMax: 300,
    defaultInviteLimit: 20,
    planningTimeMin: 30,
    planningTimeMax: 600,
    mrxSecondsMin: 15,
    mrxSecondsMax: 900,
  });
  const [turnTimerSeconds, setTurnTimerSecondsState] = useState(null); // null = no limit
  const [planningTimeSeconds, setPlanningTimeSecondsState] = useState(null); // null = no shared planning window

  useEffect(() => {
    auth
      .getTimingConfig()
      .then(setTimingConfig)
      .catch((e) => console.error("Failed to fetch timing config:", e));
    auth
      .getPublicConfig()
      .then((cfg) => {
        setPublicConfig(cfg);
        // Both timer fields default ON with a real number, not blank --
        // consistent behavior for the two host inputs that make up the
        // same turn schedule (previously turn timer defaulted to "no
        // limit" while planning time defaulted to a real value, which
        // read as inconsistent even though both fields work the same
        // way). A host still opts OUT of either by explicitly blanking
        // it -- this just makes "on" the shared default, not "off."
        setTurnTimerSecondsState((prev) => (prev === null ? cfg.turnTimerMin : prev));
        setPlanningTimeSecondsState((prev) => (prev === null ? cfg.planningTimeMin : prev));
      })
      .catch((e) => console.error("Failed to fetch public config:", e));
  }, []);
  const [isPublic, setIsPublic] = useState(false);
  const [roomName, setRoomName] = useState("");

  useEffect(() => {
    auth
      .getFeatureConfig()
      .then(setFeatureConfig)
      .catch((e) => console.error("Failed to fetch feature config:", e));
  }, []);

  // Same fix as SetupScreen.jsx: never default mapId to a hardcoded
  // string like "city" -- if that specific map is deactivated, nothing
  // in activeMaps would match it, silently breaking the picker (and, if
  // any code assumed a match always exists, risking a crash). Snap to
  // the first available active map instead.
  useEffect(() => {
    if (activeMaps.length === 0) return;
    if (!mapId || !activeMaps.some((m) => m.id === mapId)) {
      setMapId(activeMaps[0].id);
    }
  }, [activeMaps, mapId]);

  const rawSelectedMap = activeMaps.find((m) => m.id === mapId);
  const selectedMap = useMapWithOverrides(rawSelectedMap) || rawSelectedMap;
  const selectedMapTheme = { mrxName: selectedMap?.mrxName, detectiveTeamName: selectedMap?.detectiveTeamName };
  // Fallback bounds while the map hasn't resolved yet (e.g. very first
  // render, before the effect above picks one) -- matches the server's
  // own fallback in create_room when no map data is available.
  const rawMapLimits = selectedMap?.mapLimits || { minDetectives: 3, maxDetectives: 8, minPlayers: 2, maxPlayers: 9 };
  // Intersect with the ADMIN's global min/max_detectives config -- this
  // is the actual fix for the reported bug: the displayed range
  // previously only ever showed the map's own numbers, completely blind
  // to a stricter admin-configured global minimum, so a host could see
  // "3-5" displayed and pick 3, only for the server (which DOES check
  // the admin's global config) to reject it. Same "map's own ceiling
  // wins if it's lower than the admin's minimum" rule as the server-side
  // fix in create_room, kept consistent between client and server.
  const selectedMapLimits = (() => {
    if (!timingConfig) return rawMapLimits;
    let minDet = Math.max(timingConfig.minDetectives, rawMapLimits.minDetectives);
    let maxDet = Math.min(timingConfig.maxDetectives, rawMapLimits.maxDetectives);
    if (maxDet < minDet) minDet = maxDet; // map's own ceiling wins, same as the server
    return { minDetectives: minDet, maxDetectives: maxDet, minPlayers: rawMapLimits.minPlayers, maxPlayers: maxDet + 1 };
  })();

  // If the selected map changes to one with a tighter ceiling than the
  // currently chosen detective count, clamp it down automatically rather
  // than silently letting the form hold a now-invalid value the server
  // would reject.
  useEffect(() => {
    if (numDetectives > selectedMapLimits.maxDetectives) {
      setNumDetectives(selectedMapLimits.maxDetectives);
    } else if (numDetectives < selectedMapLimits.minDetectives) {
      setNumDetectives(selectedMapLimits.minDetectives);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMapLimits.minDetectives, selectedMapLimits.maxDetectives]);

  // Compute the fair-split seat layout live as the host adjusts either
  // number. If the current combination is invalid (e.g. more
  // detective-controllers than detectives), show a clear message instead
  // of crashing -- computeSeatLayout throws on invalid input by design.
  useEffect(() => {
    try {
      computeSeatLayout(numDetectives, totalPlayers);
      setSeatErr("");
    } catch (e) {
      setSeatErr(e.message);
    }
    // if the previously chosen host role no longer exists in the new
    // layout (e.g. detective count dropped), fall back to Mr. X
    if (hostRole !== "mrx") {
      try {
        const layout = computeSeatLayout(numDetectives, totalPlayers);
        if (!layout.some((s) => s.seatRole === hostRole)) {
          setHostRole("mrx");
        }
      } catch {
        setHostRole("mrx");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numDetectives, totalPlayers]);

  let seatLayout = [];
  try {
    seatLayout = computeSeatLayout(numDetectives, totalPlayers);
  } catch {
    seatLayout = [];
  }

  async function handleSubmit() {
    if (!displayName.trim()) {
      setErr("Enter your name first.");
      return;
    }
    if (seatErr) {
      setErr(seatErr);
      return;
    }
    if (isPublic && !roomName.trim()) {
      setErr("Public rooms need a name so others can find them.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onCreate({
        displayName: displayName.trim(),
        mapId,
        numDetectives,
        totalPlayers,
        hostRole,
        mapStationCount: selectedMap ? Object.keys(selectedMap.stations).length : null,
        turnTimerSeconds,
        planningTimeSeconds,
        featureOverrides,
        isPublic,
        roomName: isPublic ? roomName.trim() : null,
      });
    } catch (e) {
      setErr(e.message || "Failed to create room.");
      setBusy(false);
    }
  }

  const roleOptions = [
    { value: "mrx", label: seatLabel("mrx", selectedMapTheme) },
    ...seatLayout.map((s) => ({ value: s.seatRole, label: seatLabel(s.seatRole, selectedMapTheme) })),
  ];

  return (
    <div style={styles.form}>
      <label style={styles.label}>Your name</label>
      <input
        style={styles.textInput}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="e.g. Priya"
        maxLength={24}
      />

      <label style={styles.label}>Map</label>
      <select style={styles.select} value={mapId} onChange={(e) => setMapId(e.target.value)}>
        {activeMaps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      {featureConfig?.publicRoomsEnabled && (
        <>
          <label style={styles.label}>Room visibility</label>
          <div style={styles.rowCenter}>
            <button
              style={{ ...styles.pill, ...(!isPublic ? styles.pillActive : {}) }}
              onClick={() => setIsPublic(false)}
              type="button"
            >
              Private (code only)
            </button>
            <button
              style={{ ...styles.pill, ...(isPublic ? styles.pillActive : {}) }}
              onClick={() => setIsPublic(true)}
              type="button"
            >
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

      <label style={styles.label}>
        Number of detectives ({selectedMapLimits.minDetectives}–{selectedMapLimits.maxDetectives})
      </label>
      <input
        type="number"
        min={selectedMapLimits.minDetectives}
        max={selectedMapLimits.maxDetectives}
        style={styles.numberInput}
        value={numDetectives}
        onChange={(e) =>
          setNumDetectives(
            Math.max(
              selectedMapLimits.minDetectives,
              Math.min(selectedMapLimits.maxDetectives, parseInt(e.target.value, 10) || selectedMapLimits.minDetectives)
            )
          )
        }
      />

      <label style={styles.label}>Total players (including you)</label>
      <input
        type="number"
        min={2}
        max={numDetectives + 1}
        style={styles.numberInput}
        value={totalPlayers}
        onChange={(e) => setTotalPlayers(Math.max(2, Math.min(numDetectives + 1, parseInt(e.target.value, 10) || 2)))}
      />
      <p style={styles.hostNote}>
        1 player will be Mr. X; the rest split the {numDetectives} detectives as evenly as possible.
      </p>

      {seatErr ? (
        <div style={styles.errText}>{seatErr}</div>
      ) : (
        <div style={styles.seatPreview}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Seat layout preview:</div>
          <div>Mr. X</div>
          {seatLayout.map((s) => (
            <div key={s.seatRole}>{seatLabel(s.seatRole, selectedMapTheme)}</div>
          ))}
        </div>
      )}

      <label style={styles.label}>Your role</label>
      <select style={styles.select} value={hostRole} onChange={(e) => setHostRole(e.target.value)}>
        {roleOptions.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      <p style={styles.hostNote}>Other players will pick from the remaining seats when they join.</p>

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
          {/* v3.32 -- FOUR independent highlight slots (planning origin,
              planning destination, acting origin, acting destination).
              Each is offered to the host only if the admin left that
              specific slot host-overridable, exactly as the original two
              were. The two planning keys keep their old, unprefixed
              names, so a room that already had an override keeps it. */}
          {(featureConfig.positionHighlightStyleOverridable ||
            featureConfig.destinationHighlightStyleOverridable ||
            featureConfig.actingPositionHighlightStyleOverridable ||
            featureConfig.actingDestinationHighlightStyleOverridable) && (
            <div style={styles.highlightStylesHeading}>
              Highlight styles{" "}
              <InfoIcon text="Controls how a station is visually marked as someone's current position vs. a place they could move to. Planning applies while the team is previewing routes before anyone moves; acting applies during the simultaneous move phase itself. Purely visual -- doesn't change what's legal to click." />
            </div>
          )}
          {[
            {
              key: "positionHighlightStyle",
              overridableKey: "positionHighlightStyleOverridable",
              label: "Planning phase — origin/position highlight style",
            },
            {
              key: "destinationHighlightStyle",
              overridableKey: "destinationHighlightStyleOverridable",
              label: "Planning phase — destination highlight style",
            },
            {
              key: "actingPositionHighlightStyle",
              overridableKey: "actingPositionHighlightStyleOverridable",
              label: "Acting phase — origin/position highlight style",
            },
            {
              key: "actingDestinationHighlightStyle",
              overridableKey: "actingDestinationHighlightStyleOverridable",
              label: "Acting phase — destination highlight style",
            },
          ].map(({ key, overridableKey, label }) =>
            featureConfig[overridableKey] ? (
              <label key={key} style={styles.featureOverrideRow}>
                <span>{label}</span>
                <select
                  style={styles.featureOverrideSelect}
                  value={featureOverrides[key] ?? featureConfig[key] ?? "ring"}
                  onChange={(e) => setFeatureOverrides((prev) => ({ ...prev, [key]: e.target.value }))}
                >
                  <option value="ring">Pulsing ring</option>
                  <option value="rotating">Rotating ring</option>
                  <option value="blink">Blink</option>
                  <option value="static">Static ring</option>
                  <option value="none">None</option>
                </select>
              </label>
            ) : null
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
                  onClick={(e) => {
                    e.preventDefault();
                    const current = turnTimerSeconds === null || turnTimerSeconds === "" ? publicConfig.turnTimerMin : parseInt(turnTimerSeconds, 10) || publicConfig.turnTimerMin;
                    const next = Math.max(publicConfig.turnTimerMin, Math.min(publicConfig.turnTimerMax, current - 10));
                    setTurnTimerSecondsState(next);
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
                    // Allow free typing/clearing while the field has focus --
                    // only digits or empty, no clamping mid-keystroke (the
                    // real bug: clamping on every change made it impossible
                    // to type a new value, since e.g. typing "1" of "180"
                    // got immediately snapped to the minimum before "8" and
                    // "0" could be typed).
                    if (v === "" || /^\d*$/.test(v)) {
                      setTurnTimerSecondsState(v === "" ? null : v);
                    }
                  }}
                  onBlur={() => {
                    // Validate and clamp only once the user is done editing.
                    if (turnTimerSeconds === null || turnTimerSeconds === "") {
                      setTurnTimerSecondsState(null);
                      return;
                    }
                    const n = Math.max(publicConfig.turnTimerMin, Math.min(publicConfig.turnTimerMax, parseInt(turnTimerSeconds, 10) || publicConfig.turnTimerMin));
                    setTurnTimerSecondsState(n);
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase turn timer by 10 seconds"
                  style={styles.timerStepBtn}
                  onClick={(e) => {
                    e.preventDefault();
                    const current = turnTimerSeconds === null || turnTimerSeconds === "" ? publicConfig.turnTimerMin : parseInt(turnTimerSeconds, 10) || publicConfig.turnTimerMin;
                    const next = Math.max(publicConfig.turnTimerMin, Math.min(publicConfig.turnTimerMax, current + 10));
                    setTurnTimerSecondsState(next);
                  }}
                >
                  +
                </button>
              </div>
            </label>
          )}

          {publicConfig && (
            <label style={styles.featureOverrideRow}>
              <span>Planning time (seconds) — shared team thinking time right after Mr. X moves; blank means no shared pause</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-label="Decrease planning time by 10 seconds"
                  style={styles.timerStepBtn}
                  onClick={(e) => {
                    e.preventDefault();
                    const current = planningTimeSeconds === null || planningTimeSeconds === "" ? publicConfig.planningTimeMin : parseInt(planningTimeSeconds, 10) || publicConfig.planningTimeMin;
                    const next = Math.max(publicConfig.planningTimeMin, Math.min(publicConfig.planningTimeMax, current - 10));
                    setPlanningTimeSecondsState(next);
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
                      setPlanningTimeSecondsState(v === "" ? null : v);
                    }
                  }}
                  onBlur={() => {
                    if (planningTimeSeconds === null || planningTimeSeconds === "") {
                      setPlanningTimeSecondsState(null);
                      return;
                    }
                    const n = Math.max(publicConfig.planningTimeMin, Math.min(publicConfig.planningTimeMax, parseInt(planningTimeSeconds, 10) || publicConfig.planningTimeMin));
                    setPlanningTimeSecondsState(n);
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase planning time by 10 seconds"
                  style={styles.timerStepBtn}
                  onClick={(e) => {
                    e.preventDefault();
                    const current = planningTimeSeconds === null || planningTimeSeconds === "" ? publicConfig.planningTimeMin : parseInt(planningTimeSeconds, 10) || publicConfig.planningTimeMin;
                    const next = Math.max(publicConfig.planningTimeMin, Math.min(publicConfig.planningTimeMax, current + 10));
                    setPlanningTimeSecondsState(next);
                  }}
                >
                  +
                </button>
              </div>
            </label>
          )}
        </div>
      )}

      {err && <div style={styles.errText}>{err}</div>}

      <button style={styles.primaryBtn} onClick={handleSubmit} disabled={busy || !!seatErr}>
        {busy ? "Creating..." : "Create Room"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PUBLIC ROOMS BROWSER — live-updating list of joinable public rooms,
// shown inline in the Join Room form as an alternative to typing a code.
// Each entry shows the host-chosen name and how full it is; clicking one
// runs the same lookup flow as typing its code manually. The list itself
// updates live (see usePublicRooms) as rooms fill up or start, so a room
// that becomes unjoinable mid-browse simply disappears rather than
// leaving a stale, clickable-but-broken entry.
// ---------------------------------------------------------------------------
function PublicRoomsBrowser({ onPickRoom }) {
  const { rooms, loading } = usePublicRooms();

  if (loading) {
    return <div style={styles.publicRoomsNote}>Checking for public rooms...</div>;
  }
  if (rooms.length === 0) {
    return <div style={styles.publicRoomsNote}>No public rooms are open right now.</div>;
  }

  return (
    <div style={styles.publicRoomsBox}>
      <div style={styles.publicRoomsTitle}>Or join a public room</div>
      {rooms.map((r) => (
        <button key={r.roomId} style={styles.publicRoomRow} onClick={() => onPickRoom(r.roomCode)}>
          <span style={styles.publicRoomName}>{r.roomName}</span>
          <span style={styles.publicRoomFill}>
            {r.joinedCount} / {r.totalPlayers} joined
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// REJOIN FLOW — shown when a looked-up room has already started (join_room
// explicitly refuses these). Lists every seat that's currently INACTIVE
// (via get_reconnectable_seats, using the same Presence signal as the
// rest of the app), lets the disconnected player self-identify by name,
// and reconnects them to their EXACT existing seat -- no new player row,
// no vote, no disruption to game state, just picking back up.
// ---------------------------------------------------------------------------
function RejoinFlow({ roomCode, onBack, onJoin }) {
  const [seats, setSeats] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [theme, setTheme] = useState({});

  useEffect(() => {
    api
      .getReconnectableSeats(roomCode)
      .then((rows) => {
        setSeats(rows);
        // Look up this room's map once (any seat's roomId works, they're
        // all the same room) so seat labels below use this room's real
        // Mr. X/detective-team nomenclature instead of the generic
        // default. Best-effort -- a failure here just means this one
        // screen falls back to generic labels, not worth blocking the
        // actual rejoin flow over.
        if (rows && rows[0]) {
          api
            .fetchRoom(rows[0].roomId)
            .then(async (room) => {
              const rawMap = MAP_LIST.find((m) => m.id === room.map_id);
              if (!rawMap) return;
              // Apply any admin-saved theme override too (not just the
              // map's own baked-in default) -- same source of truth
              // every other screen uses.
              const overrides = await auth.getMapOverrides().catch(() => ({}));
              const map = applyMapOverride(rawMap, overrides[rawMap.id]);
              setTheme({ mrxName: map.mrxName, detectiveTeamName: map.detectiveTeamName });
            })
            .catch(() => {});
        }
      })
      .catch((e) => setErr(e.message || "Failed to check this room."));
  }, [roomCode]);

  async function handleRejoin() {
    const seat = seats.find((s) => s.playerId === selectedPlayerId);
    if (!seat) {
      setErr("Choose which seat is yours.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onJoin.rejoin({
        playerId: seat.playerId,
        roomId: seat.roomId,
        role: seat.role,
        roomCode,
        displayName: displayName.trim() || seat.displayName,
      });
    } catch (e) {
      setErr(e.message || "Failed to rejoin.");
      setBusy(false);
    }
  }

  return (
    <div style={styles.form}>
      <button style={styles.linkBtn} onClick={onBack}>
        ← Different code
      </button>

      <div style={styles.hostNote}>
        This game has already started. If you were disconnected, pick your seat below to rejoin exactly where you left
        off.
      </div>

      {err && <div style={styles.errText}>{err}</div>}

      {!seats && !err && <div style={styles.hostNote}>Checking this room...</div>}

      {seats && seats.length === 0 && (
        <div style={styles.hostNote}>
          Every seat in this room currently looks active — if you were just disconnected, wait a few seconds and try
          again.
        </div>
      )}

      {seats && seats.length > 0 && (
        <>
          <label style={styles.label}>Which seat is yours?</label>
          <div style={styles.rowCenter}>
            {seats.map((s) => (
              <button
                key={s.playerId}
                style={{ ...styles.pill, ...(selectedPlayerId === s.playerId ? styles.pillActive : {}) }}
                onClick={() => setSelectedPlayerId(s.playerId)}
              >
                {seatLabel(s.role, theme)} ({s.displayName})
              </button>
            ))}
          </div>

          <label style={styles.label}>Your name (optional — leave blank to keep your original name)</label>
          <input
            style={styles.textInput}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Rahul"
            maxLength={24}
          />

          <button style={styles.primaryBtn} onClick={handleRejoin} disabled={busy || !selectedPlayerId}>
            {busy ? "Rejoining..." : "Rejoin Game"}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOBBY REJOIN FLOW — the lobby-phase counterpart to RejoinFlow (which is
// for an already-started game). Triggered when a normal join attempt
// hits "seat already taken", which can genuinely mean either a stranger
// trying to steal an active seat (blocked server-side) or the SAME
// player reconnecting to their own abandoned seat pre-game (previously
// a complete dead end -- see free_inactive_lobby_seat/rejoin_lobby_seat
// in functions.sql for the full reasoning).
// ---------------------------------------------------------------------------
function LobbyRejoinFlow({ roomCode, onBack, onJoin }) {
  const [seats, setSeats] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [theme, setTheme] = useState({});

  useEffect(() => {
    api
      .getReconnectableLobbySeats(roomCode)
      .then((rows) => {
        setSeats(rows);
        // Same best-effort theme lookup as RejoinFlow -- see its comment.
        if (rows && rows[0]) {
          api
            .fetchRoom(rows[0].roomId)
            .then(async (room) => {
              const rawMap = MAP_LIST.find((m) => m.id === room.map_id);
              if (!rawMap) return;
              const overrides = await auth.getMapOverrides().catch(() => ({}));
              const map = applyMapOverride(rawMap, overrides[rawMap.id]);
              setTheme({ mrxName: map.mrxName, detectiveTeamName: map.detectiveTeamName });
            })
            .catch(() => {});
        }
      })
      .catch((e) => setErr(e.message || "Failed to check this room."));
  }, [roomCode]);

  async function handleRejoin() {
    const seat = seats.find((s) => s.playerId === selectedPlayerId);
    if (!seat) {
      setErr("Choose which seat is yours.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onJoin.lobbyRejoin({ playerId: seat.playerId, roomCode, displayName: displayName.trim() });
    } catch (e) {
      setErr(e.message || "Failed to rejoin.");
      setBusy(false);
    }
  }

  return (
    <div style={styles.form}>
      <button style={styles.linkBtn} onClick={onBack}>
        ← Different code
      </button>

      <div style={styles.hostNote}>
        That seat is already claimed. If it's yours from before (e.g. you got disconnected), pick your name below to
        get back into the lobby.
      </div>

      {err && <div style={styles.errText}>{err}</div>}

      {!seats && !err && <div style={styles.hostNote}>Checking this room...</div>}

      {seats && seats.length === 0 && (
        <div style={styles.hostNote}>
          Every seat in this lobby currently looks active — if you were just disconnected, wait a few seconds and try
          again.
        </div>
      )}

      {seats && seats.length > 0 && (
        <>
          <label style={styles.label}>Which seat is yours?</label>
          <div style={styles.rowCenter}>
            {seats.map((s) => (
              <button
                key={s.playerId}
                style={{ ...styles.pill, ...(selectedPlayerId === s.playerId ? styles.pillActive : {}) }}
                onClick={() => setSelectedPlayerId(s.playerId)}
              >
                {seatLabel(s.role, theme)} ({s.displayName})
              </button>
            ))}
          </div>

          <label style={styles.label}>Your name (optional — leave blank to keep your original name)</label>
          <input
            style={styles.textInput}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Rahul"
            maxLength={24}
          />

          <button style={styles.primaryBtn} onClick={handleRejoin} disabled={busy || !selectedPlayerId}>
            {busy ? "Rejoining..." : "Rejoin Lobby"}
          </button>
        </>
      )}
    </div>
  );
}

function JoinRoomForm({ onJoin, accountDisplayName }) {
  const [displayName, setDisplayName] = useState(accountDisplayName || "");
  const [roomCode, setRoomCode] = useState("");
  const [roomInfo, setRoomInfo] = useState(null); // { numDetectives, takenRoles } once code is looked up
  const [startedRoomCode, setStartedRoomCode] = useState(null); // set when the looked-up room has already started -- triggers the REJOIN flow instead of role selection
  const [lobbyRejoinCode, setLobbyRejoinCode] = useState(null); // set when a "seat already taken" error suggests this is the SAME player reconnecting to their own lobby seat
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Theme (Mr. X / detective team names) for whichever room's code was
  // just looked up, so the role-picker below reads with this room's real
  // nomenclature instead of the generic default -- unconditional hook
  // call (Rules of Hooks), safe even before roomInfo/mapId is known since
  // useMapWithOverrides itself handles a null map.
  const rawJoinMap = roomInfo?.mapId ? MAP_LIST.find((m) => m.id === roomInfo.mapId) : null;
  const joinMap = useMapWithOverrides(rawJoinMap) || rawJoinMap;
  const joinTheme = { mrxName: joinMap?.mrxName, detectiveTeamName: joinMap?.detectiveTeamName };

  async function handleLookup() {
    if (!roomCode.trim()) {
      setErr("Enter the room code.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const info = await onJoin.lookup(roomCode.trim().toUpperCase());
      if (info.status !== "lobby") {
        // The game has already started -- join_room would refuse this
        // outright, so offer the REJOIN flow instead of a dead-end
        // role-selection screen that's guaranteed to fail on submit.
        setStartedRoomCode(roomCode.trim().toUpperCase());
        return;
      }
      setRoomInfo(info);
    } catch (e) {
      setErr(e.message || "Room not found.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!displayName.trim()) {
      setErr("Enter your name first.");
      return;
    }
    if (!role) {
      setErr("Pick a role to join as.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onJoin.confirm({ displayName: displayName.trim(), roomCode: roomCode.trim().toUpperCase(), role });
    } catch (e) {
      // "Seat already taken" can mean two very different things: a
      // stranger trying to steal someone else's still-active seat (a
      // real error, should stay blocked), OR the SAME player reconnecting
      // to their own seat after a disconnect while still in the lobby
      // (a real gap found during the failure-point audit -- previously a
      // complete dead end, since this exact message gave no path
      // forward). Offering the lobby-rejoin flow here lets the genuine
      // case resolve itself; get_reconnectable_lobby_seats/
      // rejoin_lobby_seat's own server-side activity check is what
      // actually still blocks the stranger-stealing case.
      if (e.message && e.message.includes("already been taken")) {
        setLobbyRejoinCode(roomCode.trim().toUpperCase());
        setBusy(false);
        return;
      }
      setErr(e.message || "Failed to join room.");
      setBusy(false);
    }
  }

  if (startedRoomCode) {
    return <RejoinFlow roomCode={startedRoomCode} onBack={() => setStartedRoomCode(null)} onJoin={onJoin} />;
  }

  if (lobbyRejoinCode) {
    return <LobbyRejoinFlow roomCode={lobbyRejoinCode} onBack={() => setLobbyRejoinCode(null)} onJoin={onJoin} />;
  }

  if (!roomInfo) {
    return (
      <div style={styles.form}>
        <label style={styles.label}>Room code</label>
        <input
          style={{ ...styles.textInput, textTransform: "uppercase", letterSpacing: 2, fontWeight: 700 }}
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          placeholder="e.g. BXQP42"
          maxLength={6}
        />
        {err && <div style={styles.errText}>{err}</div>}
        <button style={styles.primaryBtn} onClick={handleLookup} disabled={busy}>
          {busy ? "Looking up..." : "Find Room"}
        </button>
        <PublicRoomsBrowser
          onPickRoom={async (code) => {
            setRoomCode(code);
            setBusy(true);
            setErr("");
            try {
              const info = await onJoin.lookup(code);
              setRoomInfo(info);
            } catch (e) {
              setErr(e.message || "Room not found.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    );
  }

  const allSlots = ["mrx", ...(computeSeatLayoutSafe(roomInfo.numDetectives, roomInfo.totalPlayers).map((s) => s.seatRole))];

  return (
    <div style={styles.form}>
      <button style={styles.linkBtn} onClick={() => setRoomInfo(null)}>
        ← Different code
      </button>

      <label style={styles.label}>Your name</label>
      <input
        style={styles.textInput}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="e.g. Rahul"
        maxLength={24}
      />

      <label style={styles.label}>Choose your role</label>
      <div style={styles.rowCenter}>
        {allSlots.map((s) => {
          const taken = roomInfo.takenRoles.includes(s);
          const label = seatLabel(s, joinTheme);
          return (
            <button
              key={s}
              disabled={taken}
              style={{
                ...styles.pill,
                ...(role === s ? styles.pillActive : {}),
                ...(taken ? styles.choiceBtnDisabled : {}),
              }}
              onClick={() => setRole(s)}
            >
              {label}
              {taken ? " (taken)" : ""}
            </button>
          );
        })}
      </div>

      {err && <div style={styles.errText}>{err}</div>}

      <button style={styles.primaryBtn} onClick={handleSubmit} disabled={busy}>
        {busy ? "Joining..." : "Join Room"}
      </button>
    </div>
  );
}

const styles = {
  adminLinkBtn: {
    marginTop: 16,
    background: "none",
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 12,
    color: "#888",
    cursor: "pointer",
    width: "100%",
  },
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100vh",
    background: "#f7f6f3",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    boxSizing: "border-box",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 28,
    maxWidth: 480,
    width: "100%",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    textAlign: "center",
  },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  logoutBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    color: "#888",
    cursor: "pointer",
    flexShrink: 0,
  },
  title: { margin: "0 0 4px", fontSize: 28, letterSpacing: -0.5 },
  subtitle: { color: "#777", marginBottom: 24, fontSize: 14 },
  choiceStack: { display: "flex", flexDirection: "column", gap: 10 },
  choiceBtn: {
    textAlign: "left",
    border: "1.5px solid #ddd",
    background: "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
  },
  choiceBtnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  choiceTitle: { fontWeight: 700, fontSize: 15, marginBottom: 3 },
  choiceDesc: { fontSize: 12.5, color: "#777" },
  form: { display: "flex", flexDirection: "column", gap: 6, textAlign: "left" },
  label: { fontSize: 13, color: "#555", fontWeight: 600, marginTop: 8 },
  textInput: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1.5px solid #ddd",
    fontSize: 14,
  },
  numberInput: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1.5px solid #ddd",
    fontSize: 14,
    width: 80,
  },
  seatPreview: {
    background: "#f4f2ec",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    color: "#444",
    lineHeight: 1.6,
  },
  select: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1.5px solid #ddd",
    fontSize: 14,
    background: "#fff",
  },
  rowCenter: { display: "flex", gap: 8, flexWrap: "wrap" },
  pill: {
    border: "1.5px solid #ddd",
    background: "#fff",
    borderRadius: 999,
    padding: "8px 16px",
    fontSize: 15,
    cursor: "pointer",
  },
  pillActive: { borderColor: "#111", background: "#111", color: "#fff" },
  hostNote: { fontSize: 12.5, color: "#888", marginTop: 4 },
  featureOverridesBox: {
    background: "#f4f2ec",
    borderRadius: 10,
    padding: "12px 14px",
    marginTop: 10,
    textAlign: "left",
  },
  featureOverridesTitle: { fontSize: 12.5, fontWeight: 700, color: "#555", marginBottom: 8 },
  highlightStylesHeading: {
    fontSize: 12.5,
    fontWeight: 700,
    color: "#555",
    marginTop: 10,
    marginBottom: 4,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  featureOverrideRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12.5,
    padding: "5px 0",
  },
  featureOverrideSelect: { padding: "3px 6px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 },
  timerStepBtn: {
    width: 26,
    height: 26,
    flexShrink: 0,
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#fff",
    fontSize: 14,
    fontWeight: 700,
    color: "#333",
    cursor: "pointer",
    lineHeight: 1,
  },
  publicRoomsNote: { fontSize: 12.5, color: "#999", marginTop: 14, textAlign: "center" },
  publicRoomsBox: { marginTop: 16, textAlign: "left" },
  publicRoomsTitle: { fontSize: 12.5, fontWeight: 700, color: "#555", marginBottom: 8 },
  publicRoomRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    background: "#fafafa",
    border: "1.5px solid #ddd",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 6,
    fontFamily: "inherit",
  },
  publicRoomName: { fontWeight: 600 },
  publicRoomFill: { color: "#888", fontSize: 12 },
  errText: { color: "#c0392b", fontSize: 13, marginTop: 4 },
  primaryBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 12,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#888",
    marginTop: 8,
    cursor: "pointer",
    fontSize: 13,
    textDecoration: "underline",
  },
};
