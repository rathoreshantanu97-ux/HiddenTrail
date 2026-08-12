// ---------------------------------------------------------------------------
// MAP: "Westeros" -- a hand-drawn illustrated map (region hulls derived
// from real station clusters, gradients, texture), reskinned with Game of
// Thrones place names. Full mode-name reskin (Foot/Horse/Dragon/Ship) and
// reskinned player names (GoT characters instead of "Detective N").
//
// REVAMPED to global-standard scale/density, following the exact same
// verification methodology used for Bengaluru and City of Sendhwa:
//   - Expanded from 64 to 88 stations, adding 24 real ASOIAF locations
//     across all 9 regions.
//   - RESCALED to close a real on-screen usability gap: the map's own
//     coordinate-space aspect ratio (0.84, portrait) was a poor match for
//     the actual game panel's landscape shape, so GameBoard's fit logic
//     (which only allows up to 10% stretch beyond a map's TRUE ratio, to
//     avoid visibly distorting it) was forced to shrink the map well
//     below the panel's available width -- confirmed via direct
//     comparison against Bengaluru, which fills its panel cleanly at a
//     1.235 ratio. Applied a single anisotropic scale (X x1.214, Y
//     x0.824, about the map's own center) to reach that exact 126x102
//     ratio, WITHOUT moving stations relative to each other in any way
//     that broke spacing -- then fully re-verified from scratch after
//     the transform: zero spacing violations, zero label collisions, and
//     every edge re-checked for clearance (the transform did shift which
//     edges needed a manual curve -- 4 new ones appeared, e.g. King's
//     Landing<->Storm's End went from clean to 0.14 units of clearance,
//     fixed the same way as every other curve on this map: search for
//     the offset that maximizes worst-case clearance, not eyeballed).
//   - Mode coverage: Foot 97.7%, Horse 28.4%, Dragon 9.1% (majors-only),
//     matching the Sendhwa/Bengaluru calibration target.
//   - Zero dead-end stations, full connectivity verified via BFS.
//   - Full decorations layer (28 landmark icons).
// ---------------------------------------------------------------------------

const MET2_VIEW_W = 124;
const MET2_VIEW_H = 102;

