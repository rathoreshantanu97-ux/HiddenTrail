// ---------------------------------------------------------------------------
// computeSeatLayout — client-side mirror of the compute_seat_layout()
// Postgres function in supabase/functions.sql. Used to show an instant
// preview of the fair-split seat layout as the host adjusts detective
// count / total players in the Create Room form, without a server round
// trip on every slider tick. The actual room creation still goes through
// the server-side function as the source of truth -- this is purely a
// UI preview helper and must stay logically identical to its SQL
// counterpart (same floor/ceil math, same seat-id assignment order).
// ---------------------------------------------------------------------------
export function computeSeatLayout(numDetectives, totalPlayers) {
  const controllers = totalPlayers - 1;
  if (controllers < 1) {
    throw new Error("total_players must be at least 2 (1 Mr.X + at least 1 detective-controller)");
  }
  if (numDetectives < controllers) {
    throw new Error(`num_detectives (${numDetectives}) must be at least the number of detective-controllers (${controllers})`);
  }

  const base = Math.floor(numDetectives / controllers);
  const extra = numDetectives % controllers;
  let nextDet = 0;
  const seats = [];
  for (let i = 1; i <= controllers; i++) {
    const count = base + (i <= extra ? 1 : 0);
    const ids = [];
    for (let d = nextDet; d < nextDet + count; d++) ids.push(`d${d}`);
    seats.push({ seatRole: ids.join(","), detectiveCount: count });
    nextDet += count;
  }
  return seats;
}

// Human-readable label for a seat role, e.g. "d0,d1" -> "Detectives 1 & 2"
// or "d3,d4,d5" -> "Detectives 4-6". Single-detective seats just say
// "Detective N".
//
// `theme` is an optional { mrxName, detectiveTeamName } pair for maps that
// reskin these terms (e.g. Westeros's "The Faceless Men" for Mr. X, "The
// Common Men" for detectives) -- omit it (or leave a field unset) to fall
// back to the generic default, same pattern as mrxName()/detectiveName()
// elsewhere. This is a PURE function with no map access of its own, so
// every call site that has a map loaded must pass its names through
// explicitly.
export function seatLabel(seatRole, theme) {
  const mrxName = theme?.mrxName || "Mr. X";
  // Same singular-preserving rule as detectiveLabel() in mapSchema.js:
  // only switch wording once a REAL custom team name is set, otherwise
  // keep the exact original "Detective"/"Detectives" text (the plural
  // default alone would otherwise read as "Detectives 1" for a single
  // seat on every map that hasn't customized this).
  const rawTeamName = theme?.detectiveTeamName;
  const hasCustomTeamName = !!rawTeamName && rawTeamName !== "Detectives";
  const singular = hasCustomTeamName ? rawTeamName : "Detective";
  const plural = hasCustomTeamName ? rawTeamName : "Detectives";
  if (seatRole === "mrx") return mrxName;
  const ids = seatRole.split(",").map((s) => parseInt(s.slice(1), 10) + 1); // 1-indexed for display
  if (ids.length === 1) return `${singular} ${ids[0]}`;
  if (ids.length === 2) return `${plural} ${ids[0]} & ${ids[1]}`;
  return `${plural} ${ids[0]}-${ids[ids.length - 1]}`;
}

// Non-throwing wrapper for contexts where a crash would be worse than a
// silent fallback -- e.g. the join-room form receiving a legacy room's
// data (created before total_players existed) or any other unexpected
// combination. Falls back to one-detective-per-seat if the fair-split
// math can't be computed for the given inputs.
export function computeSeatLayoutSafe(numDetectives, totalPlayers) {
  try {
    if (!totalPlayers || totalPlayers < 2) {
      return Array.from({ length: numDetectives }, (_, i) => ({ seatRole: `d${i}`, detectiveCount: 1 }));
    }
    return computeSeatLayout(numDetectives, totalPlayers);
  } catch {
    return Array.from({ length: numDetectives }, (_, i) => ({ seatRole: `d${i}`, detectiveCount: 1 }));
  }
}
