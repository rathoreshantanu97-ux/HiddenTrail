import { deriveMap } from "./mapSchema.js";
import { bengaluruMap } from "./bengaluru.js";
import { sendhwaMap } from "./sendhwa.js";
import { westerosMap } from "./westeros.js";

// Only three maps remain active: Bengaluru (the primary city map),
// Westeros (illustrated fantasy map), and Sendhwa (labeled "WIP" in the
// picker — still mid-rebuild, see sendhwa.js for open items). The earlier
// Simplified City, Bengaluru — New, and the original 100-node Namma
// Bengaluru maps were retired in the "Hidden Trail" rebrand pass; the
// current bengaluru.js supersedes all of them.
const RAW_MAPS = [bengaluruMap, sendhwaMap, westerosMap];

export const MAPS = Object.fromEntries(
  RAW_MAPS.map((cfg) => [cfg.id, deriveMap(cfg)])
);

export const MAP_LIST = Object.values(MAPS);
