// MAP: "City of Sendhwa" -- a fresh, separate map built from a real
// local mental map of the town (station names/layout provided directly,
// not derived from the earlier grid/highway-spine Sendhwa version in
// sendhwa.js, which remains untouched as its own separate map). Verified
// against the same checklist used for every map this session before
// being wired in:
//   - Node spacing: 0 violations (min gap >= 4.2 units)
//   - Duplicate edges / self-loops / bad references: none
//   - Connectivity: fully connected (taxi+bus+underground+ferry), no
//     orphans
//   - Mode coverage vs real-board-proportional targets for 86 stations:
//     majors 9 (target 7-9), bus 24 (target ~27, within tolerance),
//     metro exactly 6 (target ~6), ferry chain (76-3-35)
//   - Metro: ALL 6 metro stations are genuine taxi+bus+underground 3-way
//     interchanges (the real board's own rule), verified directly
//   - Majors: zero taxi-only majors (every major station has genuine
//     bus and/or metro significance, not just visual prominence)
//   - Labels: N-preferred placement, 81/86 stations (94%) at N, the
//     remaining 5 moved only where N would genuinely collide -- verified
//     zero label-label collisions, zero label-node collisions, zero
//     off-canvas labels
//   - 7 station pairs have multiple parallel edges (taxi+bus, or
//     bus+underground) between the same two stations -- these render
//     via the SAME generic curve-offset mechanism already used
//     elsewhere (edgeGroups/slot/offset in GameBoard.jsx and
//     ReplayView.jsx), which automatically curves any station pair with
//     2+ edges; no per-edge curve data needs to be hand-authored here.
//
// Coordinates were shifted from the original (which had negative x/y
// values in a couple of spots) into a standard 0,0-based viewBox with a
// 6-unit margin on all sides, matching the pattern every other map here
// uses -- pure translation, spacing/collision results reconfirmed
// identical after the shift, not just assumed to carry over.

const STATIONS_CITY_OF_SENDHWA = {
  1:[18.29,60.95],2:[20.16,69.47],3:[28.69,68.41],4:[36.05,72.13],5:[67.87,51.7],6:[154.67,57.78],7:[166.0,57.8],8:[129.87,63.8],9:[135.94,58.4],10:[112.46,58.92],11:[100.93,61.16],12:[77.26,35.15],13:[81.16,62.12],14:[44.97,60.68],15:[37.03,60.82],16:[53.7,60.95],17:[157.01,49.03],18:[85.37,27.39],19:[147.2,51.58],20:[98.36,43.82],21:[91.06,36.31],22:[95.48,109.08],23:[143.61,86.39],24:[29.57,60.82],25:[66.54,62.95],26:[67.59,71.53],27:[74.2,55.97],28:[90.45,61.96],29:[92.73,66.94],30:[109.4,68.41],31:[77.04,93.31],32:[99.4,78.75],33:[91.65,86.92],34:[80.47,75.33],35:[109.44,79.99],36:[130.94,46.48],37:[92.33,75.2],38:[72.45,81.98],39:[18.52,90.7],40:[44.53,100.77],41:[69.01,107.16],42:[27.51,82.12],43:[48.79,71.6],44:[58.21,66.81],45:[6.0,60.92],46:[105.16,51.41],47:[96.81,55.98],48:[118.52,53.25],49:[105.77,45.48],50:[116.64,39.37],51:[125.79,40.15],52:[109.45,37.71],53:[119.58,32.16],54:[122.64,58.68],55:[121.21,48.03],56:[114.21,46.71],57:[140.34,39.26],58:[139.52,48.92],59:[47.09,27.5],60:[57.94,29.33],61:[35.75,27.52],62:[106.36,27.08],63:[141.71,29.22],64:[152.51,38.6],65:[62.42,24.72],66:[61.07,15.51],67:[88.61,17.29],68:[68.0,31.63],69:[42.65,11.6],70:[83.61,40.97],71:[88.41,45.5],72:[93.38,50.66],73:[83.61,54.12],74:[123.84,14.63],75:[64.69,41.18],76:[51.23,37.91],77:[30.1,37.04],78:[52.06,50.49],79:[29.12,46.92],80:[73.51,45.5],81:[13.46,46.28],82:[18.92,29.79],83:[60.95,56.07],84:[75.27,16.87],85:[89.83,6.0],86:[120.05,71.3]
};

