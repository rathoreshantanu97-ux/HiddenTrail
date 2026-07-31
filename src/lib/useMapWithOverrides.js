import { useState, useEffect } from "react";
import { getMapOverrides } from "./accessControlApi.js";
import { computeMapLimits, computeRoundsAndRevealSchedule } from "../maps/mapSchema.js";

// ---------------------------------------------------------------------------
// useMapWithOverrides — fetches admin-set per-map overrides (detective
// density ratio, ticket counts, round-scaling ratio) and merges them
// onto a map's own computed defaults. A map with no override at all just
// uses its computed values unchanged; this hook is what makes "admin can
// override per map" actually take effect on the client (Create Room
// form, etc), on top of the computed defaults already built into each
// map object.
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

  const override = overrides[map.id];
  const effectiveLimits =
    override?.detectiveDensityRatioOverride != null
      ? computeMapLimits(Object.keys(map.stations).length, override.detectiveDensityRatioOverride)
      : map.mapLimits;
  const effectiveTicketCounts = override?.ticketCountsOverride || map.ticketCounts;
  const effectiveRoundsAndReveal =
    override?.roundScalingRatioOverride != null
      ? computeRoundsAndRevealSchedule(map.graph, Object.keys(map.stations).map(Number), override.roundScalingRatioOverride)
      : map.roundsAndReveal;

  return {
    ...map,
    mapLimits: effectiveLimits,
    ticketCounts: effectiveTicketCounts,
    roundsAndReveal: effectiveRoundsAndReveal,
  };
}
