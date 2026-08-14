import { useState, useEffect } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useHighlightStyles — FOUR independent highlight-style settings (v3.32).
//
// Up to v3.31 there were two: one "position/origin" style and one
// "destination" style, each applied uniformly to BOTH the planning phase
// and the acting phase. Those two phases now ask for genuinely different
// things visually — planning shows the whole team's positions at rest,
// acting shows which of YOUR OWN pieces still owe a move — so each of the
// two roles is now configurable per phase, giving four slots:
//
//   planningPositionStyle     origin indicator, planning phase
//   planningDestinationStyle  destination indicator, planning phase
//   actingPositionStyle       origin indicator, acting phase
//   actingDestinationStyle    destination indicator, acting phase
//
// "Acting phase" here means WHOEVER IS ACTING, not literally
// round_phase='acting'. As of v3.36 Mr.X's own turn (round_phase='mrx',
// seen from Mr.X's client) selects the acting pair too, since that turn
// is his acting window -- see the useActingHighlightStyles note in
// GameBoard.jsx. Detectives during 'mrx' still get the planning pair.
//
// BACKWARD COMPATIBILITY is handled server-side, not here: the migration
// seeded the acting_* columns from the existing single values, so a room
// that predates the split renders as it did before until someone
// deliberately configures the two phases differently.
//
// If a room's acting_* override is unset, the get_effective_acting_* RPCs
// fall back to the ADMIN GLOBAL DEFAULT -- NOT to that room's
// planning-phase value. (Verified live against production; an earlier
// version of this comment claimed the planning-phase fallback, which was
// simply wrong.) That is the same "unset = inherit the admin default"
// rule every other room-level override in this codebase follows, so there
// is no special case to remember here.
//
// Pass roomId=null for pass-and-play, where there's no room-level
// override concept -- always resolves to the admin's global default in
// that case (or the hardcoded fallback if Supabase isn't configured).
// ---------------------------------------------------------------------------
export function useHighlightStyles(roomId) {
  const [planningPositionStyle, setPlanningPositionStyle] = useState("ring");
  const [planningDestinationStyle, setPlanningDestinationStyle] = useState("rotating");
  const [actingPositionStyle, setActingPositionStyle] = useState("ring");
  const [actingDestinationStyle, setActingDestinationStyle] = useState("rotating");

  useEffect(() => {
    let cancelled = false;
    const load = (fn, setter, what) =>
      fn(roomId)
        .then((s) => {
          if (!cancelled) setter(s);
        })
        .catch((e) => console.error(`Failed to fetch ${what} highlight style:`, e));

    load(api.getEffectivePositionHighlightStyle, setPlanningPositionStyle, "planning position");
    load(api.getEffectiveDestinationHighlightStyle, setPlanningDestinationStyle, "planning destination");
    load(api.getEffectiveActingPositionHighlightStyle, setActingPositionStyle, "acting position");
    load(api.getEffectiveActingDestinationHighlightStyle, setActingDestinationStyle, "acting destination");

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return { planningPositionStyle, planningDestinationStyle, actingPositionStyle, actingDestinationStyle };
}
