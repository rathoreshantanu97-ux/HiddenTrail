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

  // Curve/station VISUAL overrides, from the in-UI map editor
  // (MapEditorPanel.jsx). Merged the same way as every override above --
  // present fields replace the map's own default, everything else falls
  // through unchanged. manualCurveOffsets is merged key-by-key (an
  // override for ONE edge shouldn't drop every other edge's own manual
  // curve) rather than wholesale replaced.
  const effectiveManualCurveOffsets = override.curveOffsetOverrides
    ? { ...(map.manualCurveOffsets || {}), ...override.curveOffsetOverrides }
    : map.manualCurveOffsets;

  let effectiveStations = map.stations;
  let effectiveNames = map.names;
  let effectiveMajorLabelDir = map.majorLabelDir;
  let effectiveMinorLabelDir = map.minorLabelDir;
  let effectiveMajorStations = map.majorStations;

  if (override.stationOverrides) {
    effectiveStations = { ...map.stations };
    effectiveNames = { ...(map.names || {}) };
    effectiveMajorLabelDir = { ...(map.majorLabelDir || {}) };
    effectiveMinorLabelDir = { ...(map.minorLabelDir || {}) };
    effectiveMajorStations = new Set(map.majorStations || []);

    for (const [idStr, fields] of Object.entries(override.stationOverrides)) {
      const id = Number(idStr);
      if (fields.x != null && fields.y != null) {
        effectiveStations[id] = [fields.x, fields.y];
      }
      if (fields.name != null) {
        effectiveNames[id] = fields.name;
      }
      if (fields.isMajor != null) {
        if (fields.isMajor) effectiveMajorStations.add(id);
        else effectiveMajorStations.delete(id);
      }
      // labelDir applies to whichever list (major/minor) the station
      // currently belongs to, checked AFTER the isMajor override above
      // so a station just promoted/demoted this same save gets its
      // label direction written to the right list.
      if (fields.labelDir !== undefined) {
        if (effectiveMajorStations.has(id)) {
          effectiveMajorLabelDir[id] = fields.labelDir;
        } else {
          effectiveMinorLabelDir[id] = fields.labelDir;
        }
      }
    }
  }

  // Decorations (icons/shapes/text/images) and the background color
  // override are both whole-value overrides, not merged piecemeal like
  // manualCurveOffsets/stations above -- a decorations LIST is an
  // ordered array where position matters, so there's no sensible
  // per-key merge (unlike an edge-keyed or station-id-keyed object); the
  // editor always saves/loads the complete list. undefined means "no
  // override object at all," so the map's own default (no decorations,
  // no override color) still applies -- only an explicit override value
  // (including an empty array, meaning "admin cleared every decoration")
  // replaces it.
  const effectiveDecorations = override.decorations !== undefined ? override.decorations : map.decorations || null;
  const effectiveBackgroundOverrideColor =
    override.backgroundOverrideColor !== undefined ? override.backgroundOverrideColor : null;

  return {
    ...map,
    mapLimits: effectiveLimits,
    ticketCounts: effectiveTicketCounts,
    roundsAndReveal: effectiveRoundsAndReveal,
    manualCurveOffsets: effectiveManualCurveOffsets,
    stations: effectiveStations,
    names: effectiveNames,
    majorLabelDir: effectiveMajorLabelDir,
    minorLabelDir: effectiveMinorLabelDir,
    majorStations: effectiveMajorStations,
    decorations: effectiveDecorations,
    backgroundOverrideColor: effectiveBackgroundOverrideColor,
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

