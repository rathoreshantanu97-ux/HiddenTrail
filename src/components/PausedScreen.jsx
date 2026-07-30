import React, { useState, useEffect } from "react";
import * as api from "../lib/supabaseApi.js";

// ---------------------------------------------------------------------------
// PAUSED SCREEN — shown to everyone when game_state_public.phase ===
// 'paused'. Shows who paused it, a countdown to the auto-end deadline,
// and a Resume button any single active player can click (no vote
// needed to resume, unlike pausing itself).
// ---------------------------------------------------------------------------
export default function PausedScreen({ roomId, myPlayerId, onResumed }) {
  const [pauseInfo, setPauseInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const info = await api.getPauseStatus(roomId);
        if (!cancelled) setPauseInfo(info);
      } catch (e) {
        console.error("Failed to fetch pause status:", e);
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [roomId]);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function handleResume() {
    setBusy(true);
    setErr("");
    try {
      await api.resumeGame({ roomId, callerPlayerId: myPlayerId });
      onResumed && onResumed();
    } catch (e) {
      setErr(e.message || "Failed to resume the game.");
      setBusy(false);
    }
  }

  const hoursLeft = pauseInfo
    ? Math.max(0, (new Date(pauseInfo.resumeDeadline).getTime() - Date.now()) / (1000 * 60 * 60))
    : null;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.icon}>⏸</div>
        <h1 style={styles.title}>Game Paused</h1>
        {pauseInfo && (
          <>
            <p style={styles.subtitle}>Paused by {pauseInfo.pausedByName}</p>
            <p style={styles.deadline}>
              {hoursLeft > 1
                ? `Resume within ${Math.floor(hoursLeft)} hour${Math.floor(hoursLeft) === 1 ? "" : "s"}, or the game will end automatically.`
                : "Less than an hour left to resume before the game ends automatically."}
            </p>
          </>
        )}
        {err && <div style={styles.err}>{err}</div>}
        <button style={styles.primaryBtn} onClick={handleResume} disabled={busy}>
          {busy ? "Resuming..." : "Resume Game"}
        </button>
        <p style={styles.smallNote}>
          Everyone's roles and positions are unchanged — resuming picks up exactly where you left off.
        </p>
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
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 32,
    maxWidth: 420,
    width: "100%",
    textAlign: "center",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  },
  icon: { fontSize: 40, marginBottom: 8 },
  title: { margin: "0 0 8px", fontSize: 24 },
  subtitle: { color: "#666", fontSize: 14, marginBottom: 6 },
  deadline: { color: "#a33", fontSize: 13, marginBottom: 20 },
  err: { fontSize: 13, color: "#c0392b", marginBottom: 12 },
  primaryBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 24px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  smallNote: { fontSize: 12, color: "#999", marginTop: 14 },
};
