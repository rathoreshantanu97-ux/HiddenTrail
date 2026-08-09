import { useState, useEffect } from "react";
import { getMapOverrides } from "./accessControlApi.js";
import { computeMapLimits, computeRoundsAndRevealSchedule } from "../maps/mapSchema.js";

// ---------------------------------------------------------------------------
// applyMapOverride — pure merge function, factored out of the hook below
// so it can also be used OUTSIDE React's render cycle (e.g. in App.jsx's
// game-start handlers, which read MAPS[id] directly rather than through
// a hook). This is the actual fix for a real bug: admin-set overrides
// were being correctly saved to Supabase and correctly PREVIEWED in the
// Landing/Setup screens (both of which DO use the hook below), but the
// moment a real match actually started, every game-start code path read
// MAPS[id] directly -- the raw, un-overridden map object from the static
// registry -- so the override silently never reached actual gameplay.
// ---------------------------------------------------------------------------
export function applyMapOverride(map, override) {
  if (!map) return null;
  if (!override) return map;
  const effectiveLimits =
    override.detectiveDensityRatioOverride != null
      ? computeMapLimits(Object.keys(map.stations).length, override.detectiveDensityRatioOverride)
      : map.mapLimits;
  const effectiveTicketCounts = override.ticketCountsOverride || map.ticketCounts;
  const effectiveRoundsAndReveal =
    override.roundScalingRatioOverride != null
      ? computeRoundsAndRevealSchedule(map.graph, Object.keys(map.stations).map(Number), override.roundScalingRatioOverride)
      : map.roundsAndReveal;

  return {
    ...map,
    mapLimits: effectiveLimits,
    ticketCounts: effectiveTicketCounts,
    roundsAndReveal: effectiveRoundsAndReveal,
  };
}

// ---------------------------------------------------------------------------
// useMapWithOverrides — fetches admin-set per-map overrides (detective
// density ratio, ticket counts, round-scaling ratio) and merges them
// onto a map's own computed defaults via applyMapOverride above. A map
// with no override at all just uses its computed values unchanged; this
// hook is what makes "admin can override per map" take effect in the
// Landing/Setup screens (previews before a game starts).
// ---------------------------------------------------------------------------
export function useMapWithOverrides(map) {
  const [overrides, setOverrides] = useState({});

  useEffect(() => {
    let cancelled = false;
    getMapOverrides()
      .then((result) => {
        if (!cancelled) setOverrides(result);
      })
      .catch((e) => console.error("Failed to fetch map overrides:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!map) return null;
  return applyMapOverride(map, overrides[map.id]);
}