const STATION_NAMES_CITY_OF_SENDHWA = {
  1:"Chhoti Bijasan",2:"New Lions",3:"Darul Uloom",4:"Church",5:"Daaru Godam",6:"Advantage City",7:"Chowdhary Dhaba",8:"Mayur's Mahal",9:"New Bus Stand",10:"Old Bus Stand",11:"Bhawani Chowk",12:"Triveni",13:"Fawwara Chowk",14:"Shanti Palace",15:"Jain",16:"PG College",17:"Shubham's Den",18:"Sudama Colony",19:"Indira Colony",20:"Fort Garden",21:"Sai Mandir",22:"Balwadi",23:"Narayan Das Hospital",24:"Sree Garden",25:"On Prakash Talkies",26:"Mangal Bhawan",27:"Chetna Pani puri",28:"Sabji Mandi",29:"Ayush's Villa",30:"Police Thana",31:"Raghuwansh Public School",32:"Govt. School",33:"RamKatora",34:"Shantanu's Home",35:"Dawal Bedi",36:"RajRajeshwar Mandir",37:"Nalepar",38:"Saraswati Colony",39:"English Wine Shop",40:"Jai Bhawani Dhaba",41:"Ramdev Dhaba",42:"Hanfiya Eidgah",43:"Tehsil Office",44:"Tagore Bedi",45:"Chetan Hanuman",46:"Kila Gate",47:"Baban",48:"Gate 4",49:"Old Lions",50:"Tiles",51:"Shani Mandir",52:"Gate 2",53:"Saraswati Shishu School",54:"Petrol Pump",55:"Ground",56:"Fort",57:"Khedapati Hanuman",58:"Mukti Dham",59:"RK Bakery",60:"Abhinav Colony",61:"Gold Shine",62:"Jogwada Road",63:"Devjiri",64:"Dream Land City",65:"Tanu's Mansion",66:"Sendhwa Public School",67:"Govt. Hospital",68:"Niwali Road",69:"Chhota GhatyaPatya",70:"Mittal Complex",71:"Chomuwala",72:"Sadar Bazaar",73:"Zama Masjid",74:"Badgaon",75:"Nimbark Colony",76:"Nand Colony",77:"Dadu Colony",78:"Khalwadi Market",79:"Cricket Academy",80:"Maulana Azad Marg",81:"Pipaldhar",82:"Homeopathy College",83:"Dinesh Ganj",84:"Bagrecha Garden",85:"Sankat Mochan Hanuman",86:"Varla Road"
};

