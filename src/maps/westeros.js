// ---------------------------------------------------------------------------
// MAP: "Westeros" -- a hand-drawn illustrated map (region hulls derived
// from real station clusters, gradients, texture), reskinned with Game of
// Thrones place names. Full mode-name reskin (Foot/Horse/Dragon/Ship) and
// reskinned player names (GoT characters instead of "Detective N").
//
// REVAMPED to global-standard scale/density, following the exact same
// verification methodology used for Bengaluru and City of Sendhwa:
//   - Expanded from 64 to 88 stations (matching Bengaluru's 89 and
//     Sendhwa's 86), adding 24 real ASOIAF locations across all 9
//     regions, each placed via rejection sampling inside its region's
//     own hull with a required minimum clearance from every other
//     station (verified: zero spacing violations across all 88).
//   - Every new station given real connections (mostly Foot/taxi, a
//     modest amount of Horse/bus), each edge's straight-line clearance
//     from every uninvolved third station checked numerically before
//     being kept (matching Sendhwa's own edge-clearance methodology).
//   - Mode coverage verified in proportion after the expansion: Foot
//     97.7%, Horse 28.4% (matches the Sendhwa/Bengaluru calibration
//     target of ~30%, and this map's own long-standing design rule that
//     Horse stay "deliberately thin"), Dragon 9.1% (still majors-only).
//   - Zero dead-end stations, full connectivity verified via BFS across
//     the whole graph (taxi+bus+underground+ferry).
//   - Added a full decorations layer (28 landmark icons -- great seats,
//     the Free Cities, the Wall, God's Eye, the Twins' bridge, Wolfswood/
//     Kingswood/Rainwood, the Narrow Sea) -- previously this map had
//     ZERO decorations, a real gap next to Bengaluru's 18 and Sendhwa's
//     45.
// ---------------------------------------------------------------------------

const MET2_VIEW_W = 102;
const MET2_VIEW_H = 121;

