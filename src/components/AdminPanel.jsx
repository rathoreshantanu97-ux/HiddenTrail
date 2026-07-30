import React, { useState, useEffect, useCallback } from "react";
import * as auth from "../lib/accessControlApi.js";
import { MAP_LIST } from "../maps/index.js";

// ---------------------------------------------------------------------------
// ADMIN PANEL — only reachable by an account with is_admin = true (the
// RPCs themselves enforce this server-side; this component just doesn't
// bother rendering for anyone else). Covers: the public/private toggle,
// pending access/upgrade requests awaiting an OTP relay, a table of every
// account with its invite-code usage and an easy limit-adjuster, per-map
// activate/deactivate, and turn-timer bounds / default invite limit.
// ---------------------------------------------------------------------------
export default function AdminPanel({ accountId, onBack }) {
  const [isPublic, setIsPublicState] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [pending, setPending] = useState([]);
  const [inactiveMapIds, setInactiveMapIds] = useState([]);
  const [config, setConfig] = useState({ turnTimerMin: 30, turnTimerMax: 300, defaultInviteLimit: 20 });
  const [configDraft, setConfigDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedNote, setSavedNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [pub, accts, reqs, inactiveIds, cfg] = await Promise.all([
        auth.getAppPublicStatus(),
        auth.listAccountsForAdmin(accountId),
        auth.listPendingRequestsForAdmin(accountId),
        auth.getInactiveMapIds(),
        auth.getPublicConfig(),
      ]);
      setIsPublicState(pub);
      setAccounts(accts);
      setPending(reqs);
      setInactiveMapIds(inactiveIds);
      setConfig(cfg);
      setConfigDraft(cfg);
    } catch (e) {
      setErr(e.message);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleTogglePublic() {
    setBusy(true);
    setErr("");
    try {
      await auth.setAppPublic({ callerAccountId: accountId, isPublic: !isPublic });
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
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
    setBusy(true);
    setErr("");
    setSavedNote("");
    try {
      await auth.setAppConfig({
        callerAccountId: accountId,
        turnTimerMin: Number(configDraft.turnTimerMin),
        turnTimerMax: Number(configDraft.turnTimerMax),
        defaultInviteLimit: Number(configDraft.defaultInviteLimit),
      });
      await refresh();
      setSavedNote("Saved.");
      setTimeout(() => setSavedNote(""), 2000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
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
          <button style={styles.toggleBtn} onClick={handleTogglePublic} disabled={busy}>
            Switch to {isPublic ? "Private" : "Public"}
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.cardTitle}>Maps</div>
        <div style={styles.smallNote}>Deactivated maps won't appear in the map picker for new games.</div>
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
        <div style={styles.smallNote}>
          Turn timer minimum can never go below 15s, even if entered lower — this protects the inactivity-detection
          system from a conflicting configuration.
        </div>
        <button style={styles.toggleBtn} onClick={handleSaveConfig} disabled={busy}>
          {busy ? "Saving..." : "Save settings"}
        </button>
        {savedNote && <span style={{ marginLeft: 10, color: "#2a8", fontSize: 12.5 }}>{savedNote}</span>}
      </div>

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
