// ---------------------------------------------------------------------------
// DECORATION ICONS — a built-in library of generic vector icons an admin
// can drop onto a map for beautification (landmarks, nature, civic
// buildings, transport, commerce, recreation, symbols), separate from
// MapBackground.jsx's bespoke, hand-positioned real-landmark art. These
// are generic on purpose: they're meant to be placed ANYWHERE by an admin
// with no code access, so they can't be tied to one specific real
// building the way MapBackground's icons are.
//
// Expanded to 100 icons across 7 categories (Nature, Civic, Transport,
// Commerce, Recreation, Rural, Symbols) specifically because custom
// image uploads aren't available (see DecorationsLayer.jsx / the Map
// Editor's "Deliberately deferred" note on uploads) -- a wide built-in
// variety is the actual mitigation for not having uploads, not a nice-
// to-have.
//
// Each icon is a pure function (name) -> SVG child elements, sized to
// roughly fit a 12x12 box centered on the origin -- the caller just wraps
// it in <g transform="translate(x,y) rotate(deg) scale(size/10)"
// fill={color}"> so placing/resizing/rotating/coloring is all one
// transform + one fill, not per-icon logic.
// ---------------------------------------------------------------------------

export const ICON_CATEGORIES = {
  Nature: ["water", "lake", "pond", "river", "waterfall", "mountain", "hill", "cliff", "cave", "forest", "tree", "palm"],
  Civic: [
    "landmark", "fort", "school", "college", "hospital", "police", "firestation", "church", "temple", "mosque",
    "synagogue", "monastery", "courthouse", "cityhall", "library", "prison", "cemetery",
  ],
  Transport: ["bus", "train", "railway", "metro", "subway", "tram", "airport", "port", "ferry", "cablecar", "lighthouse", "helipad", "parking", "bridge", "road"],
  Commerce: [
    "shop", "mall", "market", "cafe", "restaurant", "bakery", "hotel", "bank", "pharmacy", "gasstation",
    "factory", "office", "skyscraper", "warehouse", "powerplant", "mine",
  ],
  Recreation: [
    "stadium", "arena", "museum", "theater", "zoo", "amusementpark", "garden", "playground", "pool", "monument",
    "campsite", "casino", "golfcourse", "aquarium", "circus", "skatepark",
  ],
  Rural: ["farm", "farmland", "vineyard", "windmill", "house", "apartment", "village", "suburb"],
  Symbols: ["star", "flag", "pin", "cross", "crown", "anchor", "compass", "heart", "trophy", "gem", "key", "lightbulb", "shield", "medal", "gift", "clock"],
};

export const ICON_LIBRARY = Object.values(ICON_CATEGORIES).flat();

export const ICON_LABELS = {
  water: "Water",
  lake: "Lake",
  pond: "Pond",
  river: "River",
  waterfall: "Waterfall",
  mountain: "Mountain",
  hill: "Hill",
  cliff: "Cliff",
  cave: "Cave",
  forest: "Forest",
  tree: "Tree",
  palm: "Palm tree",
  landmark: "Landmark",
  fort: "Fort",
  school: "School",
  college: "College",
  hospital: "Hospital",
  police: "Police",
  firestation: "Fire station",
  church: "Church",
  temple: "Temple",
  mosque: "Mosque",
  synagogue: "Synagogue",
  monastery: "Monastery",
  courthouse: "Courthouse",
  cityhall: "City hall",
  library: "Library",
  prison: "Prison",
  cemetery: "Cemetery",
  bus: "Bus stop",
  train: "Train station",
  railway: "Railway",
  metro: "Metro station",
  subway: "Subway sign",
  tram: "Tram",
  airport: "Airport",
  port: "Port / dock",
  ferry: "Ferry",
  cablecar: "Cable car",
  lighthouse: "Lighthouse",
  helipad: "Helipad",
  parking: "Parking",
  bridge: "Bridge",
  road: "Road",
  shop: "Shop",
  mall: "Mall",
  market: "Market",
  cafe: "Cafe",
  restaurant: "Restaurant",
  bakery: "Bakery",
  hotel: "Hotel",
  bank: "Bank",
  pharmacy: "Pharmacy",
  gasstation: "Gas station",
  factory: "Factory",
  office: "Office",
  skyscraper: "Skyscraper",
  warehouse: "Warehouse",
  powerplant: "Power plant",
  mine: "Mine",
  stadium: "Stadium",
  arena: "Arena",
  museum: "Museum",
  theater: "Theater",
  zoo: "Zoo",
  amusementpark: "Amusement park",
  garden: "Garden",
  playground: "Playground",
  pool: "Pool",
  monument: "Monument",
  campsite: "Campsite",
  casino: "Casino",
  golfcourse: "Golf course",
  aquarium: "Aquarium",
  circus: "Circus",
  skatepark: "Skate park",
  farm: "Farm",
  farmland: "Farmland",
  vineyard: "Vineyard",
  windmill: "Windmill",
  house: "House",
  apartment: "Apartment",
  village: "Village",
  suburb: "Suburb",
  star: "Star",
  flag: "Flag",
  pin: "Pin",
  cross: "Cross",
  crown: "Crown",
  anchor: "Anchor",
  compass: "Compass",
  heart: "Heart",
  trophy: "Trophy",
  gem: "Gem",
  key: "Key",
  lightbulb: "Idea / lightbulb",
  shield: "Shield",
  medal: "Medal",
  gift: "Gift",
  clock: "Clock",
};

// Shared sub-shapes reused across a few icons so buildings/columns read
// consistently instead of each being drawn from scratch.
function columnsBuilding(pedimentPoints) {
  return (
    <>
      <polygon points={pedimentPoints} />
      <rect x="-3.4" y="-0.6" width="6.8" height="0.6" />
      {[-2.4, -1.2, 0, 1.2, 2.4].map((dx, i) => (
        <rect key={i} x={dx - 0.2} y={0} width="0.4" height="2.4" />
      ))}
      <rect x="-3.8" y="2.4" width="7.6" height="0.6" />
    </>
  );
}

