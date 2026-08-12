import React from "react";
import { useTakeover } from "../lib/useTakeover.js";
import { seatLabel } from "../lib/seatLayout.js";

// ---------------------------------------------------------------------------
// TAKEOVER PANEL — renders whatever the current takeover event's state
// calls for. Nothing renders if there's no active event.
// ---------------------------------------------------------------------------
export default function TakeoverPanel({ roomId, myPlayerId, mySecret, isHost, theme }) {
  const { event, err, decide, startTakeoverNow, nominate, vote, iHaveNominated } = useTakeover({ roomId, myPlayerId, mySecret });

  if (!event) return null;

  const targetLabel =
    event.targetRole === "mrx" ? event.targetDisplayName : `${event.targetDisplayName} (${seatLabel(event.targetRole, theme)})`;
  const secondsLeft = event.decisionDeadline
    ? Math.max(0, Math.round((new Date(event.decisionDeadline).getTime() - Date.now()) / 1000))
    : null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {err && <div style={styles.err}>{err}</div>}

        {event.status === "awaiting_host_decision" && (
          <>
            <div style={styles.title}>{targetLabel} appears to have disconnected</div>
            {isHost ? (
              <>
                <div style={styles.desc}>Do you want to wait for them, or start a takeover?</div>
                <div style={styles.btnRow}>
                  <button style={styles.primaryBtn} onClick={() => decide("takeover")}>
                    Start Takeover
                  </button>
                  <button style={styles.secondaryBtn} onClick={() => decide("wait")}>
                    Wait
                  </button>
                </div>
              </>
            ) : (
              <div style={styles.waitingNote}>Waiting for the host to decide whether to wait or start a takeover...</div>
            )}
          </>
        )}

        {event.status === "waiting" && (
          <>
            <div style={styles.title}>Waiting for {targetLabel} to reconnect</div>
            <div style={styles.desc}>
              Their turns will be played automatically until they return, or until someone starts a takeover.
            </div>
            <button style={styles.primaryBtn} onClick={startTakeoverNow}>
              Start Takeover Now
            </button>
          </>
        )}

        {event.status === "nominating" && (
          <>
            <div style={styles.title}>Who wants to take over for {targetLabel}?</div>
            <div style={styles.timer}>{secondsLeft}s left to volunteer</div>
            {event.nomineeNames.length > 0 && <div style={styles.desc}>So far: {event.nomineeNames.join(", ")}</div>}
            {iHaveNominated ? (
              <div style={styles.waitingNote}>You've volunteered — waiting for the window to close...</div>
            ) : (
              <button style={styles.primaryBtn} onClick={nominate}>
                I'll take over
              </button>
            )}
          </>
        )}

        {event.status === "voting" && (
          <>
            <div style={styles.title}>Vote for who should take over</div>
            <div style={styles.timer}>{secondsLeft}s left to vote</div>
            <div style={styles.btnColumn}>
              {event.nomineeIds.map((id, i) => {
                const name = event.nomineeNames[i];
                const count = event.voteCounts[id] || 0;
                const isSelf = id === myPlayerId;
                return (
                  <button
                    key={id}
                    style={{ ...styles.voteOptionBtn, ...(isSelf ? styles.voteOptionDisabled : {}) }}
                    onClick={() => !isSelf && vote(id)}
                    disabled={isSelf}
                  >
                    {name} {isSelf ? "(you)" : ""} — {count} vote{count === 1 ? "" : "s"}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
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
  title: { fontWeight: 700, fontSize: 16, marginBottom: 8 },
  desc: { fontSize: 13, color: "#666", marginBottom: 14 },
  timer: { fontSize: 12.5, color: "#a33", fontWeight: 600, marginBottom: 10 },
  waitingNote: { fontSize: 13, color: "#888", fontStyle: "italic", marginTop: 8 },
  err: { fontSize: 12, color: "#c0392b", marginBottom: 10 },
  btnRow: { display: "flex", gap: 10, justifyContent: "center", marginTop: 8 },
  btnColumn: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8 },
  primaryBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryBtn: {
    background: "#fff",
    color: "#111",
    border: "1.5px solid #ddd",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  voteOptionBtn: {
    background: "#fafafa",
    border: "1.5px solid #ddd",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "left",
  },
  voteOptionDisabled: { opacity: 0.5, cursor: "not-allowed" },
};
