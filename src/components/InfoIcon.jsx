import React, { useState } from "react";

// ---------------------------------------------------------------------------
// INFO ICON -- a small "ⓘ" that shows a tooltip on hover (and on tap, for
// touch devices, since there's no hover state to trigger it there).
//
// DELIBERATELY NOT used everywhere a setting exists -- most of the room
// creation form already carries its own inline caption text under each
// field, which is more readable than a tooltip and doesn't require an
// interaction to see. This component exists for the opposite situation:
// compact, in-game UI (the side panel, the map's top bar/corners) where
// there is no room for a paragraph, but the control still needs a short
// explanation the FIRST few times someone sees it.
//
// side: which side of the icon the tooltip opens on. Defaults to "bottom"
// since most placements are near the top of their container; pass "top"
// for anything anchored near the bottom of the viewport (so the tooltip
// doesn't render off-screen).
// ---------------------------------------------------------------------------
export default function InfoIcon({ text, side = "bottom", size = 14 }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ ...styles.wrap, width: size, height: size }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        // Tap-to-toggle for touch devices; stopPropagation so tapping the
        // icon doesn't also trigger whatever the parent row's onClick is
        // (several of these sit inside clickable labels/checkboxes).
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      role="button"
      tabIndex={0}
      aria-label="More info"
    >
      <span style={{ ...styles.dot, width: size, height: size, fontSize: size * 0.8 }}>i</span>
      {open && (
        <span style={{ ...styles.tooltip, ...(side === "top" ? styles.tooltipTop : styles.tooltipBottom) }}>{text}</span>
      )}
    </span>
  );
}

const styles = {
  wrap: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "help",
    flexShrink: 0,
    verticalAlign: "middle",
  },
  dot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: "#e6e2d6",
    color: "#6b6252",
    fontWeight: 700,
    fontStyle: "italic",
    fontFamily: "Georgia, serif",
    lineHeight: 1,
  },
  tooltip: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    width: 220,
    maxWidth: "60vw",
    background: "#1a1a1a",
    color: "#f5f3ee",
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.5,
    borderRadius: 8,
    padding: "8px 10px",
    zIndex: 4000,
    boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
    textAlign: "left",
    whiteSpace: "normal",
  },
  tooltipBottom: { top: "calc(100% + 6px)" },
  tooltipTop: { bottom: "calc(100% + 6px)" },
};
