import React from "react";

// ---------------------------------------------------------------------------
// MOVE POPUP — a small, focused popup anchored just above the clicked
// station on the map, replacing the old sidebar ticket-chooser panels.
// Positioned in actual screen pixels (passed in by the caller, which has
// already done the SVG-viewBox -> screen-pixel translation, accounting
// for the current zoom/pan state -- see GameBoard.jsx's
// svgPointToScreenPoint), so it stays visually anchored to the right
// station regardless of zoom level or how far the map has been panned.
//
// Deliberately closes ONLY via the explicit ✕ button, never by clicking
// elsewhere on the map -- per project decision, to avoid an accidental
// dismissal mid-decision.
// ---------------------------------------------------------------------------
export default function MovePopup({ x, y, title, options, onClose, fallback = false }) {
  return (
    <div style={{ ...styles.popup, left: x, top: y, transform: fallback ? "translate(-50%, -50%)" : styles.popup.transform }}>
      <button style={styles.closeBtn} onClick={onClose} aria-label="Cancel">
        ✕
      </button>
      <div style={styles.title}>{title}</div>
      <div style={styles.optionsRow}>
        {options.map((opt) => (
          <button key={opt.key} style={{ ...styles.optionBtn, ...(opt.accent ? { background: opt.accent } : {}) }} onClick={opt.onClick}>
            {opt.label}
          </button>
        ))}
      </div>
      {!fallback && <div style={styles.pointer} />}
    </div>
  );
}

const styles = {
  popup: {
    position: "fixed",
    transform: "translate(-50%, -100%)",
    marginTop: -10, // small gap above the station itself
    background: "#fff",
    borderRadius: 12,
    padding: "10px 12px",
    boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
    zIndex: 1500,
    minWidth: 180,
    maxWidth: 260,
    textAlign: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 4,
    right: 6,
    border: "none",
    background: "none",
    fontSize: 13,
    color: "#999",
    cursor: "pointer",
    padding: 4,
    lineHeight: 1,
  },
  title: { fontSize: 12.5, fontWeight: 600, marginBottom: 8, paddingRight: 14 },
  optionsRow: { display: "flex", flexDirection: "column", gap: 6 },
  optionBtn: {
    border: "none",
    background: "#111",
    color: "#fff",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  pointer: {
    position: "absolute",
    bottom: -6,
    left: "50%",
    transform: "translateX(-50%)",
    width: 0,
    height: 0,
    borderLeft: "6px solid transparent",
    borderRight: "6px solid transparent",
    borderTop: "6px solid #fff",
  },
};
