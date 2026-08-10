// ---------------------------------------------------------------------------
// DECORATION ICONS — a small built-in library of generic vector icons an
// admin can drop onto a map for beautification (landmarks, water, parks,
// civic buildings, etc.), separate from MapBackground.jsx's bespoke,
// hand-positioned real-landmark art. These are generic on purpose: they're
// meant to be placed ANYWHERE by an admin with no code access, so they
// can't be tied to one specific real building the way MapBackground's
// icons are.
//
// Each icon is a pure function (name) -> SVG child elements, sized to
// roughly fit a 10x10 box centered on the origin -- the caller just wraps
// it in <g transform="translate(x,y) rotate(deg) scale(size/10)"
// fill={color}"> so placing/resizing/rotating/coloring is all one
// transform + one fill, not per-icon logic.
// ---------------------------------------------------------------------------

export const ICON_LIBRARY = [
  "landmark",
  "water",
  "park",
  "tree",
  "school",
  "bus",
  "police",
  "fort",
  "airport",
  "building",
  "star",
  "flag",
];

export const ICON_LABELS = {
  landmark: "Landmark",
  water: "Water",
  park: "Park",
  tree: "Tree",
  school: "School",
  bus: "Bus stop",
  police: "Police",
  fort: "Fort / tower",
  airport: "Airport",
  building: "Building",
  star: "Star",
  flag: "Flag",
};

export function renderIconPaths(name) {
  switch (name) {
    case "landmark":
      return (
        <>
          <rect x="-3" y="0" width="6" height="1.8" />
          <rect x="-3.4" y="1.6" width="6.8" height="0.5" />
          {[-2.4, -1.2, 0, 1.2, 2.4].map((dx, i) => (
            <rect key={i} x={dx - 0.15} y={-0.4} width="0.3" height="1.4" />
          ))}
          <circle cx="0" cy="-1.1" r="1.1" />
        </>
      );
    case "water":
      return <ellipse cx="0" cy="0" rx="4.5" ry="3" />;
    case "park":
      return <ellipse cx="0" cy="0" rx="4" ry="3" />;
    case "tree":
      return (
        <>
          <circle cx="0" cy="-1.2" r="2.4" />
          <rect x="-0.4" y="1" width="0.8" height="2" />
        </>
      );
    case "school":
      return (
        <>
          <polygon points="0,-2.6 5,0 0,2.6 -5,0" />
          <rect x="-0.4" y="0" width="0.8" height="3.6" />
          <circle cx="0" cy="3.8" r="0.55" />
        </>
      );
    case "bus":
      return (
        <>
          <rect x="-3.2" y="-1.4" width="6.4" height="2.8" rx="0.5" />
          <circle cx="-2" cy="1.6" r="0.7" />
          <circle cx="2" cy="1.6" r="0.7" />
        </>
      );
    case "police":
      return <path d="M 0,-3 L 3,-1.8 L 3,1.2 Q 3,3.3 0,4.5 Q -3,3.3 -3,1.2 L -3,-1.8 Z" />;
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
    case "airport":
      return (
        <path d="M 0 -3 L 0.7 2 L 3.8 3.8 L 3.8 4.7 L 0.55 3.8 L 0.75 5.8 L 2 6.7 L 2 7.5 L 0 6.8 L -2 7.5 L -2 6.7 L -0.75 5.8 L -0.55 3.8 L -3.8 4.7 L -3.8 3.8 L -0.7 2 Z" />
      );
    case "building":
      return (
        <>
          <rect x="-3" y="-4" width="2" height="8" />
          <rect x="-0.8" y="-5.5" width="2" height="9.5" />
          <rect x="1.4" y="-3" width="2" height="7" />
        </>
      );
    case "star":
      return <polygon points="0,-4 1.1,-1.2 4,-1.2 1.7,0.6 2.6,3.6 0,1.8 -2.6,3.6 -1.7,0.6 -4,-1.2 -1.1,-1.2" />;
    case "flag":
      return (
        <>
          <rect x="-0.3" y="-4" width="0.6" height="8" />
          <polygon points="0.3,-4 4,-2.8 0.3,-1.6" />
        </>
      );
    default:
      return <circle cx="0" cy="0" r="2" />;
  }
}
