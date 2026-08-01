import React from "react";

// ---------------------------------------------------------------------------
// MOVE POPUP — a small, focused popup anchored just above (or below/left/
// right, per openDirection) the clicked station on the map, replacing
// the old sidebar ticket-chooser panels. Positioned in actual screen
// pixels (passed in by the caller, which has already done the
// SVG-viewBox -> screen-pixel translation, accounting for the current
// zoom/pan state -- see GameBoard.jsx's svgPointToScreenPoint), so it
// stays visually anchored to the right station regardless of zoom level
// or how far the map has been panned.
//
// openDirection ("above" | "below" | "left" | "right" | "center") is
// computed by the caller against the REAL viewport size (not any
// assumed dimension) -- this is the actual fix for a real bug: a
// station near the top of the screen used to always get its popup
// pushed partially off-screen (since it always opened upward, with no
// awareness of whether there was room), leaving the confirm/cancel
// buttons unreachable -- especially bad since this popup deliberately
// closes ONLY via its own explicit ✕ button, never by clicking
// elsewhere, so a fully-offscreen popup was a genuine dead end.
// ---------------------------------------------------------------------------
export default function MovePopup({ x, y, title, options, onClose, fallback = false, openDirection = "above" }) {
  const dir = fallback ? "center" : openDirection;
  return (
    <div style={{ ...styles.popup, left: x, top: y, transform: TRANSFORM_FOR_DIR[dir] }}>
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
      {dir !== "center" && <div style={POINTER_FOR_DIR[dir]} />}
    </div>
  );
}

const TRANSFORM_FOR_DIR = {
  above: "translate(-50%, -100%)",
  below: "translate(-50%, 0%)",
  left: "translate(-100%, -50%)",
  right: "translate(0%, -50%)",
  center: "translate(-50%, -50%)",
};

const POINTER_FOR_DIR = {
  above: {
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
  below: {
    position: "absolute",
    top: -6,
    left: "50%",
    transform: "translateX(-50%)",
    width: 0,
    height: 0,
    borderLeft: "6px solid transparent",
    borderRight: "6px solid transparent",
    borderBottom: "6px solid #fff",
  },
  left: {
    position: "absolute",
    right: -6,
    top: "50%",
    transform: "translateY(-50%)",
    width: 0,
    height: 0,
    borderTop: "6px solid transparent",
    borderBottom: "6px solid transparent",
    borderLeft: "6px solid #fff",
  },
  right: {
    position: "absolute",
    left: -6,
    top: "50%",
    transform: "translateY(-50%)",
    width: 0,
    height: 0,
    borderTop: "6px solid transparent",
    borderBottom: "6px solid transparent",
    borderRight: "6px solid #fff",
  },
};

const styles = {
  popup: {
    position: "fixed",
    marginTop: 0,
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
};