const STATIONS_MET2 = {
  1:[31.2,6], // Winterfell
  2:[58,16.46], // Castle Black
  3:[15.34,12.93], // The Wall
  4:[103.32,18.32], // Eastwatch
  5:[83.26,7.33], // Hardhome
  6:[29.76,15.08], // Deepwood Motte
  7:[44.09,8.05], // Bear Island
  8:[86.01,17.84], // Karhold
  9:[107.57,10.72], // Last Hearth
  10:[72.47,11.07], // Widow's Watch
  11:[42.54,16.1], // White Harbor
  12:[74.95,19.9], // Torrhen's Square
  13:[45.73,36.85], // Riverrun
  14:[88.36,31.53], // Harrenhal
  15:[64.95,31.94], // The Twins
  16:[54.57,28.11], // Stoney Sept
  17:[23.96,37.13], // Darry
  18:[77.57,38.1], // Raventree Hall
  19:[43.46,28.25], // Seagard
  20:[59.56,39.13], // Golden Tooth
  21:[89.85,39.41], // Maidenpool
  22:[34.8,39.79], // Duskendale
  23:[104.15,28.33], // The Eyrie
  24:[106.15,39.76], // Gulltown
  25:[94.11,24.28], // The Bloody Gate
  26:[111.19,33.64], // Runestone
  27:[98.08,34.44], // Sisterton
  28:[112.31,23.86], // Ironoaks
  29:[15.3,41.54], // Casterly Rock
  30:[15.4,50.01], // Lannisport
  31:[28.51,53.88], // Crakehall
  32:[26.01,46.67], // Silverhill
  33:[8.21,57.1], // Kayce
  34:[37.63,48.76], // Sarsfield
  35:[73.61,57.11], // King's Landing
  36:[63.18,46.1], // Rosby
  37:[52.09,58.13], // Stokeworth
  38:[74.58,47.21], // Crackclaw Point
  39:[51.55,45.88], // Sharp Point
  40:[61.78,54.83], // Dragonstone
  41:[42.79,64.48], // Highgarden
  42:[44.48,75.79], // Oldtown
  43:[53.84,67.08], // Horn Hill
  44:[15.84,65.3], // Ashford
  45:[20.55,58.89], // Bitterbridge
  46:[23.78,76.82], // Longtable
  47:[56.99,74.3], // Honeyholt
  48:[27.75,66.08], // Vaith
  49:[33.5,79.34], // Yronwood
  50:[87.67,62.11], // Storm's End
  51:[75.36,65.06], // Bronzegate
  52:[82.01,71.85], // Griffin's Roost
  53:[70.71,72.66], // Nightsong
  54:[65.86,61.83], // Rainwood
  55:[64.82,95.96], // Sunspear
  56:[51.11,92.99], // Starfall
  57:[55.91,84.41], // Godsgrace
  58:[75.69,85.85], // Salt Shore
  59:[39.62,86.29], // Skyreach
  60:[78.77,94.77], // Blackmont
  61:[103.82,67.95], // Braavos
  62:[112.92,49.15], // Pentos
  63:[100.29,61.14], // Volantis
  64:[115.56,77.68], // Myr
  65:[59.74,6.05], // Moat Cailin
  66:[94.62,11.42], // Barrowton
  67:[21.11,6.28], // Greywater Watch
  68:[30.49,29.86], // Acorn Hall
  69:[76.26,27.82], // Fairmarket
  70:[64.04,25.45], // Pinkmaiden
  71:[117.13,28.99], // Heart's Home
  72:[97.75,40.07], // Redfort
  73:[36.77,54.18], // Ashemark
  74:[8.6,45.83], // Tarbeck Hall
  75:[6,51.66], // Deep Den
  76:[47.14,51.95], // Rook's Rest
  77:[80.1,52.55], // Claw Isle
  78:[32.22,59.03], // The Arbor
  79:[35.69,71.19], // Old Oak
  80:[15.34,72.85], // Cider Hall
  81:[79.06,59.2], // Blackhaven
  82:[63.65,67.86], // Rain House
  83:[89.71,68.04], // Greenstone
  84:[65.17,88.4], // Ghost Hill
  85:[46.41,81.59], // Hellholt
  86:[67.25,82.14], // Spottswood
  87:[115.36,60.81], // Lys
  88:[116.49,69.01], // Tyrosh
};

const STATION_NAMES_MET2 = {
  1:"Winterfell",
  2:"Castle Black",
  3:"The Wall",
  4:"Eastwatch",
  5:"Hardhome",
  6:"Deepwood Motte",
  7:"Bear Island",
  8:"Karhold",
  9:"Last Hearth",
  10:"Widow's Watch",
  11:"White Harbor",
  12:"Torrhen's Square",
  13:"Riverrun",
  14:"Harrenhal",
  15:"The Twins",
  16:"Stoney Sept",
  17:"Darry",
  18:"Raventree Hall",
  19:"Seagard",
  20:"Golden Tooth",
  21:"Maidenpool",
  22:"Duskendale",
  23:"The Eyrie",
  24:"Gulltown",
  25:"The Bloody Gate",
  26:"Runestone",
  27:"Sisterton",
  28:"Ironoaks",
  29:"Casterly Rock",
  30:"Lannisport",
  31:"Crakehall",
  32:"Silverhill",
  33:"Kayce",
  34:"Sarsfield",
  35:"King's Landing",
  36:"Rosby",
  37:"Stokeworth",
  38:"Crackclaw Point",
  39:"Sharp Point",
  40:"Dragonstone",
  41:"Highgarden",
  42:"Oldtown",
  43:"Horn Hill",
  44:"Ashford",
  45:"Bitterbridge",
  46:"Longtable",
  47:"Honeyholt",
  48:"Vaith",
  49:"Yronwood",
  50:"Storm's End",
  51:"Bronzegate",
  52:"Griffin's Roost",
  53:"Nightsong",
  54:"Rainwood",
  55:"Sunspear",
  56:"Starfall",
  57:"Godsgrace",
  58:"Salt Shore",
  59:"Skyreach",
  60:"Blackmont",
  61:"Braavos",
  62:"Pentos",
  63:"Volantis",
  64:"Myr",
  65:"Moat Cailin",
  66:"Barrowton",
  67:"Greywater Watch",
  68:"Acorn Hall",
  69:"Fairmarket",
  70:"Pinkmaiden",
  71:"Heart's Home",
  72:"Redfort",
  73:"Ashemark",
  74:"Tarbeck Hall",
  75:"Deep Den",
  76:"Rook's Rest",
  77:"Claw Isle",
  78:"The Arbor",
  79:"Old Oak",
  80:"Cider Hall",
  81:"Blackhaven",
  82:"Rain House",
  83:"Greenstone",
  84:"Ghost Hill",
  85:"Hellholt",
  86:"Spottswood",
  87:"Lys",
  88:"Tyrosh",
};

