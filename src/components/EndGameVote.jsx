import React from "react";
import { useEndGameVote } from "../lib/useEndGameVote.js";

// ---------------------------------------------------------------------------
// END GAME VOTE — a small "End Game" button always visible during
// multiplayer play, plus a modal that appears for everyone when a
// proposal is active. Simplified first version (see schema.sql /
// functions.sql notes on end_game_proposals): everyone in the room must
// vote yes, there's no auto-skip for inactive players yet since presence
// detection doesn't exist yet.
// ---------------------------------------------------------------------------
export default function EndGameVote({ roomId, myPlayerId }) {
  const { proposal, err, propose, vote, iHaveVoted } = useEndGameVote({ roomId, myPlayerId });

  async function handlePropose() {
    try {
      await propose();
    } catch {
      // error surfaced via `err` from the hook
    }
  }

  if (!proposal) {
    return (
      <button style={styles.endGameBtn} onClick={handlePropose}>
        End Game
      </button>
    );
  }

  const secondsLeft = Math.max(0, Math.round((new Date(proposal.expiresAt).getTime() - Date.now()) / 1000));

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.title}>{proposal.proposedByName} wants to end the game</div>
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
              Yes, end the game
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
  endGameBtn: {
    border: "1px solid #e0a8a8",
    background: "#fff",
    color: "#a33",
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
