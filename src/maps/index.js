import { deriveMap } from "./mapSchema.js";
import { bengaluruMap } from "./bengaluru.js";
import { westerosMap } from "./westeros.js";
import { cityOfSendhwaMap } from "./cityOfSendhwa.js";

// Three active maps: Bengaluru (the primary city map), Westeros
// (illustrated fantasy map), and City of Sendhwa (an 86-station map
// built from a real local mental map of the town). The earlier
// grid/highway-spine Sendhwa map (sendhwa.js) has been retired now that
// City of Sendhwa fully replaces it -- per explicit instruction, treat
// City of Sendhwa as the new map and drop the old WIP one entirely
// rather than keep both. Simplified City, Bengaluru — New, and the
// original 100-node Namma Bengaluru maps were retired earlier in the
// "Hidden Trail" rebrand pass; the current bengaluru.js supersedes all
// of them.
const RAW_MAPS = [bengaluruMap, westerosMap, cityOfSendhwaMap];

export const MAPS = Object.fromEntries(
  RAW_MAPS.map((cfg) => [cfg.id, deriveMap(cfg)])
);

export const MAP_LIST = Object.values(MAPS);
