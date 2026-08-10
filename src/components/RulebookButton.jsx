import React from "react";

// ---------------------------------------------------------------------------
// RULEBOOK BUTTON — small shared trigger for opening RulebookView, used
// consistently across LandingScreen, SetupScreen, LobbyScreen, and
// GameBoard's header (via extraHeaderContent) rather than each screen
// hand-rolling its own differently-styled "help" button.
// ---------------------------------------------------------------------------
export default function RulebookButton({ onClick, compact }) {
  return (
    <button style={compact ? styles.compact : styles.full} onClick={onClick}>
      <span aria-hidden="true">❓</span> {compact ? "Rules" : "How to Play"}
    </button>
  );
}

const styles = {
  full: {
    border: "1px solid #ddd",
    background: "#fff",
    color: "#333",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  compact: {
    border: "1px solid #ddd",
    background: "#fff",
    color: "#333",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
};