// Route logic: Dragon (underground) is a sparse express backbone
// connecting ONLY the 8 major seats. Horse (bus) is deliberately thin.
// Foot (taxi) is the dense local mesh, capped tight enough that several
// stations end up as real chokepoints.
const EDGES_MET2 = [
  [42,55,"underground"],
  [29,42,"underground"],
  [35,42,"underground"],
  [50,61,"underground"],
  [50,55,"underground"],
  [23,35,"underground"],
  [23,50,"underground"],
  [35,61,"underground"],
  [1,23,"underground"],
  [1,29,"underground"],
  [35,50,"underground"],
  [2,10,"bus"],
  [2,11,"bus"],
  [47,57,"bus"],
  [3,6,"bus"],
  [55,56,"bus"],
  [55,60,"bus"],
  [18,38,"bus"],
  [56,57,"bus"],
  [58,60,"bus"],
  [10,12,"bus"],
  [1,7,"bus"],
  [37,41,"bus"],
  [50,51,"bus"],
  [36,40,"bus"],
  [13,19,"bus"],
  [6,11,"bus"],
  [42,47,"bus"],
  [1,6,"taxi"],
  [2,16,"taxi"],
  [2,12,"taxi"],
  [4,9,"taxi"],
  [4,28,"taxi"],
  [5,10,"taxi"],
  [5,8,"taxi"],
  [6,7,"taxi"],
  [7,11,"taxi"],
  [8,12,"taxi"],
  [8,25,"taxi"],
  [10,8,"taxi"],
  [11,19,"taxi"],
  [13,22,"taxi"],
  [13,20,"taxi"],
  [14,27,"taxi"],
  [14,21,"taxi"],
  [15,16,"taxi"],
  [15,20,"taxi"],
  [16,19,"taxi"],
  [16,13,"taxi"],
  [17,29,"taxi"],
  [17,22,"taxi"],
  [18,21,"taxi"],
  [18,14,"taxi"],
  [20,36,"taxi"],
  [20,39,"taxi"],
  [21,27,"taxi"],
  [21,24,"taxi"],
  [22,32,"taxi"],
  [22,34,"taxi"],
  [23,28,"taxi"],
  [23,26,"taxi"],
  [24,26,"taxi"],
  [24,27,"taxi"],
  [25,23,"taxi"],
  [25,14,"taxi"],
  [26,27,"taxi"],
  [26,28,"taxi"],
  [27,23,"taxi"],
  [27,25,"taxi"],
  [28,25,"taxi"],
  [29,30,"taxi"],
  [29,32,"taxi"],
  [30,32,"taxi"],
  [30,33,"taxi"],
  [31,45,"taxi"],
  [31,32,"taxi"],
  [32,34,"taxi"],
  [32,17,"taxi"],
  [33,45,"taxi"],
  [33,44,"taxi"],
  [34,31,"taxi"],
  [34,39,"taxi"],
  [35,54,"taxi"],
  [35,51,"taxi"],
  [36,38,"taxi"],
  [36,39,"taxi"],
  [37,40,"taxi"],
  [37,43,"taxi"],
  [38,35,"taxi"],
  [38,40,"taxi"],
  [39,13,"taxi"],
  [39,40,"taxi"],
  [40,54,"taxi"],
  [40,35,"taxi"],
  [41,43,"taxi"],
  [41,48,"taxi"],
  [42,49,"taxi"],
  [42,43,"taxi"],
  [43,47,"taxi"],
  [43,54,"taxi"],
  [44,45,"taxi"],
  [44,48,"taxi"],
  [45,48,"taxi"],
  [45,30,"taxi"],
  [46,49,"taxi"],
  [46,48,"taxi"],
  [47,53,"taxi"],
  [48,31,"taxi"],
  [49,59,"taxi"],
  [50,52,"taxi"],
  [51,54,"taxi"],
  [51,52,"taxi"],
  [52,53,"taxi"],
  [53,51,"taxi"],
  [53,54,"taxi"],
  [54,37,"taxi"],
  [56,59,"taxi"],
  [57,59,"taxi"],
  [57,42,"taxi"],
  [59,42,"taxi"],
  [61,63,"taxi"],
  [1,3,"taxi"],
  [8,9,"taxi"],
  [57,58,"taxi"],
  [63,64,"taxi"],
  [65,10,"taxi"],
  [65,2,"taxi"],
  [65,7,"taxi"],
  [66,8,"taxi"],
  [66,5,"taxi"],
  [66,9,"taxi"],
  [67,1,"taxi"],
  [67,3,"taxi"],
  [67,6,"taxi"],
  [68,17,"taxi"],
  [68,19,"taxi"],
  [68,22,"taxi"],
  [69,12,"taxi"],
  [69,70,"taxi"],
  [69,15,"taxi"],
  [70,15,"taxi"],
  [70,16,"taxi"],
  [70,12,"taxi"],
  [71,28,"taxi"],
  [71,26,"taxi"],
  [71,23,"taxi"],
  [72,21,"taxi"],
  [72,27,"taxi"],
  [72,24,"taxi"],
  [73,34,"taxi"],
  [73,31,"taxi"],
  [73,78,"taxi"],
  [74,75,"taxi"],
  [74,30,"taxi"],
  [74,29,"taxi"],
  [75,33,"taxi"],
  [75,30,"taxi"],
  [75,45,"taxi"],
  [76,39,"taxi"],
  [76,37,"taxi"],
  [76,34,"taxi"],
  [77,35,"taxi"],
  [77,38,"taxi"],
  [77,81,"taxi"],
  [78,31,"taxi"],
  [78,48,"taxi"],
  [78,45,"taxi"],
  [79,48,"taxi"],
  [79,42,"taxi"],
  [79,41,"taxi"],
  [80,46,"taxi"],
  [80,44,"taxi"],
  [80,48,"taxi"],
  [81,35,"taxi"],
  [81,51,"taxi"],
  [81,50,"taxi"],
  [82,54,"taxi"],
  [82,43,"taxi"],
  [82,53,"taxi"],
  [83,50,"taxi"],
  [83,52,"taxi"],
  [83,51,"taxi"],
  [84,86,"taxi"],
  [84,57,"taxi"],
  [84,55,"taxi"],
  [85,42,"taxi"],
  [85,59,"taxi"],
  [85,57,"taxi"],
  [86,58,"taxi"],
  [86,57,"taxi"],
  [86,53,"taxi"],
  [87,88,"taxi"],
  [87,63,"taxi"],
  [87,61,"taxi"],
  [88,61,"taxi"],
  [88,64,"taxi"],
  [88,63,"taxi"],
];

