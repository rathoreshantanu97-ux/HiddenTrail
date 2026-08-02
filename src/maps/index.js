import { deriveMap } from "./mapSchema.js";
import { cityMap } from "./city.js";
import { bengaluruMap } from "./bengaluru.js";
import { bengaluruNewMap } from "./bengaluruNew.js";
import { nammaBengaluruMap } from "./nammaBengaluru.js";
import { sendhwaMap } from "./sendhwa.js";
import { westerosMap } from "./westeros.js";

const RAW_MAPS = [cityMap, bengaluruMap, bengaluruNewMap, nammaBengaluruMap, sendhwaMap, westerosMap];

export const MAPS = Object.fromEntries(
  RAW_MAPS.map((cfg) => [cfg.id, deriveMap(cfg)])
);

export const MAP_LIST = Object.values(MAPS);
