import React, { useState } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient.js";

// ---------------------------------------------------------------------------
// LANDING SCREEN — the very first thing a player sees. Three paths:
//   1. Same-device pass-and-play (always available, no Supabase needed)
//   2. Create an online room (host flow)
//   3. Join an online room by code
// ---------------------------------------------------------------------------
export default function LandingScreen({ onChoosePassAndPlay, onChooseCreateRoom, onChooseJoinRoom }) {
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const configured = isSupabaseConfigured();

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Scotland Yard</h1>
        <p style={styles.subtitle}>Hidden-movement detective game</p>

        {mode === null && (
          <div style={styles.choiceStack}>
            <button style={styles.choiceBtn} onClick={onChoosePassAndPlay}>
              <div style={styles.choiceTitle}>Same-Device Pass & Play</div>
              <div style={styles.choiceDesc}>Everyone shares one screen, hand off between turns.</div>
            </button>

            <button
              style={{ ...styles.choiceBtn, ...(configured ? {} : styles.choiceBtnDisabled) }}
              onClick={() => configured && setMode("create")}
              disabled={!configured}
            >
              <div style={styles.choiceTitle}>Create Online Room</div>
              <div style={styles.choiceDesc}>
                {configured
                  ? "Start a new game, invite friends with a room code."
                  : "Online multiplayer isn't configured yet (see console for setup steps)."}
              </div>
            </button>

            <button
              style={{ ...styles.choiceBtn, ...(configured ? {} : styles.choiceBtnDisabled) }}
              onClick={() => configured && setMode("join")}
              disabled={!configured}
            >
              <div style={styles.choiceTitle}>Join Online Room</div>
              <div style={styles.choiceDesc}>Enter a room code a friend shared with you.</div>
            </button>
          </div>
        )}

        {mode === "create" && (
          <CreateRoomForm onBack={() => setMode(null)} onCreate={onChooseCreateRoom} />
        )}

        {mode === "join" && (
          <JoinRoomForm
            onBack={() => setMode(null)}
            onJoin={{ lookup: onChooseJoinRoom.lookup, confirm: onChooseJoinRoom.confirm }}
          />
        )}
      </div>
    </div>
  );
}

function CreateRoomForm({ onBack, onCreate }) {
  const [displayName, setDisplayName] = useState("");
  const [mapId, setMapId] = useState("city");
  const [numDetectives, setNumDetectives] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    if (!displayName.trim()) {
      setErr("Enter your name first.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onCreate({ displayName: displayName.trim(), mapId, numDetectives });
    } catch (e) {
      setErr(e.message || "Failed to create room.");
      setBusy(false);
    }
  }

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
        <option value="city">Simplified City</option>
        <option value="bengaluru">Bengaluru</option>
        <option value="westeros">Westeros</option>
      </select>

      <label style={styles.label}>Number of detectives</label>
      <div style={styles.rowCenter}>
        {[2, 3, 4, 5].map((n) => (
          <button
            key={n}
            style={{ ...styles.pill, ...(numDetectives === n ? styles.pillActive : {}) }}
            onClick={() => setNumDetectives(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <p style={styles.hostNote}>You'll be seated as Mr. X (the host). Other players join as detectives.</p>

      {err && <div style={styles.errText}>{err}</div>}

      <button style={styles.primaryBtn} onClick={handleSubmit} disabled={busy}>
        {busy ? "Creating..." : "Create Room"}
      </button>
      <button style={styles.linkBtn} onClick={onBack}>
        Back
      </button>
    </div>
  );
}

function JoinRoomForm({ onBack, onJoin }) {
  const [displayName, setDisplayName] = useState("");
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

  const detectiveSlots = Array.from({ length: roomInfo.numDetectives }, (_, i) => `d${i}`);
  const allSlots = ["mrx", ...detectiveSlots];

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
          const label = s === "mrx" ? "Mr. X" : `Detective ${parseInt(s.slice(1)) + 1}`;
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