// FERRY_EDGES_MET2 -- the "Ship" mode (Mr.X-only secret route, always
// costs a black ticket). A deliberate CHAIN (not a triangle): Gulltown
// <-> Pentos <-> Myr, Pentos as the shared junction.
const FERRY_EDGES_MET2 = [
  [24,62], // Gulltown <-> Pentos
  [62,64], // Pentos <-> Myr
];

const MAJOR_STATIONS_MET2 = new Set([1,23,29,35,42,50,55,61]);

const MAJOR_LABEL_DIR_MET2 = {
  1: "S",   // Winterfell
  23: "N",   // The Eyrie
  29: "N",   // Casterly Rock
  35: "SW",   // King's Landing
  42: "SW",   // Oldtown
  50: "N",   // Storm's End
  55: "S",   // Sunspear
  61: "SE",   // Braavos
};

const MINOR_LABEL_DIR_MET2 = {
  2: "N",
  3: "NW",
  4: "NE",
  5: "N",
  6: "NW",
  7: "N",
  8: "NE",
  9: "NE",
  10: "N",
  11: "NW",
  12: "N",
  13: "NW",
  14: "NE",
  15: "N",
  16: "N",
  17: "N",
  18: "NE",
  19: "NW",
  20: "N",
  21: "S",
  22: "NW",
  24: "E",
  25: "NE",
  26: "NE",
  27: "NE",
  28: "NE",
  30: "S",
  31: "W",
  32: "W",
  33: "W",
  34: "W",
  36: "NE",
  37: "SW",
  38: "E",
  39: "W",
  40: "S",
  41: "SW",
  43: "S",
  44: "SW",
  45: "W",
  46: "SW",
  47: "S",
  48: "SW",
  49: "SW",
  51: "SE",
  52: "SE",
  53: "S",
  54: "S",
  56: "S",
  57: "S",
  58: "S",
  59: "S",
  60: "S",
  62: "E",
  63: "SE",
  64: "SE",
  65: "N",
  66: "N",
  67: "N",
  68: "N",
  69: "N",
  70: "N",
  71: "W",
  72: "N",
  73: "N",
  74: "N",
  75: "N",
  76: "N",
  77: "N",
  78: "N",
  79: "N",
  80: "N",
  81: "N",
  82: "N",
  83: "N",
  84: "N",
  85: "N",
  86: "N",
  87: "N",
  88: "N",
};