function mortarboard() {
  return (
    <>
      <polygon points="0,-2.6 5,0 0,2.6 -5,0" />
      <rect x="-0.4" y="0" width="0.8" height="3.6" />
      <circle cx="0" cy="3.8" r="0.55" />
    </>
  );
}

export function renderIconPaths(name) {
  switch (name) {
    // ---- Nature ----
    case "water":
      return <ellipse cx="0" cy="0" rx="4.5" ry="3" />;
    case "lake":
      return <path d="M -5,0 Q -4,-3 0,-2.6 Q 4,-3.4 5,-0.5 Q 4.5,2.6 0,2.8 Q -4.5,2.8 -5,0 Z" />;
    case "river":
      return (
        <path
          d="M -5,-3 Q -2,-1 -3,1 T 0,3 Q 2,4 5,3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      );
    case "mountain":
      return (
        <>
          <polygon points="-5,3 -1,-4 2,0 5,3" />
          <polygon points="-1,-4 -2.2,-1.6 0.2,-1.6" fill="#fff" opacity="0.85" />
        </>
      );
    case "hill":
      return (
        <>
          <ellipse cx="-1.6" cy="1" rx="3.2" ry="2.2" />
          <ellipse cx="2.2" cy="1.6" rx="2.6" ry="1.8" />
        </>
      );
    case "forest":
      return (
        <>
          <g transform="translate(-2.6, 0.6)">
            <circle cx="0" cy="-1" r="1.8" />
            <rect x="-0.3" y="0.5" width="0.6" height="1.6" />
          </g>
          <g transform="translate(0.4, -0.8)">
            <circle cx="0" cy="-1.3" r="2.3" />
            <rect x="-0.35" y="0.6" width="0.7" height="1.9" />
          </g>
          <g transform="translate(3, 0.8)">
            <circle cx="0" cy="-1" r="1.7" />
            <rect x="-0.3" y="0.4" width="0.6" height="1.5" />
          </g>
        </>
      );
    case "tree":
      return (
        <>
          <circle cx="0" cy="-1.2" r="2.4" />
          <rect x="-0.4" y="1" width="0.8" height="2" />
        </>
      );
    case "palm":
      return (
        <>
          <path d="M 0,3.4 Q -0.6,-0.5 0,-2.6" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
          {[
            [-3.2, -3.6, -20],
            [-1.6, -4.4, -8],
            [0.4, -4.6, 4],
            [2.2, -4.1, 16],
            [3.4, -3.1, 30],
          ].map(([dx, dy, rot], i) => (
            <ellipse key={i} cx={dx} cy={dy} rx="2" ry="0.7" transform={`rotate(${rot} ${dx} ${dy})`} />
          ))}
        </>
      );
    case "pond":
      return <ellipse cx="0" cy="0" rx="2.6" ry="1.8" />;
    case "waterfall":
      return (
        <>
          <rect x="-2" y="-4.4" width="4" height="1.4" opacity="0.6" />
          {[-1.4, -0.4, 0.6, 1.6].map((x, i) => (
            <line key={i} x1={x} y1="-3" x2={x - 0.4} y2="3" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" opacity={0.6 + i * 0.08} />
          ))}
          <ellipse cx="-0.6" cy="3.6" rx="3" ry="0.9" opacity="0.6" />
        </>
      );
    case "cliff":
      return (
        <>
          <polygon points="-5,4 -5,1 -1,-4.4 3,-1 5,4" />
          <line x1="-3" y1="1.6" x2="0" y2="4" stroke="#fff" strokeWidth="0.4" opacity="0.5" />
          <line x1="0.4" y1="-1" x2="2.6" y2="1.4" stroke="#fff" strokeWidth="0.4" opacity="0.5" />
        </>
      );
    case "cave":
      return (
        <>
          <path d="M -4.4,4 Q -4.4,-2.4 0,-3.4 Q 4.4,-2.4 4.4,4 Z" />
          <ellipse cx="0" cy="2.2" rx="2.2" ry="1.8" fill="#000" opacity="0.55" />
        </>
      );

    // ---- Civic ----
    case "landmark":
      return columnsBuilding("0,-4 2.2,-2 -2.2,-2");
    case "fort":
      return (
        <>
          <rect x="-4" y="0" width="8" height="3" />
          {[-3.2, -1.3, 0.5, 2.4].map((dx, i) => (
            <rect key={i} x={dx} y="-1.1" width="1.2" height="1.3" />
          ))}
          <rect x="-5" y="2.4" width="10" height="0.8" />
        </>
      );
    case "school":
      return mortarboard();
    case "college":
      return (
        <>
          <rect x="-4.4" y="-0.2" width="8.8" height="4" />
          <polygon points="-4.8,-0.2 0,-2.8 4.8,-0.2" />
          <rect x="-0.6" y="-4.6" width="1.2" height="2" />
          <rect x="-1.4" y="-5.2" width="2.8" height="0.7" />
          {[-2.8, -1, 0.8, 2.6].map((dx, i) => (
            <rect key={i} x={dx - 0.5} y="0.6" width="1" height="2.4" fill="#fff" opacity="0.35" />
          ))}
        </>
      );
    case "hospital":
      return (
        <>
          <rect x="-4" y="-3.6" width="8" height="7.2" rx="0.6" />
          <rect x="-1" y="-2.2" width="2" height="4.4" fill="#fff" />
          <rect x="-2.2" y="-1" width="4.4" height="2" fill="#fff" />
        </>
      );
    case "police":
      return <path d="M 0,-3 L 3,-1.8 L 3,1.2 Q 3,3.3 0,4.5 Q -3,3.3 -3,1.2 L -3,-1.8 Z" />;
    case "firestation":
      return (
        <path d="M 0,-4.4 C 1.8,-2.6 2.6,-1 2.6,0.4 C 2.6,2.8 1.4,4.4 0,4.4 C -1.4,4.4 -2.6,2.8 -2.6,0.4 C -2.6,-0.6 -2.1,-1.2 -1.4,-1.6 C -1.5,-0.6 -1,0.2 -0.3,0.2 C 0.4,0.2 0.7,-0.4 0.4,-1.2 C 0.1,-2 -0.4,-3 0,-4.4 Z" />
      );
    case "church":
      return (
        <>
          <rect x="-2.6" y="-0.2" width="5.2" height="4.2" />
          <polygon points="0,-3.2 -3,-0.2 3,-0.2" />
          <rect x="-0.35" y="-5.2" width="0.7" height="2.2" />
          <rect x="-1" y="-4.6" width="2" height="0.6" />
        </>
      );
    case "temple":
      return (
        <>
          <rect x="-3.4" y="1.4" width="6.8" height="0.9" />
          <polygon points="0,-4.6 4.2,-1.6 -4.2,-1.6" />
          <polygon points="0,-2.8 3,-0.6 -3,-0.6" opacity="0.85" />
          <rect x="-2.4" y="-0.6" width="4.8" height="2" fill="#fff" opacity="0.3" />
        </>
      );
    case "mosque":
      return (
        <>
          <rect x="-3.6" y="0.4" width="7.2" height="3" />
          <path d="M -1.6,0.4 Q -1.6,-2.4 0,-3.4 Q 1.6,-2.4 1.6,0.4 Z" />
          <line x1="0" y1="-3.4" x2="0" y2="-5" stroke="currentColor" strokeWidth="0.4" />
          <circle cx="0" cy="-5.2" r="0.4" />
          <circle cx="-3.6" cy="1.8" r="0.5" />
          <line x1="-3.6" y1="1.3" x2="-3.6" y2="-1" stroke="currentColor" strokeWidth="0.4" />
          <circle cx="3.6" cy="1.8" r="0.5" />
          <line x1="3.6" y1="1.3" x2="3.6" y2="-1" stroke="currentColor" strokeWidth="0.4" />
        </>
      );
    case "synagogue":
      return (
        <>
          <rect x="-3.4" y="0" width="6.8" height="3.4" />
          <polygon points="0,-4 3.4,0 -3.4,0" />
          <path d="M 0,-6 L 0.6,-4.9 L 1.8,-4.9 L 0.9,-4.2 L 1.2,-3 L 0,-3.7 L -1.2,-3 L -0.9,-4.2 L -1.8,-4.9 L -0.6,-4.9 Z" />
        </>
      );
    case "courthouse":
      return columnsBuilding("0,-4.4 3,-1.6 -3,-1.6");
    case "library":
      return (
        <>
          <path d="M -3.6,-2.6 Q -1.6,-3.4 0,-2.6 L 0,2.6 Q -1.6,1.8 -3.6,2.6 Z" />
          <path d="M 3.6,-2.6 Q 1.6,-3.4 0,-2.6 L 0,2.6 Q 1.6,1.8 3.6,2.6 Z" opacity="0.8" />
        </>
      );
    case "prison":
      return (
        <>
          <rect x="-3.6" y="-3" width="7.2" height="6" opacity="0.35" />
          {[-2.6, -1.3, 0, 1.3, 2.6].map((dx, i) => (
            <rect key={i} x={dx - 0.25} y="-3" width="0.5" height="6" />
          ))}
        </>
      );
    case "monastery":
      return (
        <>
          <rect x="-3.6" y="0" width="7.2" height="3.4" />
          <polygon points="-2.4,0 -2.4,-2.4 -1.4,-3.4 -0.4,-2.4 -0.4,0" />
          <polygon points="0.4,0 0.4,-2.4 1.4,-3.4 2.4,-2.4 2.4,0" />
          <circle cx="-1.4" cy="-3.4" r="0.4" />
          <circle cx="1.4" cy="-3.4" r="0.4" />
        </>
      );
    case "cityhall":
      return (
        <>
          {columnsBuilding("0,-4.6 3.2,-1.8 -3.2,-1.8")}
          <rect x="-0.7" y="-6" width="1.4" height="1.6" />
        </>
      );
    case "cemetery":
      return (
        <>
          <rect x="-4.4" y="2.6" width="8.8" height="0.7" />
          {[-2.6, 0, 2.6].map((dx, i) => (
            <g key={i} transform={`translate(${dx}, 1)`}>
              <rect x="-0.6" y="-2.4" width="1.2" height="3.4" rx="0.6" />
              <rect x="-1.1" y="-1" width="2.2" height="0.5" />
            </g>
          ))}
        </>
      );

    // ---- Transport ----
    case "bus":
      return (
        <>
          <rect x="-3.2" y="-1.4" width="6.4" height="2.8" rx="0.5" />
          <circle cx="-2" cy="1.6" r="0.7" />
          <circle cx="2" cy="1.6" r="0.7" />
        </>
      );
    case "train":
      return (
        <>
          <path d="M -3,-3.6 L 3,-3.6 L 3,1 Q 3,2.4 0,2.4 Q -3,2.4 -3,1 Z" />
          <rect x="-2.2" y="-2.6" width="4.4" height="2.2" fill="#fff" opacity="0.35" />
          <circle cx="-1.6" cy="1.6" r="0.6" fill="#fff" />
          <circle cx="1.6" cy="1.6" r="0.6" fill="#fff" />
        </>
      );
    case "railway":
      return (
        <>
          <line x1="-4.4" y1="-1.4" x2="4.4" y2="-1.4" stroke="currentColor" strokeWidth="0.6" />
          <line x1="-4.4" y1="1.4" x2="4.4" y2="1.4" stroke="currentColor" strokeWidth="0.6" />
          {[-3.2, -1.6, 0, 1.6, 3.2].map((x, i) => (
            <line key={i} x1={x} y1="-1.8" x2={x} y2="1.8" stroke="currentColor" strokeWidth="0.7" />
          ))}
        </>
      );
    case "metro":
      return (
        <>
          <path d="M -4.6,2.4 L -2.4,-3 L 0,1.4 L 2.4,-3 L 4.6,2.4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </>
      );
    case "tram":
      return (
        <>
          <rect x="-3.4" y="-2.6" width="6.8" height="4.4" rx="0.6" />
          <rect x="-2.6" y="-1.8" width="2" height="1.8" fill="#fff" opacity="0.4" />
          <rect x="0.6" y="-1.8" width="2" height="1.8" fill="#fff" opacity="0.4" />
          <line x1="0" y1="-4.4" x2="0" y2="-2.6" stroke="currentColor" strokeWidth="0.4" />
          <circle cx="-1.8" cy="2.2" r="0.6" />
          <circle cx="1.8" cy="2.2" r="0.6" />
        </>
      );
    case "cablecar":
      return (
        <>
          <line x1="-5" y1="-3.4" x2="5" y2="1.6" stroke="currentColor" strokeWidth="0.4" opacity="0.6" />
          <line x1="-1" y1="-1.2" x2="-1" y2="0.2" stroke="currentColor" strokeWidth="0.4" />
          <line x1="1.4" y1="-0.4" x2="1.4" y2="1" stroke="currentColor" strokeWidth="0.4" />
          <rect x="-2.2" y="0.2" width="2.4" height="1.8" rx="0.3" />
          <rect x="0.2" y="1" width="2.4" height="1.8" rx="0.3" />
        </>
      );
    case "airport":
      return (
        <path d="M 0 -3 L 0.7 2 L 3.8 3.8 L 3.8 4.7 L 0.55 3.8 L 0.75 5.8 L 2 6.7 L 2 7.5 L 0 6.8 L -2 7.5 L -2 6.7 L -0.75 5.8 L -0.55 3.8 L -3.8 4.7 L -3.8 3.8 L -0.7 2 Z" />
      );
    case "port":
      return (
        <>
          <circle cx="0" cy="-2.4" r="1" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <line x1="0" y1="-1.4" x2="0" y2="3" stroke="currentColor" strokeWidth="0.6" />
          <path d="M -3,1 Q 0,4 3,1" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <line x1="-1.8" y1="0" x2="1.8" y2="0" stroke="currentColor" strokeWidth="0.6" />
        </>
      );
    case "ferry":
      return (
        <>
          <path d="M -3.6,0.6 L 3.6,0.6 L 2.6,3 L -2.6,3 Z" />
          <rect x="-1.6" y="-2.4" width="3.2" height="3" fill="currentColor" />
          <rect x="-1.1" y="-1.8" width="0.9" height="0.9" fill="#fff" opacity="0.5" />
          <rect x="0.2" y="-1.8" width="0.9" height="0.9" fill="#fff" opacity="0.5" />
          <line x1="0" y1="-2.4" x2="0" y2="-3.6" stroke="currentColor" strokeWidth="0.35" />
        </>
      );
    case "lighthouse":
      return (
        <>
          <polygon points="-1.2,3.6 -0.7,-3 0.7,-3 1.2,3.6" />
          <rect x="-1.6" y="3.6" width="3.2" height="0.8" />
          <rect x="-1.1" y="-4.4" width="2.2" height="1.4" />
          {[-2, 0, 2].map((y, i) => (
            <line key={i} x1="-0.9" y1={y - 3.6 + 3.6} x2="0.9" y2={y - 3.6 + 3.6} stroke="#fff" strokeWidth="0.3" opacity="0.5" />
          ))}
        </>
      );
    case "helipad":
      return (
        <>
          <circle cx="0" cy="0" r="4.2" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <text x="0" y="1.6" fontSize="5.4" textAnchor="middle" fontWeight="700" fontFamily="sans-serif">
            H
          </text>
        </>
      );
    case "parking":
      return (
        <>
          <rect x="-3.6" y="-4" width="7.2" height="8" rx="0.6" />
          <text x="0" y="2.4" fontSize="6.4" textAnchor="middle" fill="#fff" fontWeight="700" fontFamily="sans-serif">
            P
          </text>
        </>
      );
    case "bridge":
      return (
        <>
          <path d="M -5,1.4 Q 0,-4.4 5,1.4" fill="none" stroke="currentColor" strokeWidth="1" />
          <line x1="-3.4" y1="1.4" x2="-3.4" y2="3.4" stroke="currentColor" strokeWidth="0.8" />
          <line x1="0" y1="1.4" x2="0" y2="3.4" stroke="currentColor" strokeWidth="0.8" />
          <line x1="3.4" y1="1.4" x2="3.4" y2="3.4" stroke="currentColor" strokeWidth="0.8" />
          <line x1="-5" y1="3.4" x2="5" y2="3.4" stroke="currentColor" strokeWidth="1" />
        </>
      );
    case "subway":
      return (
        <>
          <circle cx="0" cy="0" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <line x1="-2.2" y1="0" x2="2.2" y2="0" stroke="currentColor" strokeWidth="1.1" />
        </>
      );
    case "road":
      return (
        <>
          <rect x="-1.8" y="-4.4" width="3.6" height="8.8" />
          {[-2.6, -0.4, 1.8].map((y, i) => (
            <rect key={i} x="-0.35" y={y} width="0.7" height="1.6" fill="#fff" />
          ))}
        </>
      );

    // ---- Commerce ----
    case "shop":
      return (
        <>
          <rect x="-2.6" y="-0.2" width="5.2" height="2.8" />
          <polygon points="-3,-0.2 0,-2 3,-0.2" />
          <rect x="-1,0" y="0.5" width="2" height="2.1" fill="#fff" opacity="0.35" />
        </>
      );
    case "mall":
      return (
        <>
          <rect x="-4.4" y="-0.2" width="8.8" height="3" />
          <polygon points="-4.8,-0.2 0,-2.6 4.8,-0.2" />
          {[-2.6, 0, 2.6].map((dx, i) => (
            <rect key={i} x={dx - 0.7} y="0.4" width="1.4" height="2.2" fill="#fff" opacity="0.35" />
          ))}
        </>
      );
    case "market":
      return (
        <>
          <path d="M -3.4,-0.4 L 3.4,-0.4 L 2.6,-2.4 L -2.6,-2.4 Z" />
          <line x1="-3.4" y1="-0.4" x2="-3.4" y2="3" stroke="currentColor" strokeWidth="0.5" />
          <line x1="3.4" y1="-0.4" x2="3.4" y2="3" stroke="currentColor" strokeWidth="0.5" />
          <rect x="-2.6" y="0.2" width="5.2" height="1.4" opacity="0.5" />
        </>
      );
    case "restaurant":
      return (
        <>
          <g transform="translate(-1.6,0)">
            <line x1="0" y1="-4" x2="0" y2="4" stroke="currentColor" strokeWidth="0.6" />
            <line x1="-0.8" y1="-4" x2="-0.8" y2="-1.6" stroke="currentColor" strokeWidth="0.5" />
            <line x1="0.8" y1="-4" x2="0.8" y2="-1.6" stroke="currentColor" strokeWidth="0.5" />
          </g>
          <g transform="translate(1.8,0)">
            <path d="M 0,-4 Q 1.4,-3.4 1.4,-1.6 Q 1.4,-0.4 0,0 L 0,4" fill="none" stroke="currentColor" strokeWidth="0.6" />
          </g>
        </>
      );
    case "cafe":
      return (
        <>
          <rect x="-3" y="-1.6" width="5" height="3.6" rx="0.3" />
          <path d="M 2,-1 Q 4,-1 4,0.4 Q 4,1.8 2,1.8" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <path d="M -2,-2.6 Q -1.6,-3.4 -1,-2.6" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.7" />
          <path d="M -0.4,-2.6 Q 0,-3.4 0.6,-2.6" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.7" />
        </>
      );
    case "bakery":
      return (
        <>
          <path d="M -3.4,1.6 Q -3.4,-1.6 0,-2.2 Q 3.4,-1.6 3.4,1.6 Z" />
          <line x1="-3.4" y1="1.6" x2="3.4" y2="1.6" stroke="currentColor" strokeWidth="0.5" />
          <circle cx="-1.2" cy="-0.4" r="0.5" fill="#fff" opacity="0.6" />
          <circle cx="0.8" cy="0.2" r="0.5" fill="#fff" opacity="0.6" />
        </>
      );
    case "hotel":
      return (
        <>
          <rect x="-4" y="-1.4" width="8" height="4.4" rx="0.4" />
          <circle cx="-2" cy="-2.6" r="1" fill="currentColor" />
          <rect x="-4" y="1.2" width="8" height="1.6" opacity="0.7" />
        </>
      );
    case "pharmacy":
      return (
        <>
          <rect x="-3.6" y="-3.6" width="7.2" height="7.2" rx="0.6" />
          <rect x="-0.7" y="-2.4" width="1.4" height="4.8" fill="#fff" />
          <rect x="-2.4" y="-0.7" width="4.8" height="1.4" fill="#fff" />
        </>
      );
    case "gasstation":
      return (
        <>
          <rect x="-3.4" y="-2.6" width="4.4" height="6.6" />
          <rect x="-2.6" y="-1.8" width="2.8" height="2" fill="#fff" opacity="0.4" />
          <path d="M 1.4,-1.6 L 3,-0.4 L 3,2.6 Q 3,3.4 2.2,3.4 Q 1.4,3.4 1.4,2.6 L 1.4,1.2 L 1,1.2 L 1,4 L 1.4,4" fill="none" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" />
        </>
      );
    case "bank":
      return (
        <>
          {columnsBuilding("0,-4 3,-1.8 -3,-1.8")}
          <text x="0" y="1.2" fontSize="2.6" textAnchor="middle" fill="#fff" fontWeight="700" fontFamily="sans-serif">
            $
          </text>
        </>
      );
    case "factory":
      return (
        <>
          <rect x="-4" y="0.4" width="8" height="3.4" />
          <polygon points="-4,0.4 -4,-2 -2,-0.4 -2,-2.6 0,-1 0,-3 2,-1.4 2,0.4" />
          <rect x="1.4" y="-4.6" width="1" height="2.4" />
        </>
      );
    case "office":
      return (
        <>
          <rect x="-3" y="-4" width="2" height="8" />
          <rect x="-0.8" y="-5.5" width="2" height="9.5" />
          <rect x="1.4" y="-3" width="2" height="7" />
        </>
      );
    case "skyscraper":
      return (
        <>
          <rect x="-1.6" y="-6.4" width="3.2" height="10.4" />
          {[-5, -3.4, -1.8, -0.2, 1.4, 3].map((y, i) => (
            <rect key={i} x="-1" y={y} width="0.8" height="1" fill="#fff" opacity="0.4" />
          ))}
          <polygon points="0,-6.4 -1.6,-5 1.6,-5" opacity="0.85" />
        </>
      );
    case "warehouse":
      return (
        <>
          <rect x="-4.4" y="0" width="8.8" height="3.6" />
          <polygon points="-4.8,0 0,-2.6 4.8,0" />
          <rect x="-3.4" y="1.2" width="2" height="2.4" fill="#fff" opacity="0.35" />
          <rect x="1.4" y="1.2" width="2" height="2.4" fill="#fff" opacity="0.35" />
        </>
      );
    case "powerplant":
      return (
        <>
          <path d="M -3.6,3.4 Q -3.6,-1 -1.6,-1 Q -1.6,-3.2 0,-3.2 Q 1.6,-3.2 1.6,-1 Q 3.6,-1 3.6,3.4 Z" />
          <line x1="1.6" y1="-1" x2="1.6" y2="-3.4" stroke="currentColor" strokeWidth="0.5" />
          <line x1="2.6" y1="-1.6" x2="2.6" y2="-4" stroke="currentColor" strokeWidth="0.5" opacity="0.7" />
        </>
      );
    case "mine":
      return (
        <>
          <path d="M -3.6,3.4 L -1.6,-2 L 1.6,-2 L 3.6,3.4 Z" />
          <polygon points="-1.6,-2 0,-4.4 1.6,-2" fill="#fff" opacity="0.3" />
          <rect x="-0.9" y="0.4" width="1.8" height="3" fill="#fff" opacity="0.2" />
        </>
      );

    // ---- Recreation ----
    case "stadium":
      return (
        <>
          <ellipse cx="0" cy="0" rx="5" ry="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <ellipse cx="0" cy="0" rx="2.6" ry="1.6" opacity="0.5" />
        </>
      );
    case "arena":
      return (
        <>
          <ellipse cx="0" cy="0.6" rx="4.6" ry="3" />
          <ellipse cx="0" cy="0.2" rx="4.6" ry="3" fill="none" stroke="#fff" strokeWidth="0.3" opacity="0.5" />
        </>
      );
    case "museum":
      return columnsBuilding("0,-4.2 3.4,-1.6 -3.4,-1.6");
    case "amusementpark":
      return (
        <>
          <circle cx="0" cy="0" r="4.4" fill="none" stroke="currentColor" strokeWidth="0.7" />
          <circle cx="0" cy="0" r="0.5" />
          {[0, 60, 120, 180, 240, 300].map((deg, i) => (
            <circle key={i} cx={4.4 * Math.cos((deg * Math.PI) / 180)} cy={4.4 * Math.sin((deg * Math.PI) / 180)} r="0.7" />
          ))}
          <line x1="0" y1="0" x2="0" y2="4.6" stroke="currentColor" strokeWidth="0.5" />
        </>
      );
    case "garden":
      return (
        <>
          <ellipse cx="0" cy="0" rx="4.2" ry="3" opacity="0.5" />
          {[
            [-2, -0.6],
            [0, 0.4],
            [2.2, -0.4],
          ].map(([dx, dy], i) => (
            <g key={i} transform={`translate(${dx}, ${dy})`}>
              <circle r="0.9" />
              {[0, 72, 144, 216, 288].map((deg, j) => (
                <ellipse key={j} cx={Math.cos((deg * Math.PI) / 180) * 1.1} cy={Math.sin((deg * Math.PI) / 180) * 1.1} rx="0.55" ry="0.3" transform={`rotate(${deg} ${Math.cos((deg * Math.PI) / 180) * 1.1} ${Math.sin((deg * Math.PI) / 180) * 1.1})`} opacity="0.85" />
              ))}
            </g>
          ))}
        </>
      );
    case "casino":
      return (
        <>
          <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="1.1" />
          {[
            [-1.4, -1.4],
            [1.4, -1.4],
            [0, 0],
            [-1.4, 1.4],
            [1.4, 1.4],
          ].map(([dx, dy], i) => (
            <circle key={i} cx={dx} cy={dy} r="0.55" fill="#fff" />
          ))}
        </>
      );
    case "theater":
      return (
        <>
          <path d="M -4,-3 Q 0,-4.6 4,-3 L 4,-2 Q 0,-3.4 -4,-2 Z" />
          <path d="M -3.4,-1.8 Q -1.6,0.4 -3.4,3.4" fill="none" stroke="currentColor" strokeWidth="0.9" />
          <path d="M 3.4,-1.8 Q 1.6,0.4 3.4,3.4" fill="none" stroke="currentColor" strokeWidth="0.9" />
        </>
      );
    case "zoo":
      return (
        <>
          <ellipse cx="0" cy="0.6" rx="2.2" ry="1.8" />
          <circle cx="-1.6" cy="-1.4" r="0.9" />
          <circle cx="1.6" cy="-1.4" r="0.9" />
          <circle cx="-0.9" cy="0.6" r="0.55" />
          <circle cx="0.9" cy="0.6" r="0.55" />
        </>
      );
    case "playground":
      return (
        <>
          <line x1="-3" y1="-3.6" x2="-3" y2="3" stroke="currentColor" strokeWidth="0.7" />
          <line x1="3" y1="-3.6" x2="3" y2="3" stroke="currentColor" strokeWidth="0.7" />
          <line x1="-3" y1="-3.6" x2="3" y2="-3.6" stroke="currentColor" strokeWidth="0.7" />
          <line x1="-1.4" y1="-3.6" x2="-1.4" y2="1.4" stroke="currentColor" strokeWidth="0.5" />
          <line x1="1.4" y1="-3.6" x2="1.4" y2="1.4" stroke="currentColor" strokeWidth="0.5" />
          <line x1="-1.4" y1="1.4" x2="1.4" y2="1.4" stroke="currentColor" strokeWidth="0.5" />
        </>
      );
    case "pool":
      return (
        <>
          <rect x="-4.4" y="-2.6" width="8.8" height="5.2" rx="1" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <path d="M -3.4,-0.4 Q -2.4,0.6 -1.4,-0.4 T 0.6,-0.4 T 2.6,-0.4 T 4,-0.4" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" />
          <path d="M -3.4,1.2 Q -2.4,2.2 -1.4,1.2 T 0.6,1.2 T 2.6,1.2 T 4,1.2" fill="none" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" />
        </>
      );
    case "monument":
      return (
        <>
          <polygon points="0,-5 1.4,-2.6 -1.4,-2.6" />
          <rect x="-1.4" y="-2.6" width="2.8" height="6.6" />
          <rect x="-2.2" y="4" width="4.4" height="0.8" />
        </>
      );
    case "campsite":
      return (
        <>
          <polygon points="0,-4.2 3.6,3 -3.6,3" />
          <polygon points="0,-4.2 1.6,3 -1.6,3" opacity="0.6" />
          <line x1="0" y1="-4.2" x2="0" y2="3" stroke="currentColor" strokeWidth="0.35" />
        </>
      );
    case "golfcourse":
      return (
        <>
          <line x1="-2.4" y1="4" x2="-2.4" y2="-4.6" stroke="currentColor" strokeWidth="0.5" />
          <polygon points="-2.4,-4.6 2.6,-3.2 -2.4,-1.8" />
          <ellipse cx="1.6" cy="3.6" rx="3.2" ry="0.9" opacity="0.4" />
        </>
      );
    case "aquarium":
      return (
        <>
          <rect x="-4.4" y="-3" width="8.8" height="6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <path d="M -1.4,0 Q -2.6,-1 -3.4,0 Q -2.6,1 -1.4,0 Z" />
          <polygon points="-1.4,0 -0.4,-0.8 -0.4,0.8" />
          <circle cx="1.8" cy="-1" r="0.35" opacity="0.7" />
          <circle cx="2.6" cy="0.6" r="0.35" opacity="0.7" />
          <circle cx="1.2" cy="1.4" r="0.35" opacity="0.7" />
        </>
      );
    case "circus":
      return (
        <>
          <polygon points="0,-4.6 3.4,3 -3.4,3" />
          {[-2.3, -0.8, 0.8, 2.3].map((x, i) => (
            <line key={i} x1={x} y1={3 - (Math.abs(x) / 3.4) * 7.6} x2={-x * 0.15} y2={3} stroke="#fff" strokeWidth="0.35" opacity="0.6" />
          ))}
          <circle cx="0" cy="-4.6" r="0.5" />
        </>
      );
    case "skatepark":
      return (
        <>
          <path d="M -4.4,3 Q -4.4,-3.4 1,-3.4 L 4.4,-3.4 L 4.4,0 Q 0,0 -1.4,3 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        </>
      );

    // ---- Rural ----
    case "farm":
      return (
        <>
          <rect x="-2.4" y="0.6" width="4.4" height="2.8" />
          <polygon points="-2.8,0.6 -0.2,-1.8 2.4,0.6" />
          <rect x="2" y="-0.6" width="2.4" height="3.2" opacity="0.85" />
          <polygon points="1.8,-0.6 3.2,-2 4.6,-0.6" opacity="0.85" />
        </>
      );
    case "farmland":
      return (
        <>
          {[-3, -1, 1, 3].map((x, i) => (
            <rect key={i} x={x - 0.7} y="-3.6" width="1.4" height="7.2" opacity={i % 2 ? 0.5 : 0.9} />
          ))}
        </>
      );
    case "vineyard":
      return (
        <>
          {[-3, -1, 1, 3].map((x, i) => (
            <g key={i}>
              <line x1={x} y1="-3.4" x2={x} y2="3.4" stroke="currentColor" strokeWidth="0.4" />
              {[-2.2, -0.6, 1, 2.6].map((y, j) => (
                <circle key={j} cx={x} cy={y} r="0.4" />
              ))}
            </g>
          ))}
        </>
      );
    case "windmill":
      return (
        <>
          <rect x="-0.6" y="-1" width="1.2" height="5" />
          <polygon points="-0.6,-1 -3,-1.6 -0.6,0.4" />
          <polygon points="0.6,-1 3,-0.4 0.6,0.4" />
          <polygon points="-0.6,-1 -1.2,-3.4 0.6,-1" />
          <circle cx="0" cy="-1" r="0.5" />
        </>
      );
    case "house":
      return (
        <>
          <rect x="-2.4" y="-0.2" width="4.8" height="3.4" />
          <polygon points="-3,-0.2 0,-3 3,-0.2" />
          <rect x="-0.7" y="1" width="1.4" height="2.2" fill="#fff" opacity="0.4" />
        </>
      );
    case "apartment":
      return (
        <>
          <rect x="-3.4" y="-4.4" width="6.8" height="8.4" />
          {[-2.2, 0, 2.2].map((x, i) => (
            <g key={i}>
              <rect x={x - 0.6} y="-3.2" width="1.2" height="1.2" fill="#fff" opacity="0.4" />
              <rect x={x - 0.6} y="-0.6" width="1.2" height="1.2" fill="#fff" opacity="0.4" />
              <rect x={x - 0.6} y="2" width="1.2" height="1.2" fill="#fff" opacity="0.4" />
            </g>
          ))}
        </>
      );
    case "village":
      return (
        <>
          <g transform="translate(-2.2, 0.6)">
            <rect x="-1.6" y="0" width="3.2" height="2.4" />
            <polygon points="-2,0 0,-2 2,0" />
          </g>
          <g transform="translate(2, -0.4)">
            <rect x="-1.4" y="0" width="2.8" height="3" />
            <polygon points="-1.8,0 0,-2.2 1.8,0" />
          </g>
        </>
      );
    case "suburb":
      return (
        <>
          <g transform="translate(-2.4, 0.4)">
            <rect x="-1.4" y="0" width="2.8" height="2.4" />
            <polygon points="-1.8,0 0,-1.8 1.8,0" />
          </g>
          <g transform="translate(0.6, 0.8)">
            <rect x="-1.4" y="0" width="2.8" height="2" />
            <polygon points="-1.8,0 0,-1.6 1.8,0" />
          </g>
          <g transform="translate(3.6, 0.4)">
            <rect x="-1.4" y="0" width="2.8" height="2.4" />
            <polygon points="-1.8,0 0,-1.8 1.8,0" />
          </g>
        </>
      );

    // ---- Symbols ----
    case "star":
      return <polygon points="0,-4 1.1,-1.2 4,-1.2 1.7,0.6 2.6,3.6 0,1.8 -2.6,3.6 -1.7,0.6 -4,-1.2 -1.1,-1.2" />;
    case "flag":
      return (
        <>
          <rect x="-0.3" y="-4" width="0.6" height="8" />
          <polygon points="0.3,-4 4,-2.8 0.3,-1.6" />
        </>
      );
    case "pin":
      return <path d="M 0,4.4 C -2.6,1 -3.6,-0.8 -3.6,-2.4 C -3.6,-4.5 -2,-6 0,-6 C 2,-6 3.6,-4.5 3.6,-2.4 C 3.6,-0.8 2.6,1 0,4.4 Z M 0,-2.4 m -1.4,0 a 1.4,1.4 0 1,0 2.8,0 a 1.4,1.4 0 1,0 -2.8,0" fillRule="evenodd" />;
    case "cross":
      return (
        <>
          <rect x="-1" y="-4" width="2" height="8" rx="0.4" />
          <rect x="-4" y="-1" width="8" height="2" rx="0.4" />
        </>
      );
    case "crown":
      return (
        <>
          <polygon points="-4,2 -4,-1.2 -2,0.6 0,-2.4 2,0.6 4,-1.2 4,2" />
          <rect x="-4" y="2" width="8" height="1" />
        </>
      );
    case "anchor":
      return (
        <>
          <circle cx="0" cy="-3.2" r="1" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <line x1="0" y1="-2.2" x2="0" y2="3.6" stroke="currentColor" strokeWidth="0.7" />
          <path d="M -3.2,0.6 Q 0,4.6 3.2,0.6" fill="none" stroke="currentColor" strokeWidth="0.7" />
          <line x1="-2" y1="-0.6" x2="2" y2="-0.6" stroke="currentColor" strokeWidth="0.6" />
        </>
      );
    case "compass":
      return (
        <>
          <circle cx="0" cy="0" r="4.4" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <polygon points="0,-3.6 0.8,0 0,3.6 -0.8,0" opacity="0.9" />
          <polygon points="-3.6,0 0,0.8 3.6,0 0,-0.8" opacity="0.6" />
        </>
      );
    case "heart":
      return (
        <path d="M 0,3.6 C -4.6,0.4 -4.8,-2.6 -2.4,-3.6 C -0.9,-4.2 0,-3 0,-2 C 0,-3 0.9,-4.2 2.4,-3.6 C 4.8,-2.6 4.6,0.4 0,3.6 Z" />
      );
    case "trophy":
      return (
        <>
          <path d="M -2.4,-3.4 L 2.4,-3.4 L 2,-0.4 Q 1.8,1.4 0,1.6 Q -1.8,1.4 -2,-0.4 Z" />
          <path d="M -2.4,-3 Q -4.4,-3 -4.2,-1.2 Q -4,0.2 -2.2,0" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <path d="M 2.4,-3 Q 4.4,-3 4.2,-1.2 Q 4,0.2 2.2,0" fill="none" stroke="currentColor" strokeWidth="0.5" />
          <rect x="-0.6" y="1.6" width="1.2" height="1.4" />
          <rect x="-1.8" y="3" width="3.6" height="0.9" />
        </>
      );
    case "gem":
      return (
        <>
          <polygon points="0,-3.6 3.6,-1 2,3 -2,3 -3.6,-1" />
          <polygon points="0,-3.6 1.8,-1 0,3 -1.8,-1" fill="#fff" opacity="0.25" />
        </>
      );
    case "key":
      return (
        <>
          <circle cx="-2.6" cy="0" r="1.8" fill="none" stroke="currentColor" strokeWidth="1" />
          <line x1="-1" y1="0" x2="4.2" y2="0" stroke="currentColor" strokeWidth="0.9" />
          <line x1="2.6" y1="0" x2="2.6" y2="1.6" stroke="currentColor" strokeWidth="0.9" />
          <line x1="4.2" y1="0" x2="4.2" y2="1.6" stroke="currentColor" strokeWidth="0.9" />
        </>
      );
    case "lightbulb":
      return (
        <>
          <circle cx="0" cy="-1" r="3" />
          <rect x="-1.2" y="1.6" width="2.4" height="1.6" rx="0.3" />
          <line x1="-1" y1="3.4" x2="1" y2="3.4" stroke="currentColor" strokeWidth="0.5" />
        </>
      );
    case "shield":
      return <path d="M 0,-4 L 3.4,-2.6 L 3.4,0.4 Q 3.4,3 0,4.4 Q -3.4,3 -3.4,0.4 L -3.4,-2.6 Z" />;
    case "medal":
      return (
        <>
          <polygon points="-2,-4.4 -0.8,-1.4 -3.2,-1.4" />
          <polygon points="2,-4.4 0.8,-1.4 3.2,-1.4" />
          <circle cx="0" cy="1.2" r="3" />
          <circle cx="0" cy="1.2" r="1.8" fill="none" stroke="#fff" strokeWidth="0.4" opacity="0.6" />
        </>
      );
    case "gift":
      return (
        <>
          <rect x="-3" y="-0.8" width="6" height="4.4" />
          <rect x="-3.4" y="-1.8" width="6.8" height="1.4" />
          <rect x="-0.6" y="-1.8" width="1.2" height="5.4" fill="#fff" opacity="0.4" />
          <path d="M 0,-1.8 Q -2.4,-1.8 -2,-3.4 Q -1.6,-4.4 0,-1.8 Z" />
          <path d="M 0,-1.8 Q 2.4,-1.8 2,-3.4 Q 1.6,-4.4 0,-1.8 Z" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="0" cy="0" r="4.2" fill="none" stroke="currentColor" strokeWidth="0.9" />
          <line x1="0" y1="0" x2="0" y2="-2.4" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" />
          <line x1="0" y1="0" x2="1.8" y2="0.6" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" />
        </>
      );
    default:
      return <circle cx="0" cy="0" r="2" />;
  }
}
