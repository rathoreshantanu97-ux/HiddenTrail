import React, { useState } from "react";

// ---------------------------------------------------------------------------
// END GAME EARLY BUTTON — pass-and-play equivalent of multiplayer's
// EndGameVote. Since pass-and-play is one device with one person making
// the decision, there's no one else to vote -- so this just asks for a
// confirmation click (guards against an accidental tap) and ends
// immediately, rather than running the full propose/vote flow that
// exists for multiplayer.
// ---------------------------------------------------------------------------
export default function EndGameEarlyButton({ onEndGame }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button style={styles.endGameBtn} onClick={() => setConfirming(true)}>
        End Game
      </button>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.title}>End the game now?</div>
        <div style={styles.desc}>This ends the game immediately for everyone at this device.</div>
        <div style={styles.btnRow}>
          <button
            style={styles.yesBtn}
            onClick={() => {
              onEndGame();
              setConfirming(false);
            }}
          >
            Yes, end it
          </button>
          <button style={styles.noBtn} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
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
    maxWidth: 340,
    width: "90%",
    textAlign: "center",
    boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
  },
  title: { fontWeight: 700, fontSize: 16, marginBottom: 8 },
  desc: { fontSize: 13, color: "#666", marginBottom: 18 },
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