// MANUAL_CURVE_OFFSETS_MET2 -- every offset computed by searching for the
// value that maximizes the worst-case clearance from every OTHER
// station, checked against the actual rendered quadratic-Bezier curve
// (same math as curveGeometry.js), not eyeballed. Recomputed fresh after
// the aspect-ratio rescale (see file-level comment above) since an
// anisotropic transform changes which edges pass close to a third
// station.
const MANUAL_CURVE_OFFSETS_MET2 = {
  "1-23": 10.65,
  "1-29": 11.93,
  "23-35": 10.42,
  "23-50": -7.39,
  "29-42": 2.7,
  "35-42": 12.5,
  "35-61": 15.75,
  "42-55": -9.32,
  "50-55": 4.78,
  "63-64": -5.46,
  "35-50": -7.06,
  "21-24": 8.05,
  "42-57": 6.04,
  "57-58": 0.28,
};

// Region hulls: convex hulls of each region's actual station cluster,
// padded outward. Rescaled in lockstep with every station (same
// transform, so they still correctly wrap their region's stations).
const MET2_REGION_HULLS = {
  north: "M 8.05 12.96 L 24.20 4.56 L 90.02 5.38 L 114.79 10.32 L 110.42 19.30 L 80.30 23.25 L 22.50 15.59 Z",
  riverlands: "M 95.60 30.99 L 96.94 40.55 L 28.09 41.62 L 16.79 37.83 L 37.44 25.48 L 53.47 23.25 Z",
  vale: "M 88.92 20.78 L 116.61 19.88 L 117.58 35.94 L 107.14 44.66 L 92.32 37.42 Z",
  westerlands: "M 2.22 59.98 L 11.82 37.25 L 44.84 48.04 L 34.04 57.10 Z",
  crownlands: "M 46.91 61.55 L 45.45 43.18 L 63.42 41.12 L 81.15 45.08 L 79.09 60.31 Z",
  reach: "M 64.03 75.55 L 33.19 84.28 L 18.49 80.16 L 9.02 63.44 L 15.94 55.04 L 60.87 65.91 Z",
  stormlands: "M 60.02 58.91 L 93.78 59.41 L 86.49 75.71 L 66.46 76.70 Z",
  dorne: "M 32.58 85.02 L 52.13 80.16 L 82.37 83.95 L 85.52 96.55 L 67.79 100.50 L 44.48 94.98 Z",
  essos: "M 93.90 58.83 L 114.42 44.34 L 118.07 82.30 L 99.49 71.92 Z",
};

