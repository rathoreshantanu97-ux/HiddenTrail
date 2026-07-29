// ---------------------------------------------------------------------------
// MAP: "Bengaluru" — 64 real neighborhoods placed at roughly their true
// relative bearing/distance from the MG Road / Cubbon Park city center.
// Underground tier loosely traces Bengaluru's real Metro corridors. Ferry
// crossings represent Bengaluru's two big lakes (Ulsoor, Bellandur) since
// the city has no river — a deliberate reinterpretation of the ferry
// mechanic, not a literal one.
// This is the fullest "real city" example — copy this file as a template
// for another real-world city map (custom background art via the
// "citymap" background kind, real names, label directions, etc).
// ---------------------------------------------------------------------------

const STATIONS_BLR = {
  1:[49.0,45.3],2:[39.4,44.5],3:[44.5,36.3],4:[34.8,36.1],5:[27.5,42.7],
  6:[21.0,49.7],7:[32.4,51.0],8:[25.9,58.0],9:[36.0,72.8],10:[33.8,84.0],
  11:[27.1,76.4],12:[43.3,82.6],13:[54.9,71.0],14:[61.9,77.5],15:[56.8,96.0],
  16:[52.6,80.3],17:[59.2,52.3],18:[66.2,58.9],19:[75.7,57.2],20:[84.8,54.4],
  21:[87.0,44.2],22:[78.0,47.7],23:[61.6,43.1],24:[54.1,37.2],25:[46.1,19.8],
  26:[50.0,28.5],27:[24.4,33.7],28:[17.8,40.6],29:[11.6,48.0],30:[21.4,24.5],
  31:[12.2,21.9],32:[42.2,10.9],33:[36.5,18.9],34:[27.2,16.9],35:[35.6,4.0],
  36:[61.4,31.0],37:[57.1,22.1],38:[66.6,20.5],39:[53.2,13.4],40:[74.0,66.7],
  41:[71.3,75.9],42:[49.4,89.9],43:[59.7,86.9],44:[40.5,27.6],45:[30.9,26.7],
  46:[14.7,31.5],47:[23.8,67.4],48:[24.3,85.5],49:[17.0,78.2],50:[4.0,65.5],
  51:[12.7,69.5],52:[8.0,56.8],53:[16.7,60.8],54:[71.7,28.7],55:[79.4,38.2],
  56:[69.8,38.1],57:[68.7,49.6],58:[45.6,73.3],59:[34.2,63.4],60:[40.5,56.1],
  61:[50.0,54.9],62:[64.4,68.3],63:[56.8,61.6],64:[46.3,63.7],
};

const STATION_NAMES_BLR = {
  1:"MG Road",2:"Cubbon Park",3:"Shivajinagar",4:"Vidhana Soudha",5:"Majestic",
  6:"City Railway Stn",7:"Chickpet",8:"Basavanagudi",9:"Jayanagar",10:"JP Nagar",
  11:"Banashankari",12:"BTM Layout",13:"Koramangala",14:"HSR Layout",
  15:"Electronic City",16:"Silk Board",17:"Indiranagar",18:"Domlur",
  19:"Marathahalli",20:"Whitefield",21:"ITPL",22:"KR Puram",23:"Ulsoor",
  24:"Halasuru",25:"Frazer Town",26:"Cantonment",27:"Malleshwaram",
  28:"Rajajinagar",29:"Vijayanagar",30:"Yeshwanthpur",31:"Peenya",32:"Hebbal",
  33:"RT Nagar",34:"Sanjaynagar",35:"Yelahanka",36:"Banaswadi",37:"Kammanahalli",
  38:"HRBR Layout",39:"Nagawara",40:"Bellandur",41:"Sarjapur Road",
  42:"Bommanahalli",43:"Hosur Road",44:"Vasanth Nagar",45:"Seshadripuram",
  46:"Malleswaram West",47:"Yediyur",48:"Padmanabhanagar",49:"Uttarahalli",
  50:"Kengeri",51:"RR Nagar",52:"Nayandahalli",53:"Mysore Road",
  54:"Vijinapura",55:"Tin Factory",56:"Old Airport Road",57:"Jeevanbhimanagar",
  58:"Wilson Garden",59:"Lalbagh",60:"Shanthinagar",61:"Richmond Town",
  62:"Ejipura",63:"Viveknagar",64:"Adugodi",
};

