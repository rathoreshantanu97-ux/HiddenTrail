// ---------------------------------------------------------------------------
// MAP SCHEMA — the contract every map config must satisfy.
//
// To add a NEW map in the future:
//   1. Create src/maps/yourMapName.js exporting an object shaped like the
//      MAP_CONFIG_SHAPE described below (copy an existing map file as a
//      starting template — e.g. city.js is the minimal example, westeros.js
//      is the fullest example with region art + icons).
//   2. Register it in src/maps/index.js (one line: import + add to MAPS).
//   3. Done. No changes needed to App.jsx, rendering, or multiplayer code —
//      everything downstream reads generically from the derived map object.
//
// MAP_CONFIG_SHAPE = {
//   id: string,                 // unique key, e.g. "city"
//   label: string,               // shown in map picker
//   subtitle: string,            // shown in map picker
//   stations: { [id]: [x, y] },  // 0-100 (or custom viewW/viewH) coord scale
//   edges: [[a, b, mode], ...],  // mode: "taxi" | "bus" | "underground"
//   ferryEdges: [[a, b], ...],   // Mr.X-only, always costs a black ticket
//   names: { [id]: string } | null,          // optional station names
//   majorStations: Set<number> | null,       // stations always labeled
//   majorLabelDir: { [id]: "N"|"S"|"E"|"W"|"NE"|"NW"|"SE"|"SW" } | null,
//   minorLabelDir: { [id]: same-as-above } | null,
//   modeTheme: { taxi:{color,label,short}, bus:{...}, underground:{...},
//                ferry:{...}, black:{...} } | null,  // null = use default theme
//   viewW: number,               // SVG viewBox width (default 100)
//   viewH: number,               // SVG viewBox height (default 100)
//   background: {                // OPTIONAL — drives the generic <MapBackground>
//     kind: "plain" | "regions" | "citymap",
//     ...kind-specific fields, see mapBackgrounds.js
//   },
//   characterNames: [string, ...] | null,  // optional theme reskin for player names
//   mrxName: string | null,                // optional theme reskin, default "Mr. X"
// }
// ---------------------------------------------------------------------------

export const MODE_DEFAULT = {
  taxi: { color: "#f2c14e", label: "Taxi", short: "T" },
  bus: { color: "#4e9c6d", label: "Bus", short: "B" },
  underground: { color: "#c1443c", label: "Metro", short: "M" },
  ferry: { color: "#2f8fbf", label: "Ferry", short: "F" },
  black: { color: "#2b2b2b", label: "Black", short: "X" },
};

// Builds all derived/computed structures a map needs at runtime from its
// raw config. This is the ONLY place that reads the raw stations/edges
// arrays — every other module (rendering, game logic, multiplayer) reads
// the derived object this function returns.
// ---------------------------------------------------------------------------
// computeMapLimits — derives sensible min/max detective and player counts
// from a map's station count and a configurable "detective density
// ratio". Every map (including any future one) automatically gets
// reasonable bounds with zero manual per-map tuning.
//
// CALIBRATION: the real Scotland Yard board game has ~199 stations and
// caps at 5 detectives -- a ratio of ~2.5%. Our current 64-station maps
// were being allowed up to 22 detectives under an earlier, much looser
// formula, which was too high (confirmed against actual play). The
// default ratio here is 8% -- roughly 3x the real board's own ratio,
// giving a max of 5 detectives on our current 64-station maps (matching
// the physical game's own cap almost exactly), while remaining
// admin-adjustable up to a hard ceiling of 20% for anyone who wants
// denser games. This ratio can also be overridden per-map (see
// p_mapRatioOverride) for a map whose actual layout calls for a
// different density than the global default.
//
//   maxDetectives = round(stationCount * ratio), ratio defaults to 0.08,
//     admin-adjustable up to a hard ceiling of 0.20 (enforced server-side
//     in set_timing_config, same "admin can't misconfigure this into
//     something broken" principle as every other bound in this project).
//   minDetectives = 3 (the base game's absolute floor, unchanged).
//   maxPlayers = maxDetectives + 1 (existing project-wide rule).
//   minPlayers = 2 (unchanged base floor).
// ---------------------------------------------------------------------------
export function computeMapLimits(stationCount, detectiveDensityRatio = 0.08) {
  const clampedRatio = Math.max(0.01, Math.min(0.20, detectiveDensityRatio));
  const maxDetectives = Math.max(3, Math.round(stationCount * clampedRatio));
  const minDetectives = 3;
  return {
    minDetectives,
    maxDetectives: Math.max(minDetectives, maxDetectives),
    minPlayers: 2,
    maxPlayers: Math.max(minDetectives, maxDetectives) + 1,
  };
}