// Game of Thrones theme reskins the transport *names* only — same colors,
// same underlying mechanics.
const MODE_GOT = {
  taxi: { color: "#a0740d", label: "Foot", short: "F" },
  bus: { color: "#109347", label: "Horse", short: "H" },
  underground: { color: "#c12115", label: "Dragon", short: "D" },
  ferry: { color: "#2f8fbf", label: "Ship", short: "S" },
  black: { color: "#2b2b2b", label: "Black", short: "X" },
};

// DECORATIONS_MET2 -- landmark icons across all 9 regions, rescaled in
// lockstep with every station.
const DECORATIONS_MET2 = [
  { id: "got_winterfell_keep", type: "icon", icon: "fort", x: 28.04, y: 6.99, size: 6, color: "#5c6670" },
  { id: "got_kings_landing_keep", type: "icon", icon: "cityhall", x: 76.77, y: 55.96, size: 6, color: "#b08a3e" },
  { id: "got_casterly_rock_mine", type: "icon", icon: "mine", x: 12.39, y: 42.86, size: 6, color: "#8a7a3e" },
  { id: "got_eyrie_peak", type: "icon", icon: "mountain", x: 107.06, y: 27.02, size: 7, color: "#8a97a3" },
  { id: "got_storms_end_keep", type: "icon", icon: "fort", x: 90.59, y: 63.43, size: 6, color: "#5c6670" },
  { id: "got_sunspear_palace", type: "icon", icon: "flag", x: 61.91, y: 97.12, size: 5, color: "#c9622a" },
  { id: "got_oldtown_citadel", type: "icon", icon: "college", x: 41.32, y: 74.63, size: 6, color: "#4a5a7a" },
  { id: "got_braavos_titan", type: "icon", icon: "lighthouse", x: 106.74, y: 66.63, size: 6, color: "#4a5a5a" },
  { id: "got_highgarden", type: "icon", icon: "garden", x: 39.64, y: 65.63, size: 7, color: "#7ba95c" },
  { id: "got_moat_cailin_ruin", type: "icon", icon: "fort", x: 59.74, y: 4.24, size: 4, color: "#6b7560", opacity: 0.75 },
  { id: "got_the_twins_bridge", type: "icon", icon: "bridge", x: 64.95, y: 30.13, size: 5, color: "#5c5648" },
  { id: "got_gods_eye", type: "icon", icon: "lake", x: 93.83, y: 29.47, size: 8, color: "#6a9dc0", opacity: 0.9 },
  { id: "got_white_harbor_port", type: "icon", icon: "port", x: 45.45, y: 17.26, size: 5, color: "#3a6b8a" },
  { id: "got_gulltown_port", type: "icon", icon: "port", x: 108.83, y: 40.91, size: 5, color: "#3a6b8a" },
  { id: "got_volantis_temple", type: "icon", icon: "temple", x: 102.96, y: 62.29, size: 5, color: "#a5222a" },
  { id: "got_pentos_market", type: "icon", icon: "market", x: 110.25, y: 50.31, size: 5, color: "#8a5a2a" },
  { id: "got_myr_shop", type: "icon", icon: "shop", x: 118.24, y: 76.53, size: 4, color: "#7a4a8a" },
  { id: "got_lys_gem", type: "icon", icon: "gem", x: 118.03, y: 59.83, size: 4, color: "#c93a8a" },
  { id: "got_tyrosh_anchor", type: "icon", icon: "anchor", x: 119.16, y: 70, size: 4, color: "#2a5a8a" },
  { id: "got_wolfswood", type: "icon", icon: "forest", x: 22.62, y: 21.36, size: 8, color: "#3f6b4a", opacity: 0.75 },
  { id: "got_kingswood", type: "icon", icon: "forest", x: 57.84, y: 51.01, size: 6, color: "#3f6b4a", opacity: 0.75 },
  { id: "got_rainwood_forest", type: "icon", icon: "forest", x: 71.19, y: 61.71, size: 6, color: "#3f6b4a", opacity: 0.75 },
  { id: "got_mountains_of_the_moon", type: "icon", icon: "mountain", x: 100.34, y: 26.3, size: 6, color: "#8a97a3", opacity: 0.7 },
  { id: "got_red_mountains", type: "icon", icon: "mountain", x: 51.77, y: 77.36, size: 6, color: "#a5622a", opacity: 0.6 },
  { id: "got_the_wall_ice", type: "icon", icon: "cliff", x: 55.41, y: 4.23, size: 9, color: "#bcd9e8", opacity: 0.85, rotation: 0 },
  { id: "got_narrow_sea_1", type: "icon", icon: "water", x: 95.48, y: 46.89, size: 9, color: "#5f8fae", opacity: 0.6 },
  { id: "got_narrow_sea_2", type: "icon", icon: "water", x: 110.05, y: 18.06, size: 7, color: "#5f8fae", opacity: 0.6 },
  { id: "got_blackwater_bay", type: "icon", icon: "water", x: 83.34, y: 57.59, size: 6, color: "#5f8fae", opacity: 0.6 },
];

