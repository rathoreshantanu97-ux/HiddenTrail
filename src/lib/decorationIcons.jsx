// ---------------------------------------------------------------------------
// DECORATION ICONS — a built-in library of generic vector icons an admin
// can drop onto a map for beautification (landmarks, nature, civic
// buildings, transport, commerce, recreation, symbols), separate from
// MapBackground.jsx's bespoke, hand-positioned real-landmark art. These
// are generic on purpose: they're meant to be placed ANYWHERE by an admin
// with no code access, so they can't be tied to one specific real
// building the way MapBackground's icons are.
//
// Expanded to ~48 icons across 7 categories specifically because custom
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
  Nature: ["water", "lake", "river", "mountain", "hill", "forest", "tree", "palm"],
  Civic: ["landmark", "school", "hospital", "police", "firestation", "church", "temple", "courthouse", "library", "prison"],
  Transport: ["bus", "train", "airport", "port", "parking", "bridge", "subway", "road"],
  Commerce: ["shop", "mall", "market", "restaurant", "hotel", "bank", "factory", "office"],
  Recreation: ["stadium", "museum", "theater", "zoo", "playground", "pool", "monument", "campsite"],
  Symbols: ["star", "flag", "pin", "cross", "crown", "anchor", "compass", "heart"],
};

export const ICON_LIBRARY = Object.values(ICON_CATEGORIES).flat();

export const ICON_LABELS = {
  water: "Water",
  lake: "Lake",
  river: "River",
  mountain: "Mountain",
  hill: "Hill",
  forest: "Forest",
  tree: "Tree",
  palm: "Palm tree",
  landmark: "Landmark",
  school: "School",
  hospital: "Hospital",
  police: "Police",
  firestation: "Fire station",
  church: "Church",
  temple: "Temple",
  courthouse: "Courthouse",
  library: "Library",
  prison: "Prison",
  bus: "Bus stop",
  train: "Train station",
  airport: "Airport",
  port: "Port / dock",
  parking: "Parking",
  bridge: "Bridge",
  subway: "Subway",
  road: "Road",
  shop: "Shop",
  mall: "Mall",
  market: "Market",
  restaurant: "Restaurant",
  hotel: "Hotel",
  bank: "Bank",
  factory: "Factory",
  office: "Office",
  stadium: "Stadium",
  museum: "Museum",
  theater: "Theater",
  zoo: "Zoo",
  playground: "Playground",
  pool: "Pool",
  monument: "Monument",
  campsite: "Campsite",
  star: "Star",
  flag: "Flag",
  pin: "Pin",
  cross: "Cross",
  crown: "Crown",
  anchor: "Anchor",
  compass: "Compass",
  heart: "Heart",
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

    // ---- Civic ----
    case "landmark":
      return columnsBuilding("0,-4 2.2,-2 -2.2,-2");
    case "school":
      return mortarboard();
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
    case "hotel":
      return (
        <>
          <rect x="-4" y="-1.4" width="8" height="4.4" rx="0.4" />
          <circle cx="-2" cy="-2.6" r="1" fill="currentColor" />
          <rect x="-4" y="1.2" width="8" height="1.6" opacity="0.7" />
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

    // ---- Recreation ----
    case "stadium":
      return (
        <>
          <ellipse cx="0" cy="0" rx="5" ry="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <ellipse cx="0" cy="0" rx="2.6" ry="1.6" opacity="0.5" />
        </>
      );
    case "museum":
      return columnsBuilding("0,-4.2 3.4,-1.6 -3.4,-1.6");
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
    default:
      return <circle cx="0" cy="0" r="2" />;
  }
}
