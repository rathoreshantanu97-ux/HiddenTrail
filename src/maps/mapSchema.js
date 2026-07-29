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
    characterNames: config.characterNames || null,
    mrxName: config.mrxName || "Mr. X",
    majorIcon: config.majorIcon || null,
  };
}