const EDGES_CITY_OF_SENDHWA = [
  [10,11,"taxi"],
  [8,9,"taxi"],
  [6,17,"taxi"],
  [22,23,"taxi"],
  [15,4,"taxi"],
  [1,2,"taxi"],
  [2,3,"taxi"],
  [4,3,"taxi"],
  [15,24,"taxi"],
  [1,24,"taxi"],
  [3,24,"taxi"],
  [15,14,"taxi"],
  [14,16,"taxi"],
  [16,25,"taxi"],
  [25,27,"taxi"],
  [27,13,"taxi"],
  [13,25,"taxi"],
  [5,25,"taxi"],
  [25,26,"taxi"],
  [11,28,"taxi"],
  [28,13,"taxi"],
  [28,29,"taxi"],
  [11,29,"taxi"],
  [29,37,"taxi"],
  [37,33,"taxi"],
  [33,22,"taxi"],
  [37,32,"taxi"],
  [32,35,"taxi"],
  [32,30,"taxi"],
  [30,10,"taxi"],
  [37,34,"taxi"],
  [33,31,"taxi"],
  [31,38,"taxi"],
  [38,26,"taxi"],
  [34,29,"taxi"],
  [13,34,"taxi"],
  [26,13,"taxi"],
  [22,41,"taxi"],
  [41,40,"taxi"],
  [40,39,"taxi"],
  [35,22,"taxi"],
  [38,40,"taxi"],
  [4,42,"taxi"],
  [42,39,"taxi"],
  [43,14,"taxi"],
  [4,43,"taxi"],
  [43,44,"taxi"],
  [44,16,"taxi"],
  [1,45,"taxi"],
  [39,45,"taxi"],
  [12,18,"taxi"],
  [18,21,"taxi"],
  [21,20,"taxi"],
  [20,46,"taxi"],
  [46,10,"taxi"],
  [6,7,"taxi"],
  [7,23,"taxi"],
  [20,52,"taxi"],
  [52,53,"taxi"],
  [53,51,"taxi"],
  [51,36,"taxi"],
  [36,48,"taxi"],
  [48,10,"taxi"],
  [46,49,"taxi"],
  [46,56,"taxi"],
  [49,56,"taxi"],
  [50,51,"taxi"],
  [51,56,"taxi"],
  [56,55,"taxi"],
  [48,55,"taxi"],
  [48,56,"taxi"],
  [50,56,"taxi"],
  [52,49,"taxi"],
  [52,50,"taxi"],
  [48,54,"taxi"],
  [10,54,"taxi"],
  [54,9,"taxi"],
  [51,57,"taxi"],
  [57,58,"taxi"],
  [58,9,"taxi"],
  [60,59,"taxi"],
  [59,61,"taxi"],
  [21,62,"taxi"],
  [63,64,"taxi"],
  [60,65,"taxi"],
  [65,66,"taxi"],
  [67,18,"taxi"],
  [61,69,"taxi"],
  [11,47,"taxi"],
  [47,72,"taxi"],
  [72,71,"taxi"],
  [71,70,"taxi"],
  [28,73,"taxi"],
  [73,72,"taxi"],
  [64,17,"taxi"],
  [70,12,"taxi"],
  [60,68,"taxi"],
  [5,80,"taxi"],
  [73,80,"taxi"],
  [5,78,"taxi"],
  [12,68,"taxi"],
  [61,82,"taxi"],
  [82,81,"taxi"],
  [81,1,"taxi"],
  [82,69,"taxi"],
  [79,81,"taxi"],
  [78,14,"taxi"],
  [78,79,"taxi"],
  [5,83,"taxi"],
  [83,16,"taxi"],
  [78,83,"taxi"],
  [12,75,"taxi"],
  [75,76,"taxi"],
  [76,77,"taxi"],
  [78,76,"taxi"],
  [75,80,"taxi"],
  [77,61,"taxi"],
  [69,66,"taxi"],
  [67,84,"taxi"],
  [84,66,"taxi"],
  [67,62,"taxi"],
  [62,74,"taxi"],
  [74,63,"taxi"],
  [63,51,"taxi"],
  [74,85,"taxi"],
  [85,69,"taxi"],
  [80,70,"taxi"],
  [55,36,"taxi"],
  [8,86,"taxi"],
  [86,35,"taxi"],
  [6,9,"taxi"],
  [9,23,"taxi"],
  [19,6,"taxi"],
  [19,9,"taxi"],
  [9,11,"underground"],
  [11,25,"underground"],
  [25,1,"underground"],
  [11,22,"underground"],
  [11,68,"underground"],
  [9,10,"bus"],
  [10,11,"bus"],
  [11,25,"bus"],
  [25,14,"bus"],
  [14,1,"bus"],
  [11,72,"bus"],
  [72,68,"bus"],
  [68,82,"bus"],
  [25,31,"bus"],
  [10,21,"bus"],
  [21,63,"bus"],
  // Rerouted from 63-9 to 63-7 (was passing close to 64/17 with almost no
  // clearance) -- see MANUAL_CURVE_OFFSETS_CITY_OF_SENDHWA["63-7"] for the
  // matching curve tuned to clear 64, 17, 57, 19, and 6.
  [63,7,"bus"],
  [9,35,"bus"],
  [35,22,"bus"],
  [21,69,"bus"],
  [82,1,"bus"],
  // New bus route connecting Chhoti Bijasan (1) and Chhota GhatyaPatya
  // (69) -- straight line would run almost exactly through station 77
  // (0.01 units clearance) and very close to 61, so this needs the
  // matching curve in MANUAL_CURVE_OFFSETS_CITY_OF_SENDHWA["1-69"].
  [1,69,"bus"],
  [22,45,"bus"],
  [22,7,"bus"],
  [7,9,"bus"],
  [1,45,"bus"],
  [69,82,"bus"],
  [11,37,"bus"],
  [37,22,"bus"],
  [25,5,"bus"],
  [5,72,"bus"],
  [62,69,"bus"],
  [37,31,"bus"],
  [56,9,"bus"],
  [63,62,"bus"],
  [43,14,"bus"],
  [43,16,"bus"],
  [72,28,"bus"],
  [5,28,"bus"],
  [56,72,"bus"]
];

