import React from "react";
import { usePauseVote } from "../lib/usePauseVote.js";

// ---------------------------------------------------------------------------
// PAUSE VOTE — mirrors EndGameVote.jsx exactly (same proposal/vote UI
// pattern). A "Pause" button always visible during multiplayer play; a
// modal appears for everyone once a proposal is active.
// ---------------------------------------------------------------------------
export default function PauseVote({ roomId, myPlayerId }) {
  const { proposal, err, propose, vote, iHaveVoted } = usePauseVote({ roomId, myPlayerId });

  async function handlePropose() {
    try {
      await propose();
    } catch {
      // error surfaced via `err` from the hook
    }
  }

  if (!proposal) {
    return (
      <button style={styles.pauseBtn} onClick={handlePropose}>
        Pause
      </button>
    );
  }

  const secondsLeft = Math.max(0, Math.round((new Date(proposal.expiresAt).getTime() - Date.now()) / 1000));

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.title}>{proposal.proposedByName} wants to pause the game</div>
        <div style={styles.voteCount}>
          {proposal.yesVotes} of {proposal.totalPlayers} players have agreed
        </div>
        <div style={styles.timer}>Expires in {secondsLeft}s if not everyone responds</div>
        {err && <div style={styles.err}>{err}</div>}
        {iHaveVoted ? (
          <div style={styles.waitingNote}>Waiting for other players to respond...</div>
        ) : (
          <div style={styles.btnRow}>
            <button style={styles.yesBtn} onClick={() => vote(true)}>
              Yes, pause it
            </button>
            <button style={styles.noBtn} onClick={() => vote(false)}>
              No, keep playing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  pauseBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    color: "#555",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "#fff",
    borderRadius: 16,
    padding: 24,
    maxWidth: 360,
    width: "90%",
    textAlign: "center",
    boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
  },
  title: { fontWeight: 700, fontSize: 16, marginBottom: 8 },
  voteCount: { fontSize: 13, color: "#555", marginBottom: 4 },
  timer: { fontSize: 12, color: "#999", marginBottom: 16 },
  err: { fontSize: 12, color: "#c0392b", marginBottom: 10 },
  waitingNote: { fontSize: 13, color: "#888", fontStyle: "italic" },
  btnRow: { display: "flex", gap: 10, justifyContent: "center" },
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
};
