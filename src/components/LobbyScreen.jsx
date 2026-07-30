import React, { useState, useEffect, useCallback } from "react";
import * as api from "../lib/supabaseApi.js";
import { MAP_LIST } from "../maps/index.js";
import { computeSeatLayout, seatLabel } from "../lib/seatLayout.js";

// ---------------------------------------------------------------------------
// LOBBY SCREEN — shown after creating or joining a room, before the game
// starts. Polls the players list (simple + reliable; a lobby with a
// handful of people doesn't need realtime precision) and shows the room
// code prominently so the host can share it.
//
// Seats are pre-sized (per the fair-split room model): Mr. X, plus one
// seat per detective-controller, each possibly holding more than one
// detective. Any player can click an open seat to switch into it while
// still in the lobby (via switch_seat) -- this is the "unselect and pick
// a different available role" feature.
// ---------------------------------------------------------------------------
export default function LobbyScreen({
  roomId,
  roomCode,
  myPlayerId,
  myRole,
  onRoleChanged,
  isHost,
  onHostChanged,
  numDetectives,
  totalPlayers,
  mapId,
  onStart,
  onLeave,
}) {
  const [players, setPlayers] = useState([]);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const rows = await api.fetchPlayers(roomId);
      setPlayers(rows);
    } catch (e) {
      console.error("Failed to fetch players:", e);
    }
  }, [roomId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const map = MAP_LIST.find((m) => m.id === mapId);

  let seats = [];
  try {
    seats = computeSeatLayout(numDetectives, totalPlayers || 2);
  } catch (e) {
    seats = [];
  }
  const allSeatRoles = ["mrx", ...seats.map((s) => s.seatRole)];
  const mrxPlayer = players.find((p) => p.role === "mrx");
  const joinedRoles = new Set(players.map((p) => p.role));
  const missingSeats = allSeatRoles.filter((r) => !joinedRoles.has(r));
  const allSeatsFilled = missingSeats.length === 0;

  async function handleStart() {
    setStarting(true);
    setErr("");
    try {
      await onStart();
    } catch (e) {
      setErr(e.message || "Failed to start game.");
      setStarting(false);
    }
  }

  async function handleLeave() {
    setLeaving(true);
    setErr("");
    try {
      await api.leaveLobby({ roomId, playerId: myPlayerId });
      onLeave();
    } catch (e) {
      setErr(e.message || "Failed to leave.");
      setLeaving(false);
    }
  }

  async function handleSwitchSeat(seatRole) {
    if (seatRole === myRole) return; // already in this seat
    setSwitching(true);
    setErr("");
    try {
      await api.switchSeat({ roomId, playerId: myPlayerId, newRole: seatRole });
      onRoleChanged && onRoleChanged(seatRole);
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to switch seats.");
    } finally {
      setSwitching(false);
    }
  }

  async function handleMakeHost(newHostPlayerId) {
    setReassigning(true);
    setErr("");
    try {
      await api.reassignHost({ roomId, newHostPlayerId });
      onHostChanged && onHostChanged(false); // this client is no longer host
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to transfer host.");
    } finally {
      setReassigning(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Lobby</h1>
        <p style={styles.subtitle}>{map?.label || mapId}</p>

        <div style={styles.codeBox}>
          <div style={styles.codeLabel}>Room code — share with friends</div>
          <div style={styles.code}>{roomCode}</div>
        </div>

        <div style={styles.slotsList}>
          {allSeatRoles.map((seatRole) => {
            const p = players.find((pl) => pl.role === seatRole);
            const isMine = seatRole === myRole;
            const isOpen = !p;
            const canMakeHost = isHost && p && !isMine;
            return (
              <div
                key={seatRole}
                style={{
                  ...styles.slotRow,
                  ...(isMine ? styles.slotRowMine : {}),
                  ...(isOpen && !isMine ? styles.slotRowClickable : {}),
                }}
                onClick={() => isOpen && !isMine && handleSwitchSeat(seatRole)}
              >
                <span style={styles.slotRole}>
                  {seatLabel(seatRole)}
                  {isMine && <span style={styles.youTag}> (you)</span>}
                </span>
                <span style={styles.slotRightSide}>
                  <span style={p ? styles.slotFilled : styles.slotEmpty}>
                    {p ? p.display_name : isOpen ? "tap to join" : "waiting..."}
                  </span>
                  {canMakeHost && (
                    <button
                      style={styles.makeHostBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMakeHost(p.id);
                      }}
                      disabled={reassigning}
                    >
                      Make host
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {err && <div style={styles.errText}>{err}</div>}

        {!allSeatsFilled && (
          <div style={styles.waitingForSeatsNote}>
            Waiting for {missingSeats.length} more seat{missingSeats.length === 1 ? "" : "s"} to be filled:{" "}
            {missingSeats.map((r) => seatLabel(r)).join(", ")}
          </div>
        )}

        {isHost ? (
          <button style={styles.primaryBtn} onClick={handleStart} disabled={starting || !allSeatsFilled}>
            {starting ? "Starting..." : allSeatsFilled ? "Start Game" : "Waiting for players..."}
          </button>
        ) : (
          <p style={styles.waitNote}>
            {allSeatsFilled ? "Waiting for the host to start the game..." : "Waiting for everyone to join..."}
          </p>
        )}

        <button style={styles.leaveBtn} onClick={handleLeave} disabled={leaving}>
          {leaving ? "Leaving..." : "Leave Lobby"}
        </button>
      </div>
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
  title: { margin: "0 0 4px", fontSize: 26 },
  subtitle: { color: "#777", marginBottom: 20, fontSize: 14 },
  codeBox: {
    background: "#f4f2ec",
    borderRadius: 12,
    padding: "14px 16px",
    marginBottom: 20,
  },
  codeLabel: { fontSize: 12, color: "#888", marginBottom: 4 },
  code: { fontSize: 30, fontWeight: 800, letterSpacing: 4 },
  slotsList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, textAlign: "left" },
  slotRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    background: "#fafafa",
    borderRadius: 8,
    fontSize: 14,
    border: "1.5px solid transparent",
    width: "100%",
    cursor: "default",
    fontFamily: "inherit",
  },
  slotRowMine: { border: "1.5px solid #111", background: "#f4f2ec" },
  slotRowClickable: { cursor: "pointer", border: "1.5px dashed #bbb" },
  youTag: { color: "#888", fontWeight: 400, fontSize: 12 },
  slotRightSide: { display: "flex", alignItems: "center", gap: 8 },
  makeHostBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 6,
    padding: "3px 8px",
    fontSize: 11,
    cursor: "pointer",
    color: "#555",
  },
  slotRole: { fontWeight: 600, color: "#333" },
  slotFilled: { color: "#111", fontWeight: 600 },
  slotEmpty: { color: "#bbb", fontStyle: "italic" },
  errText: { color: "#c0392b", fontSize: 13, marginBottom: 8 },
  primaryBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  waitNote: { color: "#888", fontSize: 13.5 },
  waitingForSeatsNote: {
    background: "#fdf6ea",
    border: "1px solid #f0d9a8",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 12.5,
    color: "#8a6a1f",
    marginBottom: 10,
    textAlign: "left",
  },
  leaveBtn: {
    marginTop: 12,
    background: "none",
    border: "1px solid #e0a8a8",
    color: "#a33",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
};
