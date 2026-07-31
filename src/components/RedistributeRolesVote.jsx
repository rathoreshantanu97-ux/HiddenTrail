import React, { useState, useEffect } from "react";
import { useRedistributeVote } from "../lib/useRedistributeVote.js";
import VoteStatusList from "./VoteStatusList.jsx";
import { seatLabel, computeSeatLayoutSafe } from "../lib/seatLayout.js";
import * as api from "../lib/supabaseApi.js";

// ---------------------------------------------------------------------------
// REDISTRIBUTE ROLES VOTE — host-only proposal button + assignment form,
// plus the vote modal shown to everyone once proposed. Feature-gated by
// the caller (only rendered when isHost && redistributeRolesEnabled for
// this room, mirroring every other feature toggle in this project).
// ---------------------------------------------------------------------------
export default function RedistributeRolesVote({ roomId, myPlayerId, isHost, numDetectives, totalPlayers }) {
  const { proposal, statusList, err, propose, vote, iHaveVoted } = useRedistributeVote({ roomId, myPlayerId });
  const [showForm, setShowForm] = useState(false);
  const [players, setPlayers] = useState([]);
  const [assignments, setAssignments] = useState({}); // playerId -> role

  useEffect(() => {
    if (!showForm) return;
    api
      .fetchPlayers(roomId)
      .then((rows) => {
        setPlayers(rows);
        // seed with current assignments so the host adjusts rather than starts blank
        const seeded = {};
        for (const p of rows) seeded[p.id] = p.role;
        setAssignments(seeded);
      })
      .catch((e) => console.error("Failed to fetch players for redistribute form:", e));
  }, [showForm, roomId]);

  const allSeats = ["mrx", ...computeSeatLayoutSafe(numDetectives, totalPlayers).map((s) => s.seatRole)];

  async function handlePropose() {
    // validate every seat is assigned to exactly one player before submitting
    const assignedRoles = Object.values(assignments);
    const missingOrDuplicate = allSeats.filter((s) => assignedRoles.filter((r) => r === s).length !== 1);
    if (missingOrDuplicate.length > 0) {
      alert(`Each seat must be assigned to exactly one player. Check: ${missingOrDuplicate.map(seatLabel).join(", ")}`);
      return;
    }
    try {
      await propose(assignments);
      setShowForm(false);
    } catch {
      // error surfaced via `err` from the hook
    }
  }

  if (proposal) {
    const secondsLeft = Math.max(0, Math.round((new Date(proposal.expiresAt).getTime() - Date.now()) / 1000));
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.title}>{proposal.proposedByName} wants to redistribute roles</div>
          <div style={styles.assignmentPreview}>
            {Object.entries(proposal.newAssignments).map(([playerId, role]) => (
              <div key={playerId} style={styles.assignmentRow}>
                {seatLabel(role)}
              </div>
            ))}
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
                Yes, redistribute
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

  if (!isHost) return null;

  if (!showForm) {
    return (
      <button style={styles.requestBtn} onClick={() => setShowForm(true)}>
        Redistribute Roles
      </button>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.title}>Reassign every seat</div>
        <div style={styles.desc}>Board state is untouched — only who controls each seat changes.</div>
        {players.map((p) => (
          <label key={p.id} style={styles.assignRow}>
            <span style={styles.assignName}>{p.display_name}</span>
            <select
              style={styles.assignSelect}
              value={assignments[p.id] || ""}
              onChange={(e) => setAssignments((prev) => ({ ...prev, [p.id]: e.target.value }))}
            >
              {allSeats.map((s) => (
                <option key={s} value={s}>
                  {seatLabel(s)}
                </option>
              ))}
            </select>
          </label>
        ))}
        {err && <div style={styles.err}>{err}</div>}
        <div style={styles.btnRow}>
          <button style={styles.yesBtn} onClick={handlePropose}>
            Propose this redistribution
          </button>
          <button style={styles.noBtn} onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  requestBtn: {
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
    overflowY: "auto",
    padding: 20,
  },
  modal: {
    background: "#fff",
    borderRadius: 16,
    padding: 24,
    maxWidth: 400,
    width: "90%",
    textAlign: "center",
    boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  title: { fontWeight: 700, fontSize: 15, marginBottom: 8 },
  desc: { fontSize: 12.5, color: "#666", marginBottom: 14 },
  assignmentPreview: { fontSize: 12.5, color: "#555", marginBottom: 10, textAlign: "left" },
  assignmentRow: { padding: "2px 0" },
  assignRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, textAlign: "left" },
  assignName: { fontSize: 13, fontWeight: 600 },
  assignSelect: { padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 },
  voteCount: { fontSize: 13, color: "#555", marginBottom: 4 },
  timer: { fontSize: 12, color: "#999", marginBottom: 8 },
  err: { fontSize: 12, color: "#c0392b", marginBottom: 10 },
  waitingNote: { fontSize: 13, color: "#888", fontStyle: "italic" },
  btnRow: { display: "flex", gap: 10, justifyContent: "center", marginTop: 10 },
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