// ---------------------------------------------------------------------------
// computeTicketCounts — derives starting ticket counts for detectives and
// Mr. X from a map's ACTUAL graph connectivity, not just its station
// count. Station count alone is a weak proxy for "how many moves does it
// take to get anywhere" -- two maps with the same station count can have
// very different average travel distances depending on how densely
// connected they are (confirmed by direct measurement: our three current
// 64-station maps have bus-mode average shortest-path distances ranging
// from 1.65 to 2.22, a 35% spread, despite identical station counts).
//
// METHOD: for each transport mode, compute the average shortest-path
// distance between all pairs of stations reachable by that mode alone
// (a breadth-first search from every station, restricted to edges of
// that one mode). Compare this map's average distance to a CALIBRATION
// BASELINE (the average of this same measurement across our three
// existing, already-tested, known-good maps) and scale the current
// known-good ticket values proportionally: a map requiring longer
// average travel gets more tickets per mode; a more tightly-connected
// map gets fewer.
//
// Sanity check built into this approach: since the three existing maps
// ARE the calibration data, running this function on any of them should
// reproduce ticket counts at or extremely close to the current,
// board-game-verified values (10 taxi / 8 bus / 4 underground for
// detectives; 4/3/3 for Mr.X's taxi/bus/underground) -- this was
// confirmed by direct computation before this function was written.
// ---------------------------------------------------------------------------
const TICKET_CALIBRATION_BASELINE_AVG_DISTANCE = { taxi: 5.7733, bus: 2.09, underground: 2.5933 };
const TICKET_CALIBRATION_DETECTIVE_COUNTS = { taxi: 10, bus: 8, underground: 4 };
const TICKET_CALIBRATION_MRX_COUNTS = { taxi: 4, bus: 3, underground: 3, black: 5, double: 2 };

function averageShortestPathForMode(graph, stationIds, mode) {
  const adj = {};
  for (const id of stationIds) adj[id] = [];
  for (const id of stationIds) {
    for (const edge of graph[id] || []) {
      if (edge.mode === mode) adj[id].push(edge.to);
    }
  }
  let totalDist = 0;
  let pairCount = 0;
  for (const src of stationIds) {
    const dist = { [src]: 0 };
    const queue = [src];
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      for (const next of adj[cur]) {
        if (!(next in dist)) {
          dist[next] = dist[cur] + 1;
          queue.push(next);
        }
      }
    }
    for (const dst of stationIds) {
      if (dst !== src && dst in dist) {
        totalDist += dist[dst];
        pairCount++;
      }
    }
  }
  return pairCount > 0 ? totalDist / pairCount : null;
}

export function computeTicketCounts(graph, stationIds) {
  const scaleFactor = {};
  for (const mode of ["taxi", "bus", "underground"]) {
    const mapAvg = averageShortestPathForMode(graph, stationIds, mode);
    // if this map has no edges of a mode at all (shouldn't happen for a
    // valid map, but guards against a divide-by-zero), fall back to a
    // neutral 1.0 scale (i.e. keep the calibration value unchanged)
    scaleFactor[mode] = mapAvg ? mapAvg / TICKET_CALIBRATION_BASELINE_AVG_DISTANCE[mode] : 1.0;
  }

  const detective = {};
  for (const [mode, base] of Object.entries(TICKET_CALIBRATION_DETECTIVE_COUNTS)) {
    detective[mode] = Math.max(1, Math.round(base * scaleFactor[mode]));
  }

  const mrx = {};
  for (const [mode, base] of Object.entries(TICKET_CALIBRATION_MRX_COUNTS)) {
    if (mode === "black" || mode === "double") {
      // black/double don't correspond to a single travel mode's distance
      // -- scale them by the AVERAGE of the three mode scale factors,
      // since they're general-purpose resources rather than tied to one
      // specific transport type's reach.
      const avgScale = (scaleFactor.taxi + scaleFactor.bus + scaleFactor.underground) / 3;
      mrx[mode] = Math.max(1, Math.round(base * avgScale));
    } else {
      mrx[mode] = Math.max(1, Math.round(base * scaleFactor[mode]));
    }
  }

  return { detective, mrx };
}

// ---------------------------------------------------------------------------
// computeRoundsAndRevealSchedule — derives the total round count and the
// reveal-round schedule from a map's actual graph connectivity, same
// methodology as computeTicketCounts (average shortest-path distance,
// calibrated against our three known-good maps). A map with a larger
// "typical travel distance" needs more rounds for a hunt to be
// plausible; a tighter map needs fewer.
//
// CALIBRATION: our three existing maps' overall average distance (taxi,
// bus, underground averaged together) is 3.48, and they're calibrated
// to the real game's 22-round standard -- confirmed by direct
// computation that applying this formula to our own maps reproduces
// 21-23 rounds (essentially unchanged from the current fixed value),
// which is the expected sanity-check result for a calibration baseline
// built from the same maps it's being verified against.
//
// REVEAL SCHEDULE: the real game's reveal rounds (3, 8, 13, 18, 22 of
// 22) fall at roughly 14%/36%/59%/82%/100% of the way through the game
// -- this computes reveal rounds as those SAME fractions of whatever
// total round count was computed, which exactly reproduces 3/8/13/18/22
// when total=22 (verified), and scales proportionally for any other
// total.
// ---------------------------------------------------------------------------
const ROUNDS_CALIBRATION_BASELINE_AVG_DISTANCE = 3.483; // average of taxi/bus/underground averages across our 3 known-good maps
const ROUNDS_CALIBRATION_ROUND_COUNT = 22;
const REVEAL_ROUND_FRACTIONS = [3 / 22, 8 / 22, 13 / 22, 18 / 22, 22 / 22];