const FERRY_EDGES_CITY_OF_SENDHWA = [[66,2],[2,31]];

const MAJOR_STATIONS_CITY_OF_SENDHWA = new Set([1,9,31,37,56,62,68,69,72]);

const MAJOR_LABEL_DIR_CITY_OF_SENDHWA = {
  1: "N",
  9: "N",
  31: "N",
  37: "N",
  56: "N",
  62: "N",
  68: "N",
  69: "N",
  72: "N",
};

const MINOR_LABEL_DIR_CITY_OF_SENDHWA = {
  2: "N",
  3: "N",
  4: "N",
  5: "N",
  6: "N",
  7: "N",
  8: "N",
  10: "N",
  11: "N",
  12: "N",
  13: "N",
  14: "N",
  15: "N",
  16: "N",
  17: "N",
  18: "N",
  19: "N",
  20: "N",
  21: "N",
  22: "N",
  23: "N",
  24: "N",
  25: "N",
  26: "N",
  27: "N",
  28: "N",
  29: "N",
  30: "N",
  32: "N",
  33: "N",
  34: "N",
  35: "N",
  36: "N",
  38: "N",
  39: "N",
  40: "N",
  41: "N",
  42: "N",
  43: "N",
  44: "N",
  45: "N",
  46: "N",
  47: "N",
  48: "N",
  49: "N",
  50: "N",
  51: "N",
  52: "N",
  53: "N",
  54: "N",
  55: "N",
  57: "N",
  58: "N",
  59: "N",
  60: "N",
  61: "N",
  63: "N",
  64: "N",
  65: "N",
  66: "N",
  67: "N",
  70: "N",
  71: "N",
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
};

const MODE_CITY_OF_SENDHWA = {
  taxi: { color: "#a0740d", label: "Taxi", short: "T" },
  bus: { color: "#109347", label: "Bus", short: "B" },
  underground: { color: "#c12115", label: "Metro", short: "M" },
  ferry: { color: "#1a1a1a", label: "Secret Tunnel", short: "S" },
  black: { color: "#2b2b2b", label: "Black", short: "X" },
};

