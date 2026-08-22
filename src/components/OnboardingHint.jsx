import React, { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// ONBOARDING HINT -- a one-time explainer popup for the first time a player
// hits a key moment (their first turn as Mr.X, their first planning phase,
// their first acting phase, the first reveal round they see). DISTINCT from
// InfoIcon: InfoIcon is reference material you can re-check anytime by
// hovering; this is a nudge that appears unprompted exactly once and then
// gets out of the way permanently.
//
// PERSISTENCE: localStorage, keyed per-id, per browser -- once dismissed it
// never shows again on this device, even in a brand new game. Deliberately
// NOT once-per-game: a returning player re-seeing the same popup every
// single game is exactly the repeat friction this is meant to avoid.
//
// Each <OnboardingHint> is mounted unconditionally and does its own
// active-and-not-yet-seen check internally, so the parent only needs to
// pass an `active` boolean for "the moment this hint is about is happening
// right now" -- the component handles "have I already shown this."
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "ht_hint_seen_";

function hasSeen(id) {
  try {
    return localStorage.getItem(STORAGE_PREFIX + id) === "1";
  } catch {
    // localStorage can throw in private-browsing/blocked-storage contexts.
    // Fail open (treat as "already seen") rather than risk the popup
    // getting stuck unable to be dismissed permanently.
    return true;
  }
}

function markSeen(id) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, "1");
  } catch {
    // Nothing to do if storage is blocked -- the hint will just reappear
    // next time, which is a minor annoyance, not a functional break.
  }
}

export default function OnboardingHint({ id, title, body, active }) {
  const [dismissed, setDismissed] = useState(false);
  const [everSeen, setEverSeen] = useState(true); // assume seen until checked, to avoid a one-frame flash

  useEffect(() => {
    setEverSeen(hasSeen(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!active || everSeen || dismissed) return null;

  function close() {
    markSeen(id);
    setDismissed(true);
  }

  return (
    <div style={styles.overlay} onClick={close}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>{title}</div>
        <div style={styles.body}>{body}</div>
        <button style={styles.gotIt} onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(20,18,14,0.35)",
    zIndex: 5000,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "#fffdf9",
    border: "1px solid #e5e2d8",
    borderRadius: 14,
    padding: "18px 20px",
    boxShadow: "0 -8px 30px rgba(0,0,0,0.18)",
    marginBottom: 8,
  },
  title: { fontSize: 15, fontWeight: 800, marginBottom: 6, color: "#1a1a1a" },
  body: { fontSize: 13.5, lineHeight: 1.55, color: "#444", marginBottom: 14 },
  gotIt: {
    border: "none",
    background: "#1a1a1a",
    color: "#fff",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
};