// Taxi tier: dense local mesh. Underground tier: three real, ordered
// corridors inspired by Namma Metro (Purple/Green/Yellow lines). Bus tier:
// small set of real arterial connections between non-adjacent clusters.
const EDGES_BLR = [
  [28,46,"underground"],
  [50,52,"underground"],
  [58,59,"underground"],
  [12,16,"underground"],
  [14,16,"underground"],
  [4,27,"underground"],
  [17,18,"underground"],
  [7,59,"underground"],
  [34,46,"underground"],
  [32,33,"underground"],
  [18,19,"underground"],
  [20,22,"underground"],
  [14,15,"underground"],
  [29,52,"underground"],
  [27,30,"underground"],
  [28,29,"underground"],
  [1,17,"underground"],
  [6,7,"underground"],
  [32,35,"underground"],
  [33,34,"underground"],
  [20,21,"underground"],
  [9,58,"underground"],
  [9,12,"underground"],
  [1,4,"underground"],
  [19,22,"underground"],
  [25,32,"bus"],
  [49,51,"bus"],
  [21,22,"bus"],
  [37,38,"bus"],
  [8,53,"bus"],
  [23,56,"bus"],
  [10,12,"bus"],
  [22,55,"bus"],
  [33,45,"bus"],
  [55,56,"bus"],
  [9,11,"bus"],
  [54,56,"bus"],
  [13,63,"bus"],
  [15,42,"bus"],
  [40,41,"bus"],
  [11,47,"bus"],
  [12,58,"bus"],
  [13,16,"bus"],
  [1,24,"taxi"],
  [1,2,"taxi"],
  [2,7,"taxi"],
  [2,4,"taxi"],
  [3,26,"taxi"],
  [3,44,"taxi"],
  [4,3,"taxi"],
  [4,5,"taxi"],
  [5,27,"taxi"],
  [5,6,"taxi"],
  [6,29,"taxi"],
  [6,8,"taxi"],
  [7,8,"taxi"],
  [7,60,"taxi"],
  [8,47,"taxi"],
  [8,59,"taxi"],
  [9,59,"taxi"],
  [9,10,"taxi"],
  [10,48,"taxi"],
  [10,11,"taxi"],
  [11,48,"taxi"],
  [11,49,"taxi"],
  [12,42,"taxi"],
  [13,14,"taxi"],
  [13,58,"taxi"],
  [14,62,"taxi"],
  [14,41,"taxi"],
  [15,43,"taxi"],
  [16,43,"taxi"],
  [16,58,"taxi"],
  [17,23,"taxi"],
  [17,61,"taxi"],
  [18,62,"taxi"],
  [18,57,"taxi"],
  [19,20,"taxi"],
  [19,40,"taxi"],
  [21,55,"taxi"],
  [22,57,"taxi"],
  [23,24,"taxi"],
  [23,57,"taxi"],
  [24,36,"taxi"],
  [24,26,"taxi"],
  [25,26,"taxi"],
  [25,39,"taxi"],
  [26,44,"taxi"],
  [26,37,"taxi"],
  [27,28,"taxi"],
  [27,45,"taxi"],
  [28,6,"taxi"],
  [28,5,"taxi"],
  [30,31,"taxi"],
  [30,34,"taxi"],
  [31,46,"taxi"],
  [32,39,"taxi"],
  [33,44,"taxi"],
  [33,25,"taxi"],
  [34,45,"taxi"],
  [36,37,"taxi"],
  [36,54,"taxi"],
  [37,39,"taxi"],
  [37,25,"taxi"],
  [38,54,"taxi"],
  [38,36,"taxi"],
  [40,62,"taxi"],
  [40,18,"taxi"],
  [41,62,"taxi"],
  [42,16,"taxi"],
  [42,43,"taxi"],
  [43,14,"taxi"],
  [44,25,"taxi"],
  [44,45,"taxi"],
  [45,30,"taxi"],
  [45,4,"taxi"],
  [46,30,"taxi"],
  [46,27,"taxi"],
  [47,53,"taxi"],
  [47,59,"taxi"],
  [48,49,"taxi"],
  [50,51,"taxi"],
  [51,53,"taxi"],
  [51,47,"taxi"],
  [52,53,"taxi"],
  [53,6,"taxi"],
  [56,36,"taxi"],
  [56,57,"taxi"],
  [57,17,"taxi"],
  [57,19,"taxi"],
  [58,64,"taxi"],
  [59,60,"taxi"],
  [60,64,"taxi"],
  [60,61,"taxi"],
  [61,63,"taxi"],
  [61,64,"taxi"],
  [62,13,"taxi"],
  [62,63,"taxi"],
  [63,17,"taxi"],
  [63,18,"taxi"],
  [64,63,"taxi"],
  [64,13,"taxi"],
];

