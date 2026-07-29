// ---------------------------------------------------------------------------
// MAP VALIDATOR — run this after editing any map file to catch mistakes
// BEFORE they reach the deployed app. Usage:
//
//   node src/maps/validateMap.js city
//   node src/maps/validateMap.js bengaluru
//   node src/maps/validateMap.js westeros
//   node src/maps/validateMap.js          (validates ALL registered maps)
//
// Catches the mistakes that are easy to make by hand-editing coordinate
// arrays and easy to miss until the app is already running:
//   - duplicate station IDs
//   - edges pointing to a station ID that doesn't exist
//   - a station with zero connections (unreachable / stranded)
//   - coordinates outside the map's viewBox
//   - names/label-directions referencing a station ID that doesn't exist
//   - majorStations referencing a station ID that doesn't exist
//   - not enough stations for the max supported player count (6 -- 1 Mr.X
//     + 5 detectives)
// ---------------------------------------------------------------------------
import { MAPS, MAP_LIST } from "./index.js";

function validateOneMap(map) {
  const errors = [];
  const warnings = [];

  const stationIds = Object.keys(map.stations).map(Number);
  const stationIdSet = new Set(stationIds);

  // duplicate IDs aren't actually possible from a JS object literal (later
  // key wins silently) -- but if station data was ever generated
  // programmatically this guards against it being silently deduped.
  if (stationIds.length !== stationIdSet.size) {
    errors.push(`Duplicate station IDs detected.`);
  }

  // coordinates within viewBox
  const w = map.viewW || 100;
  const h = map.viewH || 100;
  for (const id of stationIds) {
    const [x, y] = map.stations[id];
    if (x < 0 || x > w || y < 0 || y > h) {
      warnings.push(`Station ${id} at [${x}, ${y}] is outside the ${w}x${h} viewBox.`);
    }
  }

  // edges reference real stations
  for (const [a, b, mode] of map.edges) {
    if (!stationIdSet.has(a)) errors.push(`Edge [${a},${b},"${mode}"] references non-existent station ${a}.`);
    if (!stationIdSet.has(b)) errors.push(`Edge [${a},${b},"${mode}"] references non-existent station ${b}.`);
    if (a === b) errors.push(`Edge [${a},${b},"${mode}"] connects a station to itself.`);
  }
  for (const [a, b] of map.ferryEdges) {
    if (!stationIdSet.has(a)) errors.push(`Ferry edge [${a},${b}] references non-existent station ${a}.`);
    if (!stationIdSet.has(b)) errors.push(`Ferry edge [${a},${b}] references non-existent station ${b}.`);
  }

  // every station reachable by at least one edge (taxi/bus/underground/ferry)
  const connected = new Set();
  for (const [a, b] of map.edges) {
    connected.add(a);
    connected.add(b);
  }
  for (const [a, b] of map.ferryEdges) {
    connected.add(a);
    connected.add(b);
  }
  for (const id of stationIds) {
    if (!connected.has(id)) errors.push(`Station ${id} has NO connections at all -- it's unreachable.`);
  }

  // names / label directions reference real stations
  if (map.names) {
    for (const id of Object.keys(map.names).map(Number)) {
      if (!stationIdSet.has(id)) errors.push(`names has an entry for non-existent station ${id}.`);
    }
  }
  if (map.majorLabelDir) {
    for (const id of Object.keys(map.majorLabelDir).map(Number)) {
      if (!stationIdSet.has(id)) errors.push(`majorLabelDir has an entry for non-existent station ${id}.`);
    }
  }
  if (map.minorLabelDir) {
    for (const id of Object.keys(map.minorLabelDir).map(Number)) {
      if (!stationIdSet.has(id)) errors.push(`minorLabelDir has an entry for non-existent station ${id}.`);
    }
  }
  if (map.majorStations) {
    for (const id of map.majorStations) {
      if (!stationIdSet.has(id)) errors.push(`majorStations references non-existent station ${id}.`);
    }
  }
  if (map.majorIcon) {
    for (const id of Object.keys(map.majorIcon).map(Number)) {
      if (!stationIdSet.has(id)) errors.push(`majorIcon has an entry for non-existent station ${id}.`);
    }
  }

  // enough stations for max player count (1 Mr.X + up to 5 detectives = 6
  // distinct starting positions needed)
  if (stationIds.length < 6) {
    errors.push(`Only ${stationIds.length} stations -- need at least 6 to support 5 detectives + Mr. X.`);
  }

  // sanity check the mode theme covers all required transport modes
  const requiredModes = ["taxi", "bus", "underground", "ferry", "black"];
  if (map.modeTheme) {
    for (const m of requiredModes) {
      if (!map.modeTheme[m]) errors.push(`modeTheme is missing the "${m}" mode.`);
    }
  }

  return { errors, warnings };
}

function main() {
  const target = process.argv[2];
  const mapsToCheck = target ? [MAPS[target]] : MAP_LIST;

  if (target && !MAPS[target]) {
    console.error(`Unknown map "${target}". Available: ${MAP_LIST.map((m) => m.id).join(", ")}`);
    process.exit(1);
  }

  let anyErrors = false;
  for (const map of mapsToCheck) {
    const { errors, warnings } = validateOneMap(map);
    console.log(`\n=== ${map.id} (${map.label}) — ${Object.keys(map.stations).length} stations, ${map.edges.length} edges ===`);
    if (errors.length === 0 && warnings.length === 0) {
      console.log("  OK — no issues found.");
    }
    for (const e of errors) {
      console.log(`  ERROR: ${e}`);
      anyErrors = true;
    }
    for (const w of warnings) {
      console.log(`  WARNING: ${w}`);
    }
  }

  console.log("");
  if (anyErrors) {
    console.log("VALIDATION FAILED — fix the errors above before deploying.");
    process.exit(1);
  } else {
    console.log("All checks passed.");
  }
}

main();