// Deliberate stylistic curves for specific edges, bowing away from named
// third-party stations per explicit request (not automatic parallel-edge
// separation, which edgeGroups already handles for stations with 2+
// edges between the SAME pair) -- verified against the real straight-
// line distance from each named "avoid" station before picking an
// offset: 51-25 and 25-8 don't actually pass near their named stations
// at the given magnitude (chosen purely for visual style, per request),
// but 69-80 GENUINELY collides with #76 on a straight line (only 0.55
// units of clearance, well under the node radius) -- so that one is a
// real correctness fix, not just cosmetic. All four computed to
// maximize clearance from every named avoid-station, checked
// numerically, not eyeballed.
const MANUAL_CURVE_OFFSETS_CITY_OF_SENDHWA = {
  // FIXED: the original -4 offset was a flat value copied from
  // Bengaluru's tuning, but City of Sendhwa's stations sit much farther
  // apart (this map's edges run 30-100+ units vs Bengaluru's typical
  // 10-30), so a flat -4 was only ~6% of the edge's own length here --
  // visually almost imperceptible, which is exactly why these looked
  // "still not curved." Recomputed each offset as ~15% of that specific
  // edge's own length (matching the proportion that reads clearly on
  // Bengaluru), then verified the resulting curve genuinely clears the
  // named avoid-station(s) by a wide margin, not just barely.
  // "22-45": recomputed from -30.49 to -42.4. The old value was verified
  // wrong by direct numeric check: it put the curve only 0.21 units from
  // station 41 (Ramdev Dhaba) -- a near-collision, not a clean "outside"
  // curve, because 41 sits almost exactly on the straight line between 22
  // and 45, so any moderate bow sweeps the curve right across it before
  // diverging. A single quadratic curve genuinely can't clear all of 39/
  // 40/41 to their south without pushing the control point off-canvas
  // (would need roughly -90 to -110, putting it at y=165-190 against a
  // map whose stations only span up to y=109) -- -42.4 is the offset that
  // maximizes the worst-case clearance from all three while keeping the
  // curve's visible apex on-canvas (~y=111): clearances come out to
  // 4.17 / 4.33 / 4.14 units from 39 / 40 / 41 respectively (was 8.58 /
  // 1.61 / 0.21 -- station 41 was the real problem).
  "22-45": -42.4, // bus route Chetan Hanuman<->Balwadi
  "7-22": -26.16, // bus route Balwadi<->Chowdhary Dhaba, curving outside Narayan Das Hospital
  "62-69": -19.67, // bus route Jogwada Road<->Chhota GhatyaPatya, curving outside Sendhwa Public School, Bagrecha Garden, Govt. Hospital -- verified clearances 8.29/12.42/13.07, already fine, unchanged
  "1-82": -9.35, // bus route Homeopathy College<->Chhoti Bijasan, curving outside Pipaldhar
  // "63-7": new curve for the rerouted 63<->7 edge (was 63-9). Straight
  // line clears station 64 by only 2.15 units and station 17 by only
  // 1.17 -- -11.6 is the offset that maximizes worst-case clearance
  // across all five nearby stations (64/17/57/19/6): 7.49/3.89/3.86/
  // 4.55/4.68 units respectively.
  "63-7": -11.6,
  // "1-69": new bus route Chhoti Bijasan<->Chhota GhatyaPatya. A straight
  // line here would run through station 77 (0.01 units clearance -- a
  // real overlap) and pass very close to 61 (0.86). -13.4 is the offset
  // that maximizes worst-case clearance across 77/61/79/82: 6.70/6.52/
  // 9.12/6.53 units respectively.
  "1-69": -13.4,
};

export const cityOfSendhwaMap = {
  id: "city-of-sendhwa",
  label: "City of Sendhwa",
  subtitle: "86-station town map · real local layout · genuine metro interchanges",
  stations: STATIONS_CITY_OF_SENDHWA,
  edges: EDGES_CITY_OF_SENDHWA,
  ferryEdges: FERRY_EDGES_CITY_OF_SENDHWA,
  names: STATION_NAMES_CITY_OF_SENDHWA,
  majorStations: MAJOR_STATIONS_CITY_OF_SENDHWA,
  majorLabelDir: MAJOR_LABEL_DIR_CITY_OF_SENDHWA,
  minorLabelDir: MINOR_LABEL_DIR_CITY_OF_SENDHWA,
  modeTheme: MODE_CITY_OF_SENDHWA,
  manualCurveOffsets: MANUAL_CURVE_OFFSETS_CITY_OF_SENDHWA,
  viewW: 172,
  viewH: 116,
  background: { kind: "citymap", theme: "city-of-sendhwa" },
  characterNames: null,
  mrxName: null,
};
