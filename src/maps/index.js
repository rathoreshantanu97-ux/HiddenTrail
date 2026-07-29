import { deriveMap } from "./mapSchema.js";
import { cityMap } from "./city.js";
import { bengaluruMap } from "./bengaluru.js";
import { westerosMap } from "./westeros.js";

// ---------------------------------------------------------------------------
// TO ADD A NEW MAP:
//   1. Create src/maps/yourMap.js (see mapSchema.js for the required shape;
//      city.js is the minimal template, westeros.js the fullest template).
//   2. Import it below and add one line to RAW_MAPS.
// That's it — every screen (setup picker, board renderer, multiplayer sync)
// reads generically from the derived map objects this file exports.
// ---------------------------------------------------------------------------
const RAW_MAPS = [cityMap, bengaluruMap, westerosMap];

export const MAPS = Object.fromEntries(
  RAW_MAPS.map((cfg) => [cfg.id, deriveMap(cfg)])
);

export const MAP_LIST = Object.values(MAPS);
