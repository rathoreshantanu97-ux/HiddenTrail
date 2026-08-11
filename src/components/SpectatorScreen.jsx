import React from "react";
import { seatLabel } from "../lib/seatLayout.js";

// ---------------------------------------------------------------------------
// SPECTATOR SCREEN — shown when this client's stored player_id no longer
// corresponds to a real seat in the room (their seat was taken over while
// they were disconnected, and the takeover has already completed). Rather
// than leaving them confused or showing raw errors when their moves
// fail, this gives a clear explanation and lets them keep watching.
// ---------------------------------------------------------------------------
export default function SpectatorScreen({ replacedRole, mrxName, detectiveTeamName, onLeave, children }) {
  const roleLabel = replacedRole
    ? replacedRole === "mrx"
      ? mrxName ? mrxName() : "Mr. X"
      : seatLabel(replacedRole, { mrxName: mrxName ? mrxName() : undefined, detectiveTeamName })
    : "your seat";

  return (
    <div>
      <div style={styles.banner}>
        <span>
          You were replaced as {roleLabel} while you were disconnected. You're now spectating this game.
        </span>
        <button style={styles.leaveBtn} onClick={onLeave}>
          Leave
        </button>
      </div>
      <div style={styles.spectatorWrap}>{children}</div>
    </div>
  );
}

const styles = {
  banner: {
    background: "#fdf6ea",
    borderBottom: "1px solid #f0d9a8",
    padding: "10px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#8a6a1f",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  leaveBtn: {
    border: "1px solid #d9c088",
    background: "#fff",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    color: "#8a6a1f",
    flexShrink: 0,
    marginLeft: 12,
  },
  spectatorWrap: {
    pointerEvents: "none", // read-only: can't click stations/buttons in the board underneath
    opacity: 0.92,
  },
};