// Character names used in place of "Detective N" / "Mr. X". Fixed order:
// first 5 are used for up to 5 detectives; rest are reserve names.
const GOT_DETECTIVE_NAMES = [
  "Jon Snow", "Bran Stark", "Jaime Lannister", "Daenerys Targaryen", "Arya Stark",
  "The Red Woman", "Sansa Stark", "Tyrion Lannister", "Samwell Tarly", "Cersei Lannister",
  "Petyr Baelish", "Margaery Tyrell", "Ramsay Bolton", "Missandei", "Joffrey Baratheon",
  "Ned Stark", "Robb Stark", "Ygritte",
];
const GOT_MRX_NAME = "The Night King";

export const westerosMap = {
  id: "westeros",
  label: "Westeros",
  subtitle: "Game of Thrones · Night King vs. the realm",
  stations: STATIONS_MET2,
  edges: EDGES_MET2,
  ferryEdges: FERRY_EDGES_MET2,
  names: STATION_NAMES_MET2,
  majorStations: MAJOR_STATIONS_MET2,
  majorLabelDir: MAJOR_LABEL_DIR_MET2,
  minorLabelDir: MINOR_LABEL_DIR_MET2,
  modeTheme: MODE_GOT,
  manualCurveOffsets: MANUAL_CURVE_OFFSETS_MET2,
  viewW: MET2_VIEW_W,
  viewH: MET2_VIEW_H,
  background: {
    kind: "regions",
    regionHulls: MET2_REGION_HULLS,
    theme: "westeros", // selects the hand-tuned region-fill/label art in mapBackgrounds.js
  },
  decorations: DECORATIONS_MET2,
  characterNames: GOT_DETECTIVE_NAMES,
  mrxName: GOT_MRX_NAME,
};
