import React, { useState, useEffect } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useActiveMaps } from "../lib/useActiveMaps.js";
import { computeSeatLayout, computeSeatLayoutSafe, seatLabel } from "../lib/seatLayout.js";

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
}) {
  const [mode, setMode] = useState(null); // null | "online" | "create" | "join"
  const configured = isSupabaseConfigured();

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Scotland Yard</h1>
            <p style={styles.subtitle}>Hidden-movement detective game</p>
          </div>
          {onLogout && (
            <button style={styles.logoutBtn} onClick={onLogout}>
              Log out
            </button>
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
            <button style={styles.linkBtn} onClick={() => setMode(null)}>
              Back
            </button>
          </div>
        )}

        {mode === null && showAdminPanelLink && (
          <button style={styles.adminLinkBtn} onClick={onOpenAdminPanel}>
            Admin Panel
          </button>
        )}

        {mode === "create" && (
          <CreateRoomForm onBack={() => setMode("online")} onCreate={onChooseCreateRoom} accountDisplayName={accountDisplayName} />
        )}

        {mode === "join" && (
          <JoinRoomForm
            onBack={() => setMode("online")}
            onJoin={{ lookup: onChooseJoinRoom.lookup, confirm: onChooseJoinRoom.confirm }}
            accountDisplayName={accountDisplayName}
          />
        )}
      </div>
    </div>
  );
}

function CreateRoomForm({ onBack, onCreate, accountDisplayName }) {
  const activeMaps = useActiveMaps();
  const [displayName, setDisplayName] = useState(accountDisplayName || "");
  const [mapId, setMapId] = useState(null);
  const [numDetectives, setNumDetectives] = useState(3);
  const [totalPlayers, setTotalPlayers] = useState(2);
  const [hostRole, setHostRole] = useState("mrx");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seatErr, setSeatErr] = useState("");

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
    setBusy(true);
    setErr("");
    try {
      await onCreate({ displayName: displayName.trim(), mapId, numDetectives, totalPlayers, hostRole });
    } catch (e) {
      setErr(e.message || "Failed to create room.");
      setBusy(false);
    }
  }

  const roleOptions = [
    { value: "mrx", label: "Mr. X" },
    ...seatLayout.map((s) => ({ value: s.seatRole, label: seatLabel(s.seatRole) })),
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

      <label style={styles.label}>Number of detectives (3–20)</label>
      <input
        type="number"
        min={3}
        max={20}
        style={styles.numberInput}
        value={numDetectives}
        onChange={(e) => setNumDetectives(Math.max(3, Math.min(20, parseInt(e.target.value, 10) || 3)))}
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
            <div key={s.seatRole}>{seatLabel(s.seatRole)}</div>
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

      {err && <div style={styles.errText}>{err}</div>}

      <button style={styles.primaryBtn} onClick={handleSubmit} disabled={busy || !!seatErr}>
        {busy ? "Creating..." : "Create Room"}
      </button>
      <button style={styles.linkBtn} onClick={onBack}>
        Back
      </button>
    </div>
  );
}

function JoinRoomForm({ onBack, onJoin, accountDisplayName }) {
  const [displayName, setDisplayName] = useState(accountDisplayName || "");
  const [roomCode, setRoomCode] = useState("");
  const [roomInfo, setRoomInfo] = useState(null); // { numDetectives, takenRoles } once code is looked up
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleLookup() {
    if (!roomCode.trim()) {
      setErr("Enter the room code.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const info = await onJoin.lookup(roomCode.trim().toUpperCase());
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
      setErr(e.message || "Failed to join room.");
      setBusy(false);
    }
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
        <button style={styles.linkBtn} onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  const allSlots = ["mrx", ...(computeSeatLayoutSafe(roomInfo.numDetectives, roomInfo.totalPlayers).map((s) => s.seatRole))];

  return (
    <div style={styles.form}>
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
          const label = seatLabel(s);
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
      <button style={styles.linkBtn} onClick={onBack}>
        Back
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
