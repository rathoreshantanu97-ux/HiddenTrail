import { deriveMap } from "./mapSchema.js";
import { cityMap } from "./city.js";
import { bengaluruMap } from "./bengaluru.js";
import { bengaluruNewMap } from "./bengaluruNew.js";
import { nammaBengaluruMap } from "./nammaBengaluru.js";
import { westerosMap } from "./westeros.js";

// ---------------------------------------------------------------------------
// TO ADD A NEW MAP:
//   1. Create src/maps/yourMap.js (see mapSchema.js for the required shape;
//      city.js is the minimal template, westeros.js the fullest template).
//   2. Import it below and add one line to RAW_MAPS.
// That's it — every screen (setup picker, board renderer, multiplayer sync)
// reads generically from the derived map objects this file exports.
//
// "bengaluru-new" is a from-scratch 100-station redesign, kept alongside
// the original "bengaluru" map per explicit instruction -- both are
// active so they can be compared/verified before deciding whether to
// remove the original. "namma-bengaluru" is a further redesign built
// directly from a detailed, hand-authored 100-node schematic
// specification, kept alongside both earlier maps for the same reason.
// ---------------------------------------------------------------------------
const RAW_MAPS = [cityMap, bengaluruMap, bengaluruNewMap, nammaBengaluruMap, westerosMap];

export const MAPS = Object.fromEntries(
  RAW_MAPS.map((cfg) => [cfg.id, deriveMap(cfg)])
);

export const MAP_LIST = Object.values(MAPS);
