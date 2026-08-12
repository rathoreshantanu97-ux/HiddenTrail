import React, { useState, useEffect, useCallback } from "react";
import * as auth from "../lib/accessControlApi.js";
import { MAP_LIST } from "../maps/index.js";
import MapEditorPanel from "./MapEditorPanel.jsx";

// ---------------------------------------------------------------------------
// ADMIN PANEL — only reachable by an account with is_admin = true (the
// RPCs themselves enforce this server-side; this component just doesn't
// bother rendering for anyone else). Covers: the public/private toggle,
// pending access/upgrade requests awaiting an OTP relay, a table of every
// account with its invite-code usage and an easy limit-adjuster, per-map
// activate/deactivate, and turn-timer bounds / default invite limit.
// ---------------------------------------------------------------------------
export default function AdminPanel({ accountId, onBack }) {
  const [showMapEditor, setShowMapEditor] = useState(false);
  const [isPublic, setIsPublicState] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [pending, setPending] = useState([]);
  const [inactiveMapIds, setInactiveMapIds] = useState([]);
  const [config, setConfig] = useState({
    turnTimerMin: 30,
    turnTimerMax: 300,
    defaultInviteLimit: 20,
    planningTimeMin: 30,
    planningTimeMax: 600,
    mrxSecondsMin: 15,
    mrxSecondsMax: 900,
    mrxTimeRatio: 3,
    extraSeatTimeRatio: 0.5,
  });
  const [configDraft, setConfigDraft] = useState(config);
  const [timingConfig, setTimingConfigState] = useState(null);
  const [timingDraft, setTimingDraft] = useState(null);
  const [featureDraft, setFeatureDraft] = useState(null);
  const [mapOverridesDraft, setMapOverridesDraft] = useState({});
  const [mapOverridesBusy, setMapOverridesBusy] = useState({});
  const [mapOverridesSaved, setMapOverridesSaved] = useState({});
  const [gameConfigBusy, setGameConfigBusy] = useState(false);
  const [gameConfigSaved, setGameConfigSaved] = useState("");
  const [timingBusy, setTimingBusy] = useState(false);
  const [timingSaved, setTimingSaved] = useState("");
  const [featuresBusy, setFeaturesBusy] = useState(false);
  const [featuresSaved, setFeaturesSaved] = useState("");
  const [err, setErr] = useState("");
  const [publicToggleBusy, setPublicToggleBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [pub, accts, reqs, inactiveIds, cfg, timing, features, mapOverrides] = await Promise.all([
        auth.getAppPublicStatus(),
        auth.listAccountsForAdmin(accountId),
        auth.listPendingRequestsForAdmin(accountId),
        auth.getInactiveMapIds(),
        auth.getPublicConfig(),
        auth.getTimingConfig(),
        auth.getFeatureConfig(),
        auth.getMapOverrides(),
      ]);
      setIsPublicState(pub);
      setAccounts(accts);
      setPending(reqs);
      setInactiveMapIds(inactiveIds);
      setConfig(cfg);
      setConfigDraft(cfg);
      setTimingConfigState(timing);
      setTimingDraft(timing);
      setFeatureDraft(features);
      // Seed each map's draft with its EXISTING override if one is set,
      // otherwise leave it blank (meaning "use the computed default" --
      // an empty input, not the computed value itself, since we want to
      // visually distinguish "no override" from "override that happens
      // to equal the default").
      const seeded = {};
      for (const m of MAP_LIST) {
        const existing = mapOverrides[m.id];
        seeded[m.id] = {
          ratio: existing?.detectiveDensityRatioOverride != null ? String(existing.detectiveDensityRatioOverride) : "",
          tickets: existing?.ticketCountsOverride
            ? JSON.stringify(existing.ticketCountsOverride, null, 2)
            : JSON.stringify(m.ticketCounts, null, 2),
        };
      }
      setMapOverridesDraft(seeded);
    } catch (e) {
      setErr(e.message);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleTogglePublic() {
    setPublicToggleBusy(true);
    setErr("");
    try {
      await auth.setAppPublic({ callerAccountId: accountId, isPublic: !isPublic });
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setPublicToggleBusy(false);
    }
  }

  async function handleLimitChange(targetAccountId, newLimit) {
    setErr("");
    try {
      await auth.setInviteCodeLimit({ callerAccountId: accountId, targetAccountId, newLimit });
      await refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleRegenerate(targetAccountId) {
    setErr("");
    try {
      await auth.regenerateInviteCode({ callerAccountId: accountId, targetAccountId });
      await refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleToggleMap(mapId, currentlyActive) {
    setErr("");
    try {
      await auth.setMapActive({ callerAccountId: accountId, mapId, isActive: !currentlyActive });
      await refresh();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function handleSaveConfig() {
    setGameConfigBusy(true);
    setErr("");
    setGameConfigSaved("");
    try {
      await auth.setAppConfig({
        callerAccountId: accountId,
        turnTimerMin: Number(configDraft.turnTimerMin),
        turnTimerMax: Number(configDraft.turnTimerMax),
        defaultInviteLimit: Number(configDraft.defaultInviteLimit),
        planningTimeMin: Number(configDraft.planningTimeMin),
        planningTimeMax: Number(configDraft.planningTimeMax),
        mrxSecondsMin: Number(configDraft.mrxSecondsMin),
        mrxSecondsMax: Number(configDraft.mrxSecondsMax),
        mrxTimeRatio: Number(configDraft.mrxTimeRatio),
        extraSeatTimeRatio: Number(configDraft.extraSeatTimeRatio),
      });
      await refresh();
      setGameConfigSaved("Saved.");
      setTimeout(() => setGameConfigSaved(""), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGameConfigBusy(false);
    }
  }

  async function handleSaveTimingConfig() {
    setTimingBusy(true);
    setErr("");
    setTimingSaved("");
    try {
      await auth.setTimingConfig({
        callerAccountId: accountId,
        config: {
          nominationWindowSeconds: Number(timingDraft.nominationWindowSeconds),
          pollWindowSeconds: Number(timingDraft.pollWindowSeconds),
          minDetectives: Number(timingDraft.minDetectives),
          maxDetectives: Number(timingDraft.maxDetectives),
          minTotalPlayers: Number(timingDraft.minTotalPlayers),
          maxTotalPlayers: Number(timingDraft.maxTotalPlayers),
          presenceGracePeriodSeconds: Number(timingDraft.presenceGracePeriodSeconds),
          pauseResumeDeadlineHours: Number(timingDraft.pauseResumeDeadlineHours),
        },
      });
      await refresh();
      setTimingSaved("Saved.");
      setTimeout(() => setTimingSaved(""), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setTimingBusy(false);
    }
  }

  async function handleSaveFeatures() {
    setFeaturesBusy(true);
    setErr("");
    setFeaturesSaved("");
    try {
      await auth.setFeatureToggles({
        callerAccountId: accountId,
        config: { ...featureDraft, roundScalingRatio: Number(featureDraft.roundScalingRatio) },
      });
      await refresh();
      setFeaturesSaved("Saved.");
      setTimeout(() => setFeaturesSaved(""), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setFeaturesBusy(false);
    }
  }

  async function handleSaveMapOverride(mapId) {
    setMapOverridesBusy((prev) => ({ ...prev, [mapId]: true }));
    setErr("");
    setMapOverridesSaved((prev) => ({ ...prev, [mapId]: "" }));
    try {
      const draft = mapOverridesDraft[mapId];
      const ratioValue = draft.ratio.trim() === "" ? null : Number(draft.ratio);
      let ticketsValue = null;
      // An empty tickets field or one that exactly matches the computed
      // default (re-serialized) is treated as "no override" -- only a
      // genuinely edited JSON blob counts as an explicit override.
      const computedDefault = JSON.stringify(MAP_LIST.find((m) => m.id === mapId)?.ticketCounts, null, 2);
      if (draft.tickets.trim() !== "" && draft.tickets.trim() !== computedDefault) {
        try {
          ticketsValue = JSON.parse(draft.tickets);
        } catch {
          throw new Error("Ticket counts must be valid JSON (see the pre-filled example for the expected shape).");
        }
      }
      await auth.setMapTicketOverrides({
        callerAccountId: accountId,
        mapId,
        detectiveDensityRatioOverride: ratioValue,
        ticketCountsOverride: ticketsValue,
      });
      await refresh();
      setMapOverridesSaved((prev) => ({ ...prev, [mapId]: "Saved." }));
      setTimeout(() => setMapOverridesSaved((prev) => ({ ...prev, [mapId]: "" })), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setMapOverridesBusy((prev) => ({ ...prev, [mapId]: false }));
    }
  }

  if (showMapEditor) {
    return <MapEditorPanel accountId={accountId} onBack={() => setShowMapEditor(false)} />;
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Admin Panel</h1>
        <button style={styles.backBtn} onClick={onBack}>
          Back to game
        </button>
      </div>

      {err && <div style={styles.errText}>{err}</div>}

      <div style={styles.card}>
        <div style={styles.cardTitle}>App access mode</div>
        <div style={styles.toggleRow}>
          <div>
            <div style={{ fontWeight: 700 }}>{isPublic ? "Public" : "Private"}</div>
            <div style={styles.smallNote}>
              {isPublic
                ? "Anyone can join as a guest, in addition to registered accounts."
                : "Only registered accounts (approved or invite-code) can access the app."}
            </div>
          </div>
          <button style={styles.toggleBtn} onClick={handleTogglePublic} disabled={publicToggleBusy}>
            Switch to {isPublic ? "Private" : "Public"}
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Maps</div>
        <div style={styles.smallNote}>Deactivated maps won't appear in the map picker for new games.</div>
        <button style={{ ...styles.toggleBtn, marginBottom: 12 }} onClick={() => setShowMapEditor(true)}>
          Open Map Editor (drag curves &amp; adjust stations)
        </button>
        <div style={styles.mapRow}>
          {MAP_LIST.map((m) => {
            const active = !inactiveMapIds.includes(m.id);
            return (
              <div key={m.id} style={styles.mapItem}>
                <span style={{ fontWeight: 600 }}>{m.label}</span>
                <button
                  style={{ ...styles.smallBtn, ...(active ? {} : styles.smallBtnInactive) }}
                  onClick={() => handleToggleMap(m.id, active)}
                >
                  {active ? "Active" : "Inactive"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Per-map detective limits &amp; ticket counts</div>
        <div style={styles.smallNote}>
          Every map computes sensible defaults automatically from its own layout (detective density from station
          count; ticket counts from actual travel distances). Leave a field blank to use the computed default —
          only fill it in to explicitly override that ONE map. Detective density ratio is capped between 1% and 20%
          regardless of what's entered.
        </div>
        {MAP_LIST.map((m) => {
          const draft = mapOverridesDraft[m.id] || { ratio: "", tickets: "" };
          const computedDetectiveMax = m.mapLimits?.maxDetectives;
          return (
            <div key={m.id} style={styles.mapOverrideBlock}>
              <div style={styles.mapOverrideTitle}>
                {m.label}{" "}
                <span style={styles.smallNote}>(computed default max detectives: {computedDetectiveMax})</span>
              </div>
              <label style={styles.configLabel}>
                Detective density ratio override (e.g. 0.08 for 8%) — blank uses the computed default
                <input
                  type="text"
                  placeholder="blank = computed default"
                  style={styles.configInput}
                  value={draft.ratio}
                  onChange={(e) =>
                    setMapOverridesDraft((prev) => ({ ...prev, [m.id]: { ...prev[m.id], ratio: e.target.value } }))
                  }
                />
              </label>
              <label style={styles.configLabel}>
                Ticket counts override (JSON) — edit to override, leave matching the pre-filled default to use it
                <textarea
                  style={styles.mapOverrideTextarea}
                  value={draft.tickets}
                  onChange={(e) =>
                    setMapOverridesDraft((prev) => ({ ...prev, [m.id]: { ...prev[m.id], tickets: e.target.value } }))
                  }
                />
              </label>
              <button
                style={styles.toggleBtn}
                onClick={() => handleSaveMapOverride(m.id)}
                disabled={mapOverridesBusy[m.id]}
              >
                {mapOverridesBusy[m.id] ? "Saving..." : `Save ${m.label} overrides`}
              </button>
              {mapOverridesSaved[m.id] && (
                <span style={{ marginLeft: 10, color: "#2a8", fontSize: 12.5 }}>{mapOverridesSaved[m.id]}</span>
              )}
            </div>
          );
        })}
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Game settings</div>
        <div style={styles.configGrid}>
          <label style={styles.configLabel}>
            Turn timer minimum (seconds)
            <input
              type="number"
              min={15}
              style={styles.configInput}
              value={configDraft.turnTimerMin}
              onChange={(e) => setConfigDraft({ ...configDraft, turnTimerMin: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Turn timer maximum (seconds)
            <input
              type="number"
              max={600}
              style={styles.configInput}
              value={configDraft.turnTimerMax}
              onChange={(e) => setConfigDraft({ ...configDraft, turnTimerMax: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Default invite-code limit (for new accounts)
            <input
              type="number"
              min={1}
              style={styles.configInput}
              value={configDraft.defaultInviteLimit}
              onChange={(e) => setConfigDraft({ ...configDraft, defaultInviteLimit: e.target.value })}
            />
          </label>
        </div>

        {/* Turn schedule -- hosts set TWO numbers directly (the detective
            "turn timer" seconds, unchanged; and a new "planning time"
            seconds, the shared buffer), each bounded by the ranges set
            here. Mr. X's window is still DERIVED (mrxTimeRatio × planning
            time, clamped to the Mr.X bounds below) since Mr.X has no
            second number of his own to set -- see turnSchedule.js. */}
        <div style={{ ...styles.cardTitle, fontSize: 15, marginTop: 20 }}>Turn schedule</div>
        <p style={styles.smallNote}>
          Hosts set the detective turn timer AND a separate planning-time number directly (each bounded by the ranges
          below). Mr. X's window and the extra-seat top-up stay derived from these via the ratios below, since Mr.X
          has no second number of his own.
        </p>
        <div style={styles.configGrid}>
          <label style={styles.configLabel}>
            Planning time min (seconds)
            <input
              type="number"
              min={1}
              style={styles.configInput}
              value={configDraft.planningTimeMin}
              onChange={(e) => setConfigDraft({ ...configDraft, planningTimeMin: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Planning time max (seconds)
            <input
              type="number"
              min={1}
              style={styles.configInput}
              value={configDraft.planningTimeMax}
              onChange={(e) => setConfigDraft({ ...configDraft, planningTimeMax: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Mr. X's turn min (seconds)
            <input
              type="number"
              min={1}
              style={styles.configInput}
              value={configDraft.mrxSecondsMin}
              onChange={(e) => setConfigDraft({ ...configDraft, mrxSecondsMin: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Mr. X's turn max (seconds)
            <input
              type="number"
              min={1}
              style={styles.configInput}
              value={configDraft.mrxSecondsMax}
              onChange={(e) => setConfigDraft({ ...configDraft, mrxSecondsMax: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Mr. X's turn (× planning time)
            <input
              type="number"
              min={0.5}
              step={0.1}
              style={styles.configInput}
              value={configDraft.mrxTimeRatio}
              onChange={(e) => setConfigDraft({ ...configDraft, mrxTimeRatio: e.target.value })}
            />
          </label>
          <label style={styles.configLabel}>
            Extra detective seat (× the act timer)
            <input
              type="number"
              min={0}
              step={0.1}
              style={styles.configInput}
              value={configDraft.extraSeatTimeRatio}
              onChange={(e) => setConfigDraft({ ...configDraft, extraSeatTimeRatio: e.target.value })}
            />
          </label>
        </div>
        <div style={styles.smallNote}>
          Example: with a 20s act timer and a 90s planning time at the current draft values — Mr. X gets{" "}
          {Math.max(
            Number(configDraft.mrxSecondsMin || 0),
            Math.min(Number(configDraft.mrxSecondsMax || 99999), Math.ceil(90 * Number(configDraft.mrxTimeRatio || 0)))
          )}
          s, the shared planning buffer runs 90s, each detective gets 20s for their first seat this round and +
          {Math.ceil(20 * Number(configDraft.extraSeatTimeRatio || 0))}s for every additional seat they control.
        </div>

        <div style={styles.smallNote}>
          Turn timer minimum can never go below 15s, even if entered lower — this protects the inactivity-detection
          system from a conflicting configuration.
        </div>
        <button style={styles.toggleBtn} onClick={handleSaveConfig} disabled={gameConfigBusy}>
          {gameConfigBusy ? "Saving..." : "Save settings"}
        </button>
        {gameConfigSaved && <span style={{ marginLeft: 10, color: "#2a8", fontSize: 12.5 }}>{gameConfigSaved}</span>}
      </div>

      {timingDraft && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Room size &amp; takeover timing</div>
          <div style={styles.configGrid}>
            <label style={styles.configLabel}>
              Min detectives per room
              <input
                type="number"
                min={3}
                style={styles.configInput}
                value={timingDraft.minDetectives}
                onChange={(e) => setTimingDraft({ ...timingDraft, minDetectives: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Max detectives per room
              <input
                type="number"
                style={styles.configInput}
                value={timingDraft.maxDetectives}
                onChange={(e) => setTimingDraft({ ...timingDraft, maxDetectives: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Min total players per room
              <input
                type="number"
                min={2}
                style={styles.configInput}
                value={timingDraft.minTotalPlayers}
                onChange={(e) => setTimingDraft({ ...timingDraft, minTotalPlayers: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Max total players per room
              <input
                type="number"
                style={styles.configInput}
                value={timingDraft.maxTotalPlayers}
                onChange={(e) => setTimingDraft({ ...timingDraft, maxTotalPlayers: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Nomination window (seconds) — how long players have to volunteer for a takeover
              <input
                type="number"
                min={10}
                style={styles.configInput}
                value={timingDraft.nominationWindowSeconds}
                onChange={(e) => setTimingDraft({ ...timingDraft, nominationWindowSeconds: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Poll window (seconds) — how long a vote between multiple volunteers stays open
              <input
                type="number"
                min={15}
                style={styles.configInput}
                value={timingDraft.pollWindowSeconds}
                onChange={(e) => setTimingDraft({ ...timingDraft, pollWindowSeconds: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Presence grace period (seconds) — how long after disconnecting before someone is treated as inactive
              <input
                type="number"
                min={5}
                style={styles.configInput}
                value={timingDraft.presenceGracePeriodSeconds}
                onChange={(e) => setTimingDraft({ ...timingDraft, presenceGracePeriodSeconds: e.target.value })}
              />
            </label>
            <label style={styles.configLabel}>
              Pause resume deadline (hours) — how long a paused game can sit before auto-ending
              <input
                type="number"
                min={1}
                style={styles.configInput}
                value={timingDraft.pauseResumeDeadlineHours}
                onChange={(e) => setTimingDraft({ ...timingDraft, pauseResumeDeadlineHours: e.target.value })}
              />
            </label>
          </div>
          <div style={styles.smallNote}>
            Nomination window can never go below 10s, poll window never below 15s, and presence grace period never
            below 5s — even if entered lower, to keep these flows genuinely usable.
          </div>
          <button style={styles.toggleBtn} onClick={handleSaveTimingConfig} disabled={timingBusy}>
            {timingBusy ? "Saving..." : "Save timing settings"}
          </button>
          {timingSaved && <span style={{ marginLeft: 10, color: "#2a8", fontSize: 12.5 }}>{timingSaved}</span>}
        </div>
      )}

      {featureDraft && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Features</div>
          <div style={styles.smallNote}>
            Turn a feature off entirely, or leave it on but let hosts choose per-room whether to use it (defaults to
            on for every game unless the host explicitly opts out).
          </div>
          {[
            { key: "takeovers", label: "Inactivity takeovers (Mr.X & detectives)" },
            { key: "takeoverReversal", label: "Takeover reversal (unanimous vote to undo)" },
            { key: "endGameVote", label: "Vote to end game" },
            { key: "pauseResume", label: "Pause / resume" },
            { key: "redistributeRoles", label: "Host: redistribute roles" },
            { key: "routeExplorer", label: "Route explorer (show reachable stations by mode)" },
            { key: "draw", label: "Freehand drawing / annotation layer (detectives only)" },
            { key: "peek", label: "Peek into a teammate's screen" },
          ].map(({ key, label }) => (
            <div key={key} style={styles.featureRow}>
              <span style={styles.featureLabel}>{label}</span>
              <label style={styles.featureCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={featureDraft[`${key}Enabled`]}
                  onChange={(e) => setFeatureDraft({ ...featureDraft, [`${key}Enabled`]: e.target.checked })}
                />
                Enabled
              </label>
              <label style={styles.featureCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={featureDraft[`${key}Overridable`]}
                  onChange={(e) => setFeatureDraft({ ...featureDraft, [`${key}Overridable`]: e.target.checked })}
                  disabled={!featureDraft[`${key}Enabled`]}
                />
                Hosts can override per-room
              </label>
            </div>
          ))}

          <div style={styles.featureRow}>
            <span style={styles.featureLabel}>Position highlight style (default) — your turn / Mr. X's own view</span>
            <select
              style={styles.configInput}
              value={featureDraft.positionHighlightStyle}
              onChange={(e) => setFeatureDraft({ ...featureDraft, positionHighlightStyle: e.target.value })}
            >
              <option value="ring">Pulsing ring</option>
              <option value="rotating">Rotating ring</option>
              <option value="blink">Blink</option>
              <option value="static">Static ring</option>
              <option value="none">None</option>
            </select>
            <label style={styles.featureCheckboxLabel}>
              <input
                type="checkbox"
                checked={featureDraft.positionHighlightStyleOverridable}
                onChange={(e) => setFeatureDraft({ ...featureDraft, positionHighlightStyleOverridable: e.target.checked })}
              />
              Hosts can override per-room
            </label>
          </div>

          <div style={styles.featureRow}>
            <span style={styles.featureLabel}>Destination highlight style (default) — legal moves</span>
            <select
              style={styles.configInput}
              value={featureDraft.destinationHighlightStyle}
              onChange={(e) => setFeatureDraft({ ...featureDraft, destinationHighlightStyle: e.target.value })}
            >
              <option value="ring">Pulsing ring</option>
              <option value="rotating">Rotating ring</option>
              <option value="blink">Blink</option>
              <option value="static">Static ring</option>
              <option value="none">None</option>
            </select>
            <label style={styles.featureCheckboxLabel}>
              <input
                type="checkbox"
                checked={featureDraft.destinationHighlightStyleOverridable}
                onChange={(e) => setFeatureDraft({ ...featureDraft, destinationHighlightStyleOverridable: e.target.checked })}
              />
              Hosts can override per-room
            </label>
          </div>

          <div style={styles.featureRow}>
            <span style={styles.featureLabel}>Round-count scaling ratio (default 1.0, range 0.3–3.0)</span>
            <input
              type="number"
              step="0.1"
              min={0.3}
              max={3.0}
              style={styles.configInput}
              value={featureDraft.roundScalingRatio}
              onChange={(e) => setFeatureDraft({ ...featureDraft, roundScalingRatio: e.target.value })}
            />
            <label style={styles.featureCheckboxLabel}>
              <input
                type="checkbox"
                checked={featureDraft.roundScalingOverridable}
                onChange={(e) => setFeatureDraft({ ...featureDraft, roundScalingOverridable: e.target.checked })}
              />
              Hosts can override per-room
            </label>
          </div>

          <div style={styles.featureRow}>
            <span style={styles.featureLabel}>Allow hosts to create public rooms (listed in a live room browser)</span>
            <label style={styles.featureCheckboxLabel}>
              <input
                type="checkbox"
                checked={featureDraft.publicRoomsEnabled}
                onChange={(e) => setFeatureDraft({ ...featureDraft, publicRoomsEnabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <button style={styles.toggleBtn} onClick={handleSaveFeatures} disabled={featuresBusy}>
            {featuresBusy ? "Saving..." : "Save feature settings"}
          </button>
          {featuresSaved && <span style={{ marginLeft: 10, color: "#2a8", fontSize: 12.5 }}>{featuresSaved}</span>}
        </div>
      )}

      {pending.length > 0 && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>Pending requests ({pending.length})</div>
          {pending.map((r) => (
            <div key={r.id} style={styles.pendingRow}>
              <div>
                <strong>{r.requesterDisplayName}</strong>{" "}
                {r.requestType === "new_account" ? "(new account: " + r.requestedUsername + ")" : "(invite-code upgrade)"}
              </div>
              <div style={styles.smallNote}>
                Expires {new Date(r.expiresAt).toLocaleTimeString()} — check your email for their OTP to relay.
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.card}>
        <div style={styles.cardTitle}>All accounts ({accounts.length})</div>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>User</th>
                <th style={styles.th}>Invited by</th>
                <th style={styles.th}>Invite code</th>
                <th style={styles.th}>Uses / Limit</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td style={styles.td}>
                    {a.displayName} <span style={styles.usernameTag}>@{a.username}</span>
                    {a.isAdmin && <span style={styles.adminTag}>admin</span>}
                  </td>
                  <td style={styles.td}>{a.invitedByUsername ? "@" + a.invitedByUsername : "—"}</td>
                  <td style={styles.td}>{a.inviteCode || <span style={styles.smallNote}>none yet</span>}</td>
                  <td style={styles.td}>
                    {a.inviteCode ? (
                      <>
                        {a.inviteCodeUses} /{" "}
                        <input
                          type="number"
                          min={0}
                          defaultValue={a.inviteCodeLimit}
                          style={styles.limitInput}
                          onBlur={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v) && v !== a.inviteCodeLimit) handleLimitChange(a.id, v);
                          }}
                        />
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={styles.td}>
                    {a.inviteCode && (
                      <button style={styles.smallBtn} onClick={() => handleRegenerate(a.id)}>
                        Regenerate code
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh", background: "#f7f6f3", padding: 20 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { margin: 0, fontSize: 22 },
  backBtn: { border: "1.5px solid #ddd", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  card: { background: "#fff", borderRadius: 12, padding: 16, marginBottom: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
  cardTitle: { fontWeight: 700, fontSize: 14, marginBottom: 10 },
  toggleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  toggleBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  smallNote: { fontSize: 12, color: "#888", marginBottom: 8 },
  mapRow: { display: "flex", flexDirection: "column", gap: 8 },
  mapOverrideBlock: {
    borderTop: "1px solid #f0f0f0",
    paddingTop: 12,
    marginTop: 12,
  },
  mapOverrideTitle: { fontWeight: 700, fontSize: 13.5, marginBottom: 8 },
  mapOverrideTextarea: {
    width: "100%",
    minHeight: 90,
    fontFamily: "monospace",
    fontSize: 12,
    padding: 8,
    borderRadius: 6,
    border: "1px solid #ddd",
    boxSizing: "border-box",
  },
  mapItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    background: "#fafafa",
    borderRadius: 8,
    fontSize: 13,
  },
  smallBtnInactive: { background: "#fdecea", borderColor: "#e0a8a8", color: "#a33" },
  configGrid: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 },
  featureRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "8px 0",
    borderBottom: "1px solid #f0f0f0",
    flexWrap: "wrap",
  },
  featureLabel: { fontSize: 13, fontWeight: 600, flex: "1 1 220px" },
  featureCheckboxLabel: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#555" },
  configLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "#555", fontWeight: 600 },
  configInput: { padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 13, width: 120 },
  pendingRow: { padding: "8px 0", borderBottom: "1px solid #eee", fontSize: 13 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #eee", color: "#888", fontWeight: 600, fontSize: 11, textTransform: "uppercase" },
  td: { padding: "8px", borderBottom: "1px solid #f0f0f0" },
  usernameTag: { color: "#888", fontSize: 12 },
  adminTag: { marginLeft: 6, fontSize: 10, background: "#111", color: "#fff", borderRadius: 4, padding: "1px 5px" },
  limitInput: { width: 50, padding: "2px 4px", border: "1px solid #ddd", borderRadius: 4, fontSize: 12 },
  smallBtn: { border: "1px solid #ddd", background: "#fff", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" },
  errText: { fontSize: 13, color: "#c0392b", background: "#fdecea", borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
};
