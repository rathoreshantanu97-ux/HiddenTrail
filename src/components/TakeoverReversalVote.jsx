import React from "react";
import { useTakeoverReversalVote } from "../lib/useTakeoverReversalVote.js";
import VoteStatusList from "./VoteStatusList.jsx";
import { seatLabel } from "../lib/seatLayout.js";

// ---------------------------------------------------------------------------
// TAKEOVER REVERSAL VOTE — mirrors EndGameVote/PauseVote's modal pattern.
// Two distinct entry points:
//   1. requestButton: shown to the REPLACED player (via SpectatorScreen),
//      lets them propose getting their seat back. Only rendered by the
//      caller when a completedTakeoverEventId is available (i.e. this
//      specific player was actually replaced, within the reversal window
//      -- the server enforces the window and the "must be the replaced
//      player" rule regardless, this is just about not showing a button
//      that would obviously fail).
//   2. The vote modal itself, shown to EVERYONE once a proposal exists
//      (unlike the request button, which only the replaced player sees).
// ---------------------------------------------------------------------------
export default function TakeoverReversalVote({ roomId, myPlayerId, completedTakeoverEventId }) {
  const { proposal, statusList, err, propose, vote, iHaveVoted } = useTakeoverReversalVote({ roomId, myPlayerId });

  async function handlePropose() {
    try {
      await propose(completedTakeoverEventId);
    } catch {
      // error surfaced via `err` from the hook
    }
  }

  if (!proposal) {
    if (!completedTakeoverEventId) return null;
    return (
      <button style={styles.requestBtn} onClick={handlePropose}>
        Request my seat back
      </button>
    );
  }

  const secondsLeft = Math.max(0, Math.round((new Date(proposal.expiresAt).getTime() - Date.now()) / 1000));

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.title}>
          {proposal.proposedByName} wants their seat back ({seatLabel(proposal.originalRole)})
        </div>
        <div style={styles.desc}>
          The seat's moves so far are unaffected — this only changes who controls it going forward.
        </div>
        <div style={styles.voteCount}>
          {proposal.yesVotes} of {proposal.totalActive} active players have agreed
        </div>
        <div style={styles.timer}>Expires in {secondsLeft}s if not everyone responds</div>
        {err && <div style={styles.err}>{err}</div>}
        <VoteStatusList statusList={statusList} />
        {iHaveVoted ? (
          <div style={styles.waitingNote}>Waiting for other players to respond...</div>
        ) : (
          <div style={styles.btnRow}>
            <button style={styles.yesBtn} onClick={() => vote(true)}>
              Yes, give it back
            </button>
            <button style={styles.noBtn} onClick={() => vote(false)}>
              No, keep as-is
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  requestBtn: {
    border: "1px solid #ddd",
    background: "#111",
    color: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 10,
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
    maxWidth: 380,
    width: "90%",
    textAlign: "center",
    boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
  },
  title: { fontWeight: 700, fontSize: 15, marginBottom: 8 },
  desc: { fontSize: 12.5, color: "#666", marginBottom: 10 },
  voteCount: { fontSize: 13, color: "#555", marginBottom: 4 },
  timer: { fontSize: 12, color: "#999", marginBottom: 8 },
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