export function computeRoundsAndRevealSchedule(graph, stationIds, roundScalingRatio = 1.0) {
  const overallAvg =
    (averageShortestPathForMode(graph, stationIds, "taxi") +
      averageShortestPathForMode(graph, stationIds, "bus") +
      averageShortestPathForMode(graph, stationIds, "underground")) /
    3;
  const scale = (overallAvg / ROUNDS_CALIBRATION_BASELINE_AVG_DISTANCE) * roundScalingRatio;
  const totalRounds = Math.max(10, Math.round(ROUNDS_CALIBRATION_ROUND_COUNT * scale));
  const revealRounds = REVEAL_ROUND_FRACTIONS.map((f) => Math.max(1, Math.round(f * totalRounds)));
  return { totalRounds, revealRounds };
}

export function deriveMap(config) {
  const { stations, edges, ferryEdges = [], names = null } = config;

  // Fail loudly and clearly here, at map-load time, rather than crashing
  // deep inside graph-building with a confusing "Cannot read properties
  // of undefined" error. This is the most common mistake when hand-editing
  // a map's edges array: a typo'd station number, or an edge left pointing
  // at a station you deleted.
  const stationIdSet = new Set(Object.keys(stations).map(Number));
  for (const [a, b, mode] of edges) {
    if (!stationIdSet.has(a) || !stationIdSet.has(b)) {
      throw new Error(
        `Map "${config.id}": edge [${a}, ${b}, "${mode}"] references a station that doesn't exist in this map's stations list. ` +
          `Check for a typo, or a station that was renumbered/deleted without updating its edges. ` +
          `Run "node src/maps/validateMap.js ${config.id}" for a full list of issues.`
      );
    }
  }
  for (const [a, b] of ferryEdges) {
    if (!stationIdSet.has(a) || !stationIdSet.has(b)) {
      throw new Error(
        `Map "${config.id}": ferry edge [${a}, ${b}] references a station that doesn't exist in this map's stations list. ` +
          `Run "node src/maps/validateMap.js ${config.id}" for a full list of issues.`
      );
    }
  }

  const graph = {};
  Object.keys(stations).forEach((s) => (graph[s] = []));
  edges.forEach(([a, b, mode]) => {
    graph[a].push({ to: b, mode, mrxOnly: false });
    graph[b].push({ to: a, mode, mrxOnly: false });
  });
  ferryEdges.forEach(([a, b]) => {
    graph[a].push({ to: b, mode: "ferry", mrxOnly: true });
    graph[b].push({ to: a, mode: "ferry", mrxOnly: true });
  });

  const allRenderEdges = [...edges, ...ferryEdges.map(([a, b]) => [a, b, "ferry"])];
  const edgeGroups = {};
  allRenderEdges.forEach(([a, b, mode]) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!edgeGroups[key]) edgeGroups[key] = [];
    edgeGroups[key].push(mode);
  });

  const stationModes = {};
  Object.keys(stations).forEach((s) => (stationModes[s] = new Set()));
  edges.forEach(([a, b, mode]) => {
    stationModes[a].add(mode);
    stationModes[b].add(mode);
  });
  ferryEdges.forEach(([a, b]) => {
    stationModes[a].add("ferry");
    stationModes[b].add("ferry");
  });

  return {
    id: config.id,
    label: config.label,
    subtitle: config.subtitle,
    stations,
    names,
    edges,
    ferryEdges,
    graph,
    allRenderEdges,
    edgeGroups,
    stationModes,
    startPool: Object.keys(stations).map(Number),
    majorStations: config.majorStations || null,
    majorLabelDir: config.majorLabelDir || null,
    minorLabelDir: config.minorLabelDir || null,
    modeTheme: config.modeTheme || null,
    viewW: config.viewW || 100,
    viewH: config.viewH || 100,
    background: config.background || { kind: "plain" },
    mapLimits: computeMapLimits(Object.keys(stations).length, config.detectiveDensityRatio),
    ticketCounts: computeTicketCounts(graph, Object.keys(stations).map(Number)),
    roundsAndReveal: computeRoundsAndRevealSchedule(graph, Object.keys(stations).map(Number), config.roundScalingRatio),
    characterNames: config.characterNames || null,
    mrxName: config.mrxName || "Mr. X",
    majorIcon: config.majorIcon || null,
  };
}