// Lake crossings (Ulsoor Lake and Bellandur Lake) — Mr. X only, cost a
// black ticket, same rule as river ferries.
const FERRY_EDGES_BLR = [
  [23,61],[24,63],[40,63],[41,13],
];

// Major, well-known areas shown by name on the map at all times (rest are
// numbered only, name visible via tooltip).
const MAJOR_STATIONS_BLR = new Set([1,20,15,30,11,32,22,16]);

// Direction each major label is offset toward, chosen per-station so the
// label points away from the city center into open space.
const MAJOR_LABEL_DIR_BLR = {
  1: "NE",   // MG Road
  20: "E",   // Whitefield
  15: "S",   // Electronic City
  30: "N",   // Yeshwanthpur
  11: "S",   // Banashankari
  32: "N",   // Hebbal
  22: "E",   // KR Puram
  16: "S",   // Silk Board
};

// Minor-station label directions, computed the same collision-checked way
// as majors but at a smaller font/distance.
const MINOR_LABEL_DIR_BLR = {
  2: "NW", 3: "N", 4: "N", 5: "NW", 6: "W", 7: "W", 8: "W", 9: "S", 10: "S",
  12: "S", 13: "SE", 14: "SE", 17: "E", 18: "E", 19: "E", 21: "E", 23: "NE",
  24: "NE", 25: "N", 26: "N", 27: "NW", 28: "W", 29: "W", 31: "NW", 33: "N",
  34: "NW", 35: "N", 36: "NE", 37: "N", 38: "NE", 39: "N", 40: "SE", 41: "SE",
  42: "S", 43: "SE", 44: "N", 45: "N", 46: "NW", 47: "SW", 48: "SW", 49: "SW",
  50: "W", 51: "SW", 52: "W", 53: "W", 54: "NE", 55: "E", 56: "NE", 57: "E",
  58: "S", 59: "SW", 60: "SW", 61: "SE", 62: "SE", 63: "SE", 64: "S",
};

export const bengaluruMap = {
  id: "bengaluru",
  label: "Bengaluru",
  subtitle: "Real neighborhoods · lake crossings",
  stations: STATIONS_BLR,
  edges: EDGES_BLR,
  ferryEdges: FERRY_EDGES_BLR,
  names: STATION_NAMES_BLR,
  majorStations: MAJOR_STATIONS_BLR,
  majorLabelDir: MAJOR_LABEL_DIR_BLR,
  minorLabelDir: MINOR_LABEL_DIR_BLR,
  modeTheme: null,
  viewW: 100,
  viewH: 100,
  background: {
    kind: "citymap",
    theme: "bengaluru", // selects the hand-tuned lake/park/ring-road art in mapBackgrounds.js
  },
  characterNames: null,
  mrxName: null,
};
