import { deriveMap } from "./mapSchema.js";
import { bengaluruMap } from "./bengaluru.js";
import { sendhwaMap } from "./sendhwa.js";
import { westerosMap } from "./westeros.js";
import { cityOfSendhwaMap } from "./cityOfSendhwa.js";

// Four active maps: Bengaluru (the primary city map), Westeros
// (illustrated fantasy map), Sendhwa (labeled "WIP" in the picker --
// still mid-rebuild, see sendhwa.js for open items), and City of Sendhwa
// (a fresh, separate 86-station map built from a real local mental map
// of the town -- kept distinct from sendhwa.js's own map rather than
// replacing it, per explicit instruction). The earlier Simplified City,
// Bengaluru — New, and the original 100-node Namma Bengaluru maps were
// retired in the "Hidden Trail" rebrand pass; the current bengaluru.js
// supersedes all of them.
const RAW_MAPS = [bengaluruMap, sendhwaMap, westerosMap, cityOfSendhwaMap];

export const MAPS = Object.fromEntries(
  RAW_MAPS.map((cfg) => [cfg.id, deriveMap(cfg)])
);

export const MAP_LIST = Object.values(MAPS);