const STATIONS_MET2 = {
  1:[25.06,5.35], // Winterfell
  2:[47.13,18.05], // Castle Black
  3:[12,13.77], // The Wall
  4:[84.46,20.31], // Eastwatch
  5:[67.94,6.96], // Hardhome
  6:[23.88,16.38], // Deepwood Motte
  7:[35.68,7.84], // Bear Island
  8:[70.2,19.73], // Karhold
  9:[87.96,11.08], // Last Hearth
  10:[59.05,11.51], // Widow's Watch
  11:[34.4,17.62], // White Harbor
  12:[61.09,22.23], // Torrhen's Square
  13:[37.03,42.81], // Riverrun
  14:[72.14,36.35], // Harrenhal
  15:[52.86,36.85], // The Twins
  16:[44.31,32.2], // Stoney Sept
  17:[19.1,43.15], // Darry
  18:[63.25,44.33], // Raventree Hall
  19:[35.16,32.37], // Seagard
  20:[48.42,45.58], // Golden Tooth
  21:[73.36,45.92], // Maidenpool
  22:[28.03,46.38], // Duskendale
  23:[85.14,32.47], // The Eyrie
  24:[86.79,46.34], // Gulltown
  25:[76.87,27.55], // The Bloody Gate
  26:[90.94,38.91], // Runestone
  27:[80.14,39.89], // Sisterton
  28:[91.86,27.04], // Ironoaks
  29:[11.97,48.51], // Casterly Rock
  30:[12.05,58.79], // Lannisport
  31:[22.85,63.49], // Crakehall
  32:[20.79,54.74], // Silverhill
  33:[6.13,67.4], // Kayce
  34:[30.36,57.27], // Sarsfield
  35:[59.99,67.41], // King's Landing
  36:[51.4,54.04], // Rosby
  37:[42.27,68.65], // Stokeworth
  38:[60.79,55.39], // Crackclaw Point
  39:[41.82,53.77], // Sharp Point
  40:[50.25,64.64], // Dragonstone
  41:[34.61,76.36], // Highgarden
  42:[36,90.09], // Oldtown
  43:[43.71,79.52], // Horn Hill
  44:[12.41,77.36], // Ashford
  45:[16.29,69.57], // Bitterbridge
  46:[18.95,91.34], // Longtable
  47:[46.3,88.29], // Honeyholt
  48:[22.22,78.3], // Vaith
  49:[26.96,94.4], // Yronwood
  50:[71.57,73.48], // Storm's End
  51:[61.43,77.06], // Bronzegate
  52:[66.91,85.31], // Griffin's Roost
  53:[57.6,86.29], // Nightsong
  54:[53.61,73.14], // Rainwood
  55:[52.75,114.59], // Sunspear
  56:[41.46,110.98], // Starfall
  57:[45.41,100.56], // Godsgrace
  58:[61.7,102.31], // Salt Shore
  59:[32,102.84], // Skyreach
  60:[64.24,113.14], // Blackmont
  61:[84.87,80.57], // Braavos
  62:[92.36,57.75], // Pentos
  63:[81.96,72.3], // Volantis
  64:[94.54,92.39], // Myr
  65:[48.57,5.41], // Moat Cailin
  66:[77.29,11.93], // Barrowton
  67:[16.75,5.69], // Greywater Watch
  68:[24.48,34.32], // Acorn Hall
  69:[62.17,31.84], // Fairmarket
  70:[52.11,28.97], // Pinkmaiden
  71:[95.83,33.27], // Heart's Home
  72:[79.87,46.72], // Redfort
  73:[29.65,63.85], // Ashemark
  74:[6.45,53.72], // Tarbeck Hall
  75:[4.31,60.79], // Deep Den
  76:[38.19,61.15], // Rook's Rest
  77:[65.33,61.87], // Claw Isle
  78:[25.9,69.74], // The Arbor
  79:[28.76,84.51], // Old Oak
  80:[12,86.52], // Cider Hall
  81:[64.48,69.95], // Blackhaven
  82:[51.79,80.47], // Rain House
  83:[73.25,80.68], // Greenstone
  84:[53.04,105.41], // Ghost Hill
  85:[37.59,97.14], // Hellholt
  86:[54.75,97.8], // Spottswood
  87:[94.37,71.91], // Lys
  88:[95.3,81.86], // Tyrosh
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
// costs a black ticket, same mechanic as Bengaluru's "Secret Tunnel" and
// City of Sendhwa's ferry chain). A deliberate CHAIN (not a triangle,
// same design rule as Bengaluru's own secret-tunnel chain): Gulltown <->
// Pentos <-> Myr, Pentos as the shared junction. This also replaces two
// edges that used to be modeled as "bus" (Horse) directly crossing the
// Narrow Sea -- a lore/mechanics mismatch (you cannot ride a horse across
// open water) -- with the actually-correct Ship mode.
const FERRY_EDGES_MET2 = [
  [24,62], // Gulltown <-> Pentos
  [62,64], // Pentos <-> Myr
];

const MAJOR_STATIONS_MET2 = new Set([1,23,29,35,42,50,55,61]);

const MAJOR_LABEL_DIR_MET2 = {
1: "S",   // Winterfell
  23: "N",   // The Eyrie
  29: "N",   // Casterly Rock
  35: "N",   // King's Landing
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
  17: "W",
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
  30: "N",
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
  81: "W",
  82: "N",
  83: "N",
  84: "N",
  85: "N",
  86: "N",
  87: "N",
  88: "N",
};

// MANUAL_CURVE_OFFSETS_MET2 -- the Dragon (underground) backbone is this
// map's signature feature, but as single point-to-point lines with no
// automatic curving, 9 of the 11 Dragon routes rendered as straight lines
// running almost directly THROUGH an uninvolved third station -- one
// within 0.05 units of Storm's End. Every offset below was computed by
// searching for the value that maximizes the worst-case clearance from
// every OTHER station, checked against the actual rendered quadratic-
// Bezier curve (same math as curveGeometry.js), not eyeballed.
const MANUAL_CURVE_OFFSETS_MET2 = {
  "1-23": 12.24, // Winterfell <-> The Eyrie
  "1-29": 10.65, // Winterfell <-> Casterly Rock
  "23-35": -14.13, // The Eyrie <-> King's Landing
  "23-50": -4.8, // The Eyrie <-> Storm's End
  "29-42": 3.99, // Casterly Rock <-> Oldtown
  "35-42": 14.29, // King's Landing <-> Oldtown
  "35-61": 9.13, // King's Landing <-> Braavos -- was passing 0.05 units from Storm's End
  "42-55": -14.24, // Oldtown <-> Sunspear
  "50-55": -18.41, // Storm's End <-> Sunspear
  "63-64": -11.85, // Volantis <-> Myr -- Essos overland route, was passing 1.92 units from Braavos
};

// Region hulls: convex hulls of each region's actual station cluster,
// padded outward -- always correctly wrap their stations (re-verified
// after the 24 new stations were added: every new station falls inside
// its own region's hull, confirmed via point-in-polygon).
const MET2_REGION_HULLS = {
  north: "M 6.0 13.8 L 19.3 3.6 L 73.5 4.6 L 93.9 10.6 L 90.3 21.5 L 65.5 26.3 L 17.9 17.0 Z",
  riverlands: "M 78.1 35.7 L 79.2 47.3 L 22.5 48.6 L 13.2 44.0 L 30.2 29.0 L 43.4 26.3 Z",
  vale: "M 72.6 23.3 L 95.4 22.2 L 96.2 41.7 L 87.6 52.3 L 75.4 43.5 Z",
  westerlands: "M 1.2 70.9 L 9.1 43.3 L 36.3 56.4 L 27.4 67.4 Z",
  crownlands: "M 38.0 72.8 L 36.8 50.5 L 51.6 48.0 L 66.2 52.8 L 64.5 71.3 Z",
  reach: "M 52.1 89.8 L 26.7 100.4 L 14.6 95.4 L 6.8 75.1 L 12.5 64.9 L 49.5 78.1 Z",
  stormlands: "M 48.8 69.6 L 76.6 70.2 L 70.6 90.0 L 54.1 91.2 Z",
  dorne: "M 26.2 101.3 L 42.3 95.4 L 67.2 100.0 L 69.8 115.3 L 55.2 120.1 L 36.0 113.4 Z",
  essos: "M 76.7 69.5 L 93.6 51.9 L 96.6 98.0 L 81.3 85.4 Z",
};

// Game of Thrones theme reskins the transport *names* only — same colors,
// same underlying mechanics (taxi=dense/local, bus=mid-range,
// underground=long-distance express, ferry=Mr.X-only water crossing).
const MODE_GOT = {
  taxi: { color: "#a0740d", label: "Foot", short: "F" },
  bus: { color: "#109347", label: "Horse", short: "H" },
  underground: { color: "#c12115", label: "Dragon", short: "D" },
  ferry: { color: "#2f8fbf", label: "Ship", short: "S" },
  black: { color: "#2b2b2b", label: "Black", short: "X" },
};

// DECORATIONS_MET2 -- landmark icons across all 9 regions: the 8 great
// seats plus Highgarden, the Free Cities of Essos (each with a
// flavor-appropriate landmark -- Volantis's Red Temple, Pentos's market,
// Myr's famed crafts, Lys's gem trade, Tyrosh's pirate-anchor), Moat
// Cailin's ruin, the Twins' bridge, God's Eye lake, two major ports, the
// great forests (Wolfswood, Kingswood, Rainwood), two mountain ranges,
// the Wall itself, and open water across the Narrow Sea and Blackwater
// Bay. Zero decorations existed on this map before this pass.
const DECORATIONS_MET2 = [
{ id: "got_winterfell_keep", type: "icon", icon: "fort", x: 22.46, y: 6.55, size: 6, color: "#5c6670" },
  { id: "got_kings_landing_keep", type: "icon", icon: "cityhall", x: 62.59, y: 66.01, size: 6, color: "#b08a3e" },
  { id: "got_casterly_rock_mine", type: "icon", icon: "mine", x: 9.57, y: 50.11, size: 6, color: "#8a7a3e" },
  { id: "got_eyrie_peak", type: "icon", icon: "mountain", x: 87.54, y: 30.87, size: 7, color: "#8a97a3" },
  { id: "got_storms_end_keep", type: "icon", icon: "fort", x: 73.97, y: 75.08, size: 6, color: "#5c6670" },
  { id: "got_sunspear_palace", type: "icon", icon: "flag", x: 50.35, y: 115.99, size: 5, color: "#c9622a" },
  { id: "got_oldtown_citadel", type: "icon", icon: "college", x: 33.4, y: 88.69, size: 6, color: "#4a5a7a" },
  { id: "got_braavos_titan", type: "icon", icon: "lighthouse", x: 87.27, y: 78.97, size: 6, color: "#4a5a5a" },
  { id: "got_highgarden", type: "icon", icon: "garden", x: 32.01, y: 77.76, size: 7, color: "#7ba95c" },
  { id: "got_moat_cailin_ruin", type: "icon", icon: "fort", x: 48.57, y: 3.21, size: 4, color: "#6b7560", opacity: 0.75 },
  { id: "got_the_twins_bridge", type: "icon", icon: "bridge", x: 52.86, y: 34.65, size: 5, color: "#5c5648" },
  { id: "got_gods_eye", type: "icon", icon: "lake", x: 76.64, y: 33.85, size: 8, color: "#6a9dc0", opacity: 0.9 },
  { id: "got_white_harbor_port", type: "icon", icon: "port", x: 36.8, y: 19.02, size: 5, color: "#3a6b8a" },
  { id: "got_gulltown_port", type: "icon", icon: "port", x: 88.99, y: 47.74, size: 5, color: "#3a6b8a" },
  { id: "got_volantis_temple", type: "icon", icon: "temple", x: 84.16, y: 73.7, size: 5, color: "#a5222a" },
  { id: "got_pentos_market", type: "icon", icon: "market", x: 90.16, y: 59.15, size: 5, color: "#8a5a2a" },
  { id: "got_myr_shop", type: "icon", icon: "shop", x: 96.74, y: 90.99, size: 4, color: "#7a4a8a" },
  { id: "got_lys_gem", type: "icon", icon: "gem", x: 96.57, y: 70.71, size: 4, color: "#c93a8a" },
  { id: "got_tyrosh_anchor", type: "icon", icon: "anchor", x: 97.5, y: 83.06, size: 4, color: "#2a5a8a" },
  { id: "got_wolfswood", type: "icon", icon: "forest", x: 18, y: 24, size: 8, color: "#3f6b4a", opacity: 0.75 },
  { id: "got_kingswood", type: "icon", icon: "forest", x: 47, y: 60, size: 6, color: "#3f6b4a", opacity: 0.75 },
  { id: "got_rainwood_forest", type: "icon", icon: "forest", x: 58, y: 73, size: 6, color: "#3f6b4a", opacity: 0.75 },
  { id: "got_mountains_of_the_moon", type: "icon", icon: "mountain", x: 82, y: 30, size: 6, color: "#8a97a3", opacity: 0.7 },
  { id: "got_red_mountains", type: "icon", icon: "mountain", x: 42, y: 92, size: 6, color: "#a5622a", opacity: 0.6 },
  { id: "got_the_wall_ice", type: "icon", icon: "cliff", x: 45, y: 3.2, size: 9, color: "#bcd9e8", opacity: 0.85, rotation: 0 },
  { id: "got_narrow_sea_1", type: "icon", icon: "water", x: 78, y: 55, size: 9, color: "#5f8fae", opacity: 0.6 },
  { id: "got_narrow_sea_2", type: "icon", icon: "water", x: 90, y: 20, size: 7, color: "#5f8fae", opacity: 0.6 },
  { id: "got_blackwater_bay", type: "icon", icon: "water", x: 68, y: 68, size: 6, color: "#5f8fae", opacity: 0.6 },
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
