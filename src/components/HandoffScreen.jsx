import React from "react";
import { styles } from "./GameBoard.jsx";
import { MAX_ROUNDS } from "../lib/gameEngine.js";

export default function HandoffScreen({ handoffFor, round, onReady }) {
  return (
    <div style={styles.page}>
      <div style={styles.handoffCard}>
        <div style={styles.handoffIcon}>🔒</div>
        <h2 style={{ margin: "0 0 8px" }}>Pass the device to</h2>
        <div style={styles.handoffName}>{handoffFor}</div>
        <div style={{ color: "#777", marginBottom: 20 }}>
          Round {round} of {MAX_ROUNDS}
        </div>
        <button style={styles.primaryBtn} onClick={onReady}>
          I'm ready — show my turn
        </button>
      </div>
    </div>
  );
}
