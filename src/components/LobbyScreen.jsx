import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient.js";
import * as api from "../lib/supabaseApi.js";
import { MAP_LIST } from "../maps/index.js";

// ---------------------------------------------------------------------------
// LOBBY SCREEN — shown after creating or joining a room, before the game
// starts. Polls the players list (simple + reliable; a lobby with a
// handful of people doesn't need realtime precision) and shows the room
// code prominently so the host can share it.
// ---------------------------------------------------------------------------
export default function LobbyScreen({ roomId, roomCode, myPlayerId, myRole, isHost, numDetectives, mapId, onStart }) {
  const [players, setPlayers] = useState([]);
  const [starting, setStarting] = useState(false);
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
  const detectiveSlots = Array.from({ length: numDetectives }, (_, i) => `d${i}`);
  const mrxPlayer = players.find((p) => p.role === "mrx");

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
          <div style={styles.slotRow}>
            <span style={styles.slotRole}>Mr. X</span>
            <span style={mrxPlayer ? styles.slotFilled : styles.slotEmpty}>
              {mrxPlayer ? mrxPlayer.display_name : "waiting..."}
            </span>
          </div>
          {detectiveSlots.map((role) => {
            const p = players.find((pl) => pl.role === role);
            return (
              <div key={role} style={styles.slotRow}>
                <span style={styles.slotRole}>Detective {parseInt(role.slice(1)) + 1}</span>
                <span style={p ? styles.slotFilled : styles.slotEmpty}>{p ? p.display_name : "waiting..."}</span>
              </div>
            );
          })}
        </div>

        {err && <div style={styles.errText}>{err}</div>}

        {isHost ? (
          <button style={styles.primaryBtn} onClick={handleStart} disabled={starting}>
            {starting ? "Starting..." : "Start Game"}
          </button>
        ) : (
          <p style={styles.waitNote}>Waiting for the host to start the game...</p>
        )}
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
    padding: "8px 12px",
    background: "#fafafa",
    borderRadius: 8,
    fontSize: 14,
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
};
