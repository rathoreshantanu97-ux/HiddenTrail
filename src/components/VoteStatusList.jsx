import React from "react";

// ---------------------------------------------------------------------------
// VOTE STATUS LIST — shared by every vote modal (end-game, pause,
// reversal, redistribute). Shows each currently-active player by name
// with their live status: agreed / declined / not yet responded.
// ---------------------------------------------------------------------------
export default function VoteStatusList({ statusList }) {
  if (!statusList || statusList.length === 0) return null;

  return (
    <div style={styles.list}>
      {statusList.map((p) => (
        <div key={p.playerId} style={styles.row}>
          <span style={styles.name}>{p.displayName}</span>
          <span
            style={{
              ...styles.badge,
              ...(p.status === "yes" ? styles.badgeYes : p.status === "no" ? styles.badgeNo : styles.badgePending),
            }}
          >
            {p.status === "yes" ? "Agreed" : p.status === "no" ? "Declined" : "Waiting..."}
          </span>
        </div>
      ))}
    </div>
  );
}

const styles = {
  list: { display: "flex", flexDirection: "column", gap: 5, marginTop: 8, marginBottom: 10, textAlign: "left" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 },
  name: { fontWeight: 600, color: "#333" },
  badge: { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6 },
  badgeYes: { background: "#e5f6ec", color: "#1a7a42" },
  badgeNo: { background: "#fbe9e7", color: "#b3382c" },
  badgePending: { background: "#f2f2f2", color: "#888" },
};
