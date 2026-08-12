import React, { useState, useEffect } from "react";
import * as api from "../lib/supabaseApi.js";
import VoteStatusList from "./VoteStatusList.jsx";
import { useResumeVote } from "../lib/useResumeVote.js";

// ---------------------------------------------------------------------------
// PAUSED SCREEN — shown to everyone when game_state_public.phase ===
// 'paused'. Shows who paused it, a countdown to the auto-end deadline,
// and now a full RESUME VOTE (mirroring the pause vote itself) rather
// than a single "Resume" button any one player could click alone. Fixes
// a real, confirmed gap: resuming previously required no agreement at
// all, unlike every other consequential group action in this game.
// ---------------------------------------------------------------------------
export default function PausedScreen({ roomId, myPlayerId, onResumed, resolveLabel }) {
  const [pauseInfo, setPauseInfo] = useState(null);
  const [, forceTick] = useState(0);
  const { proposal, statusList, err, propose, vote, iHaveVoted } = useResumeVote({ roomId, myPlayerId });
  const [proposeBusy, setProposeBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const info = await api.getPauseStatus(roomId);
        if (!cancelled) {
          setPauseInfo(info);
          // The pause row is deleted the instant the resume vote passes
          // (see vote_resume/get_active_resume_proposal) -- if it's gone
          // now but we were previously showing this screen, the game has
          // genuinely resumed; let the parent know so it can switch away
          // from this screen.
          if (!info) onResumed && onResumed();
        }
      } catch (e) {
        console.error("Failed to fetch pause status:", e);
      }
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [roomId, onResumed]);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function handlePropose() {
    setProposeBusy(true);
    try {
      await propose();
    } catch {
      // error surfaced via `err` from the hook
    } finally {
      setProposeBusy(false);
    }
  }

  const hoursLeft = pauseInfo
    ? Math.max(0, (new Date(pauseInfo.resumeDeadline).getTime() - Date.now()) / (1000 * 60 * 60))
    : null;

  const secondsLeft = proposal ? Math.max(0, Math.round((new Date(proposal.expiresAt).getTime() - Date.now()) / 1000)) : null;

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

        {!proposal ? (
          <button style={styles.primaryBtn} onClick={handlePropose} disabled={proposeBusy}>
            {proposeBusy ? "Proposing..." : "Propose Resuming"}
          </button>
        ) : (
          <div style={styles.voteBox}>
            <div style={styles.voteTitle}>{proposal.proposedByName} wants to resume the game</div>
            <div style={styles.voteCount}>
              {proposal.yesVotes} of {proposal.totalPlayers} players have agreed
            </div>
            <div style={styles.timer}>Expires in {secondsLeft}s if not everyone responds</div>
            <VoteStatusList statusList={statusList} resolveLabel={resolveLabel} />
            {iHaveVoted ? (
              <div style={styles.waitingNote}>Waiting for other players to respond...</div>
            ) : (
              <div style={styles.btnRow}>
                <button style={styles.yesBtn} onClick={() => vote(true)}>
                  Yes, resume
                </button>
                <button style={styles.noBtn} onClick={() => vote(false)}>
                  No, stay paused
                </button>
              </div>
            )}
          </div>
        )}

        <p style={styles.smallNote}>
          Everyone's roles and positions are unchanged — resuming picks up exactly where you left off. Every active
          player must agree before the game resumes.
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
  voteBox: {
    background: "#f7f6f3",
    borderRadius: 12,
    padding: 18,
    textAlign: "center",
  },
  voteTitle: { fontWeight: 700, fontSize: 15, marginBottom: 8 },
  voteCount: { fontSize: 13, color: "#555", marginBottom: 4 },
  timer: { fontSize: 12, color: "#999", marginBottom: 12 },
  waitingNote: { fontSize: 13, color: "#888", fontStyle: "italic", marginTop: 8 },
  btnRow: { display: "flex", gap: 10, justifyContent: "center", marginTop: 8 },
  yesBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  noBtn: {
    background: "#fff",
    color: "#111",
    border: "1.5px solid #ddd",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  smallNote: { fontSize: 12, color: "#999", marginTop: 14 },
};
