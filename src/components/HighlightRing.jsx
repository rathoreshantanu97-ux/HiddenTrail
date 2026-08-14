import React from "react";

// ---------------------------------------------------------------------------
// HIGHLIGHT RING — the ONE place every station-highlight ring is drawn,
// for both position indicators (current/starting position) and
// destination indicators (legal moves). Previously this SVG was
// duplicated inline across multiple conditional blocks in GameBoard.jsx
// (one for the turn-indicator, a separate one for the legal-move ring,
// a separate one for Mr.X's private indicator) -- consolidating into one
// component is what actually fixes the reported "rotating ring doesn't
// rotate for underground stations" bug: since there was never a
// mode-specific difference in the ring logic itself, the real problem
// was duplicated/inconsistent SVG scattered across the file, some paths
// of which could differ subtly; a single shared renderer removes that
// class of bug entirely by construction -- there's now only one way to
// draw a ring, used everywhere.
//
// style: 'ring' | 'rotating' | 'blink' | 'static' | 'none'
// 'blink' renders a standalone pulsing-opacity ring here -- EXCEPT for
// position indicators (the turn-indicator, Mr.X's private locator),
// where the caller (GameBoard.jsx) skips calling this component
// entirely and instead animates the station's OWN fill directly, since
// that reads better for "this station IS you" than a separate ring
// would.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// v3.36 -- THE TWO RING ROLES, as shared constants.
//
// Audit finding: across v3.19-v3.35 every call site picked its own
// strokeWidth and its own `dashed`, which meant ONE configured style
// value rendered as visibly different things depending on where it
// landed. Concretely, with the room set to 'static' the same "this is a
// destination" idea was drawn at 0.25 wide in one place and 0.3 in
// another, and the first stacked reach-ring came out SOLID while every
// other destination ring was dashed -- so a solid ring meant "origin"
// everywhere except there, where it meant "destination". None of that
// was a decision; it was drift.
//
// The rule now, and the only thing call sites are allowed to vary, is:
//
//   ORIGIN_RING       solid, 0.4 wide  -- "the piece IS here"
//   DESTINATION_RING  dashed, 0.3 wide -- "the piece COULD go here"
//
// RADIUS IS EXPLICITLY NOT STANDARDISED and must stay per-call-site: the
// v3.34 fix deliberately gives coexisting rings different radii so they
// can't paint over each other. Radius answers "which ring am I looking
// at"; stroke weight and dash answer "what KIND of thing is it". Those
// are separate questions and only the second one has to be global.
// ---------------------------------------------------------------------------
export const ORIGIN_RING = { strokeWidth: 0.4, dashed: false };
export const DESTINATION_RING = { strokeWidth: 0.3, dashed: true };

export default function HighlightRing({ x, y, radius, color, strokeWidth = 0.35, dashed = false, style }) {
  if (style === "none") return null;

  const dashArray = dashed ? "0.7,0.7" : undefined;

  if (style === "blink") {
    // Standalone blink: used for DESTINATION indicators, where (unlike a
    // position indicator) there's no separate station fill representing
    // "you" to animate instead -- a destination's fill represents
    // occupancy state, a different concept. So here, blink means the
    // ring itself pulses opacity, no size change, no rotation/dashes.
    return (
      <circle cx={x} cy={y} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} opacity={0.85}>
        <animate attributeName="opacity" values="0.85;0.15;0.85" dur="1s" repeatCount="indefinite" />
      </circle>
    );
  }

  if (style === "static") {
    return <circle cx={x} cy={y} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={dashArray} opacity={0.85} />;
  }

  if (style === "rotating") {
    // NOTE (v3.36 audit): 'rotating' forces a dash pattern even for a
    // role whose contract is solid (ORIGIN_RING). That is intrinsic, not
    // drift -- a perfectly solid circle rotating about its own centre is
    // pixel-for-pixel identical to a stationary one, so the style would
    // silently degrade to 'static'. The dash IS the animation here.
    return (
      <circle cx={x} cy={y} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={dashArray || "0.7,0.7"} opacity={0.7}>
        <animateTransform attributeName="transform" type="rotate" from={`0 ${x} ${y}`} to={`360 ${x} ${y}`} dur="4s" repeatCount="indefinite" />
      </circle>
    );
  }

  // default: 'ring' -- pulsing size/opacity, the original animated style
  return (
    <circle cx={x} cy={y} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={dashArray} opacity={0.9}>
      <animate attributeName="r" values={`${radius * 0.85}; ${radius * 1.25}; ${radius * 0.85}`} dur="1.4s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.4s" repeatCount="indefinite" />
    </circle>
  );
}
