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
  taxi: { color: "#c9971f", label: "Taxi", short: "T" },
  bus: { color: "#4e9c6d", label: "Bus", short: "B" },
  underground: { color: "#c1443c", label: "Metro", short: "M" },
  ferry: { color: "#1a1a1a", label: "Ferry", short: "F" },
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
// Real Scotland Yard board reference: 199 stations total, taxi at every
// one (100%), bus at 62 (31.2%), underground at 14 (7.0%). Used as the
// second calibration signal alongside average shortest-path distance --
// see the long comment in computeTicketCounts for why coverage alone
// isn't redundant with distance.
const TICKET_CALIBRATION_BASELINE_COVERAGE = { taxi: 1.0, bus: 0.312, underground: 0.07 };
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

export function computeTicketCounts(graph, stationIds, totalRounds = null) {
  const scaleFactor = {};
  // COVERAGE ratio: what fraction of all stations have at least one edge
  // of this mode. Added alongside the existing distance-based scaling
  // because distance alone under-counts a genuinely large, useful
  // network: confirmed on a real map here that a metro network covering
  // MORE of the map than the real board's own reference ratio (11.1% of
  // stations vs the real board's 7.0%) was still landing on FEWER
  // tickets (3) than the real board's own baseline (4) -- distance-only
  // scaling was picking up "this subgraph is small and tightly
  // clustered, so it's efficient" and translating that into "give fewer
  // tickets," when a bigger, more-covered network arguably deserves
  // MORE opportunities to use it, not fewer. Blending 50/50 with the
  // distance-based factor keeps both signals: a mode that's both compact
  // AND covers a lot of the map (genuinely efficient) still scores high;
  // a mode that's sparse and inefficient scores low on both.
  const coverageRatio = {};
  const totalStations = stationIds.length;
  for (const mode of ["taxi", "bus", "underground"]) {
    const stationsWithMode = new Set();
    for (const id of stationIds) {
      for (const edge of graph[id] || []) {
        if (edge.mode === mode) stationsWithMode.add(id);
      }
    }
    coverageRatio[mode] = totalStations > 0 ? stationsWithMode.size / totalStations : 0;
  }
  const distanceScale = {};
  for (const mode of ["taxi", "bus", "underground"]) {
    const mapAvg = averageShortestPathForMode(graph, stationIds, mode);
    // if this map has no edges of a mode at all (shouldn't happen for a
    // valid map, but guards against a divide-by-zero), fall back to a
    // neutral 1.0 scale (i.e. keep the calibration value unchanged)
    distanceScale[mode] = mapAvg ? mapAvg / TICKET_CALIBRATION_BASELINE_AVG_DISTANCE[mode] : 1.0;
  }
  for (const mode of ["taxi", "bus", "underground"]) {
    const coverageScale = TICKET_CALIBRATION_BASELINE_COVERAGE[mode] > 0
      ? coverageRatio[mode] / TICKET_CALIBRATION_BASELINE_COVERAGE[mode]
      : 1.0;
    scaleFactor[mode] = (distanceScale[mode] + coverageScale) / 2;
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

  enforceRealBoardProportions(detective, mrx);

  // On the real board, detective total tickets (10+8+4=22) essentially
  // EQUAL the round count (22) -- by design, a detective playing
  // efficiently (favoring taxi) can just barely last the whole game,
  // while running dry before round 22 is a genuine, intended way for
  // detectives to lose (confirmed: "if none of the detectives can move
  // because they have run out of fare tickets, Mr. X wins"). That ratio
  // (total tickets / rounds = 1.0) is a real design target, not
  // incidental -- but it can currently be violated on this project's
  // maps because ticket counts and round count are calibrated by two
  // independent formulas with no cross-check between them (confirmed:
  // one real map here computed 19 total detective tickets against a
  // 24-round game, meaning detectives were guaranteed to run out with
  // 5 "free" rounds still on the clock, through no fault of their own
  // play -- that's a broken game, not intended tension). If a
  // totalRounds value is provided, raise TAXI (the cheap, plentiful
  // tier -- same logic as enforceRealBoardProportions above: taxi's
  // measurement is the reliable one to flex) until the detective total
  // reaches the round count.
  if (totalRounds) {
    const detTotal = detective.taxi + detective.bus + detective.underground;
    if (detTotal < totalRounds) {
      detective.taxi += totalRounds - detTotal;
    }
  }

  return { detective, mrx };
}

// enforceRealBoardProportions — each transport mode is scaled
// INDEPENDENTLY against its own historical baseline (see comment above
// computeTicketCounts), which can invert the real game's resource
// hierarchy on a map where one mode's subgraph happens to be unusually
// sparse or dense relative to the others. Concretely confirmed on a real
// map in this project: bus is a genuinely sparse tier (a minority of
// stations have it at all), so a bus-only shortest-path search naturally
// produces a SMALL average distance relative to bus's own baseline --
// which the independent per-mode scaling read as "bus is efficient here,
// give MORE bus tickets," producing 14 bus tickets vs only 9 taxi tickets
// for detectives. That's backwards: on the real Scotland Yard board, taxi
// is deliberately the most plentiful, lowest-value resource and bus/
// underground are progressively scarcer, HIGHER-value resources -- that
// hierarchy is a fixed design property of the game, not something that
// should be able to invert based on a single map's graph shape.
//
// This clamps the SCALED counts (so map-size-driven scaling is still
// fully preserved -- a bigger, more spread-out map still gets more
// tickets overall) to never violate the real board's own minimum
// proportions between tiers, computed directly from the real board's
// known-good values (detective 10/8/4, Mr.X 4/3/3):
//   detective taxi >= bus * 1.25   (10/8)
//   detective bus  >= underground * 2.0   (8/4)
//   mrx taxi >= bus * 1.33   (4/3)
//   mrx bus  >= underground * 1.0   (3/3)
// Enforced by CAPPING bus/underground down to what taxi's own (reliable)
// scaling earned, rather than raising taxi to match an inflated bus
// count -- see the long comment inside the function for why taxi is the
// trustworthy anchor here.
const REAL_BOARD_MIN_RATIO = {
  detective: { taxiPerBus: 10 / 8, busPerUnderground: 8 / 4 },
  mrx: { taxiPerBus: 4 / 3, busPerUnderground: 3 / 3 },
};

function enforceRealBoardProportions(detective, mrx) {
  for (const [counts, ratios] of [
    [detective, REAL_BOARD_MIN_RATIO.detective],
    [mrx, REAL_BOARD_MIN_RATIO.mrx],
  ]) {
    // Anchor on TAXI, not bus. Taxi's own scaling measurement is the
    // reliable one here: taxi connects nearly every station (dense,
    // fully/near-fully connected subgraph), so its average-shortest-path
    // measurement genuinely reflects the map's overall size. Bus and
    // underground are sparse minority tiers by design (a majority of
    // stations have neither) -- searched in isolation, their subgraphs
    // can produce a misleadingly small average distance that has more to
    // do with "few stations to search between" than "this map needs
    // fewer bus tickets." Anchoring on taxi and capping the scarcer
    // tiers DOWN to it (rather than raising taxi to match an inflated
    // bus count) keeps the map's overall generosity calibrated to what
    // taxi's trustworthy measurement actually earned, instead of having
    // an unreliable bus measurement drag every tier upward with it.
    const maxBus = Math.floor(counts.taxi / ratios.taxiPerBus);
    if (counts.bus > maxBus) counts.bus = Math.max(1, maxBus);

    const maxUnderground = Math.floor(counts.bus / ratios.busPerUnderground);
    if (counts.underground > maxUnderground) counts.underground = Math.max(1, maxUnderground);

    // Still guard the floor direction too (bus/underground unexpectedly
    // scaled to near-zero on some future pathological map shape) so the
    // hierarchy holds from both sides, not just "not too generous."
    const minBus = Math.ceil(counts.underground * ratios.busPerUnderground);
    if (counts.bus < minBus) counts.bus = minBus;
    const minTaxi = Math.ceil(counts.bus * ratios.taxiPerBus);
    if (counts.taxi < minTaxi) counts.taxi = minTaxi;
  }
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

// computeStartPool — the real board doesn't let starting positions be
// drawn from all 199 stations uniformly at random: detectives and Mr.X
// each draw from a curated pool of exactly 18 positions, specifically
// chosen to be spread far enough apart that Mr.X cannot be caught in the
// very first round no matter how the draw comes out. Confirmed this was
// a real gap here: with every station in the pool and pure uniform
// sampling, simulation showed Mr.X landing as close as the single
// tightest adjacent-station gap on the whole map (same distance as two
// directly-connected neighbors) purely by bad luck -- a plausible
// round-1 capture with no real chase involved.
//
// METHOD: greedy farthest-point sampling. Start from a SEED station (see
// randomSeed param below), then repeatedly add whichever remaining
// station has the LARGEST minimum distance to every station already
// chosen. This is a standard, well-behaved algorithm for "pick a
// well-spread subset" and runs in O(poolSize x stationCount), trivial at
// these map sizes.
//
// RANDOMIZED PER GAME: unlike a fixed printed card deck, this pool can be
// cheaply recomputed, so instead of caching one pool per map forever, the
// actual game-start flow (see gameEngine.js) calls this fresh each new
// game with a RANDOM seed station, so different games use different
// regions of the map as starting zones -- not just the same 8-9 spots
// forever -- while the greedy algorithm still guarantees the same
// spacing quality every time regardless of which seed was picked. A
// deterministic (no-seed) call is kept as the default for anything that
// just wants "a reasonable spread pool" without per-game randomization
// (e.g. a preview/admin tool).
//
// POOL SIZE: scaled proportionally from the real board's 18-of-199 ratio
// (~9%) rather than hardcoded to 18, since our maps range from ~70 to
// ~100 stations, not 199 -- a fixed 18 would be a much larger fraction of
// a smaller map's stations (less genuine "curation") or, on a bigger
// future map, a much smaller one. Floors at 8 so even a small map still
// gets real variety rather than a near-fixed rotation of start spots.
const START_POOL_RATIO = 18 / 199;

export function computeStartPool(stations, randomSeed = false) {
  const ids = Object.keys(stations).map(Number);
  const poolSize = Math.max(8, Math.round(ids.length * START_POOL_RATIO));
  if (ids.length <= poolSize) return ids; // small map: every station is already "curated enough"

  const dist = (a, b) => {
    const [ax, ay] = stations[a];
    const [bx, by] = stations[b];
    return Math.hypot(ax - bx, ay - by);
  };

  let seed;
  if (randomSeed) {
    // Per-game randomization: pick any station as the seed at random,
    // rather than always the one farthest from the centroid. The greedy
    // farthest-point pass that follows still guarantees a well-spread
    // pool regardless of which seed it started from -- only WHICH
    // stations end up in the pool varies, not the quality of the spread.
    seed = ids[Math.floor(Math.random() * ids.length)];
  } else {
    // Deterministic default: the station farthest from the map's
    // centroid, so repeated calls without randomSeed are stable/
    // reproducible (useful for anything inspecting "the" pool rather
    // than starting an actual game).
    const cx = ids.reduce((s, id) => s + stations[id][0], 0) / ids.length;
    const cy = ids.reduce((s, id) => s + stations[id][1], 0) / ids.length;
    seed = ids[0];
    let seedDist = -1;
    for (const id of ids) {
      const d = Math.hypot(stations[id][0] - cx, stations[id][1] - cy);
      if (d > seedDist) {
        seedDist = d;
        seed = id;
      }
    }
  }

  const chosen = [seed];
  const remaining = new Set(ids);
  remaining.delete(seed);

  while (chosen.length < poolSize && remaining.size > 0) {
    let best = null;
    let bestMinDist = -1;
    for (const candidate of remaining) {
      let minDist = Infinity;
      for (const c of chosen) {
        const d = dist(candidate, c);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        best = candidate;
      }
    }
    chosen.push(best);
    remaining.delete(best);
  }

  return chosen;
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
    startPool: computeStartPool(stations),
    majorStations: config.majorStations || null,
    majorLabelDir: config.majorLabelDir || null,
    minorLabelDir: config.minorLabelDir || null,
    tinyLabelStations: config.tinyLabelStations || null, // optional Set of station IDs using an even smaller label font than "minor" -- used by maps with especially dense clusters (e.g. Sendhwa's town core) where the standard 2-tier system alone can't avoid every label collision
    modeTheme: config.modeTheme || null,
    viewW: config.viewW || 100,
    viewH: config.viewH || 100,
    background: config.background || { kind: "plain" },
    mapLimits: computeMapLimits(Object.keys(stations).length, config.detectiveDensityRatio),
    ticketCounts: computeTicketCounts(
      graph,
      Object.keys(stations).map(Number),
      computeRoundsAndRevealSchedule(graph, Object.keys(stations).map(Number), config.roundScalingRatio).totalRounds
    ),
    roundsAndReveal: computeRoundsAndRevealSchedule(graph, Object.keys(stations).map(Number), config.roundScalingRatio),
    characterNames: config.characterNames || null,
    mrxName: config.mrxName || "Mr. X",
    majorIcon: config.majorIcon || null,
  };
}
