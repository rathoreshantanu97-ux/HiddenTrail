import React from "react";

// ---------------------------------------------------------------------------
// MAP BACKGROUND — reads generically from `map.background` instead of the
// old `if (activeMapId === "westeros") ... else if (activeMapId ===
// "bengaluru") ...` chain. Adding a new map's background art means adding
// one new `case` here (or, for a quick start, just using theme: "plain"
// with a custom fill color and skipping this file entirely).
//
// map.background shape (see mapSchema.js for the full contract):
//   { kind: "plain" }                                  -> flat parchment/fill
//   { kind: "citymap", theme: "bengaluru" }             -> Google-Maps style
//   { kind: "regions", regionHulls, theme: "westeros" } -> illustrated regions
//
// `theme` is just a lookup key into the art below — it's fine for two maps
// of the same `kind` to have completely different art by using different
// `theme` values (e.g. a second real-city map would add its own `case`
// alongside "bengaluru" inside the "citymap" kind, or its own top-level
// kind if the art is different enough to not share layout logic).
// ---------------------------------------------------------------------------

export default function MapBackground({ map }) {
  const bg = map.background || { kind: "plain" };
  const w = map.viewW;
  const h = map.viewH;

  if (bg.kind === "regions" && bg.theme === "westeros") {
    const hulls = bg.regionHulls;
    return (
      <g>
        {/* Westeros: hand-drawn region hulls (derived from each region's
            actual station cluster), so the map keeps proper node spacing
            while still reading as a real illustrated continent. */}
        <rect x="0" y="0" width={w} height={h} fill="url(#seaGrad)" />

        <path d={hulls.north} fill="#e4ecf0" opacity="0.95" filter="url(#regionShadow)" />
        <path d={hulls.riverlands} fill="#dce8d5" opacity="0.95" filter="url(#regionShadow)" />
        <path d={hulls.vale} fill="#d8ddd2" opacity="0.9" filter="url(#regionShadow)" />
        <path d={hulls.westerlands} fill="#ecdfb8" opacity="0.95" filter="url(#regionShadow)" />
        <path d={hulls.crownlands} fill="#e6e2c8" opacity="0.95" filter="url(#regionShadow)" />
        <path d={hulls.reach} fill="#cde3c2" opacity="0.95" filter="url(#regionShadow)" />
        <path d={hulls.stormlands} fill="#d7e6cf" opacity="0.9" filter="url(#regionShadow)" />
        <path d={hulls.dorne} fill="#e8d3a0" opacity="0.95" filter="url(#regionShadow)" />
        <path d={hulls.essos} fill="#e8ddc3" opacity="0.9" filter="url(#regionShadow)" />

        {/* River system through the Riverlands */}
        <g stroke="#4a7a95" strokeWidth="0.5" fill="none" opacity="0.55">
          <path d="M 20 30 Q 30 38 40 42 T 65 46" />
          <path d="M 45 30 Q 48 38 46 46" />
          <path d="M 70 36 Q 65 42 60 46" />
        </g>

        <text x="50" y="14" fontSize="2.6" textAnchor="middle" fill="#7b8fa1" fontWeight="700" opacity="0.55" letterSpacing="0.5">THE NORTH</text>
        <text x="45" y="40" fontSize="2.2" textAnchor="middle" fill="#6e8f5e" fontWeight="700" opacity="0.5" letterSpacing="0.4">THE RIVERLANDS</text>
        <text x="86" y="34" fontSize="1.8" textAnchor="middle" fill="#7d8570" fontWeight="700" opacity="0.5" letterSpacing="0.3">THE VALE</text>
        <text x="16" y="58" fontSize="1.7" textAnchor="middle" fill="#a08c4a" fontWeight="700" opacity="0.55" letterSpacing="0.3">WESTERLANDS</text>
        <text x="52" y="63" fontSize="1.5" textAnchor="middle" fill="#8a6a1f" fontWeight="700" opacity="0.5" letterSpacing="0.3">CROWNLANDS</text>
        <text x="30" y="86" fontSize="2.2" textAnchor="middle" fill="#5a8c4a" fontWeight="700" opacity="0.5" letterSpacing="0.4">THE REACH</text>
        <text x="62" y="82" fontSize="1.6" textAnchor="middle" fill="#6e8f5e" fontWeight="700" opacity="0.5" letterSpacing="0.3">STORMLANDS</text>
        <text x="48" y="112" fontSize="2.4" textAnchor="middle" fill="#b8863a" fontWeight="700" opacity="0.55" letterSpacing="0.5">DORNE</text>
        <text x="88" y="66" fontSize="1.8" textAnchor="middle" fill="#a08c4a" fontWeight="700" opacity="0.5" letterSpacing="0.3">ESSOS</text>
      </g>
    );
  }

  if (bg.kind === "citymap" && bg.theme === "bengaluru") {
    // Bengaluru — the primary city map (90 stations, renumbered 1-90,
    // as of the "Hidden Trail" rebrand pass). Every icon below is placed
    // at the ACTUAL current coordinates of its named station -- verified
    // against the live map data, not carried over from any earlier
    // station layout. viewBox is 126 x 102 (see bengaluru.js).
    return (
      <>
        {/* Base fill extended well beyond the map's own 0,0-126,102
            coordinate bounds (to -10,-10 through 146,122) so it also
            covers the small EDGE_MARGIN strip GameBoard.jsx adds around
            the viewBox for label/Airport clearance -- without this, that
            margin strip had NO fill of its own and fell through to
            whatever's behind the SVG (the page background), which read
            as a visible white/mismatched seam around the map's actual
            drawn area. 10 units of overshoot is comfortably more than
            the current margin values (6 top, 0.5 other sides) need, so
            this stays correct even if those constants change later. */}
        {/* Final palette redesign from first principles -- background,
            water, and park colors chosen together as one coherent set,
            alongside the route colors in mapSchema.js (see that file's
            comment for the full reasoning: contrast math, hue-distance
            checks between taxi/bus/metro, colorblind-safe luminance
            separation, and saturation pushed as high as each contrast
            budget allowed). Warm parchment background (#ece3d0) sits
            reliably lighter than every other element on the map, so it
            never competes for attention regardless of what's drawn on
            top of it. */}
        {/* Final palette redesign from first principles -- background,
            water, and park colors chosen together as one coherent set,
            alongside the route colors in mapSchema.js (see that file's
            comment for the full reasoning: contrast math, hue-distance
            checks between taxi/bus/metro, colorblind-safe luminance
            separation, and saturation pushed as high as each contrast
            budget allowed). Lightened further to #f6f1e5 (from #ece3d0)
            after finding a REAL gap in the earlier verification: taxi's
            route lines render at reduced opacity when zoomed out (a
            separate fade mechanism, see taxiFadeOpacity in
            GameBoard.jsx), and checking the actual RENDERED/blended
            color (not just the pure swatch) showed effective contrast
            was only ~1.73:1 at the old background + old 0.5 opacity --
            well below what the swatch-only check suggested. Lightening
            the background genuinely helps here (confirmed by testing,
            unlike darkening it, which was tried earlier and made things
            WORSE by converging toward taxi's own mid-brightness color)
            since it pushes the background further from taxi's dark
            luminance in the correct direction. Combined with raising
            taxi's opacity to 0.85, effective contrast is now ~2.97:1. */}
        <rect x="-10" y="-10" width="146" height="122" fill="#f6f1e5" />

        {/* Rural Lake -- station #86 @ (84.4, 8.85) */}
        <ellipse cx="84.4" cy="8.5" rx="4.5" ry="3" fill="url(#lakeGrad)" opacity="0.9" transform="rotate(10 84.4 8.5)" />

        {/* Small Lake -- station #87 @ (68.75, 6.25) */}
        <ellipse cx="68.75" cy="5.8" rx="3.5" ry="2.4" fill="url(#lakeGrad)" opacity="0.9" transform="rotate(-8 68.75 5.8)" />

        {/* Lalbagh -- garden, station #36 @ (49.06, 61.87). Icon only --
            the station's own name label already handles the text. */}
        <ellipse cx="49.06" cy="61.87" rx="5.5" ry="4" fill="#9dc48a" opacity="0.85" />

        {/* Nice Road Park -- station #55 @ (29.73, 92.16) */}
        <ellipse cx="29.73" cy="92.16" rx="5" ry="3.6" fill="#9dc48a" opacity="0.85" />

        {/* State Forest -- station #77 @ (42.34, 16.71) -- denser green
            texture (small clustered dots) to read as "forest" rather
            than a manicured park/garden. */}
        <g opacity="0.8">
          <ellipse cx="42.34" cy="16.71" rx="6" ry="4.5" fill="#8ab577" />
          {[[-3, -1.5], [-1, 1], [1.5, -1], [3, 1.5], [0, -2.5], [-2, 2]].map(([dx, dy], i) => (
            <circle key={i} cx={42.34 + dx} cy={16.71 + dy} r="0.6" fill="#5c8a4a" />
          ))}
        </g>

        {/* Bamboo Forest -- station #84 @ (78.12, 11.49) -- same forest
            texture language as State Forest, distinct from garden ellipses. */}
        <g opacity="0.8">
          <ellipse cx="78.12" cy="11.49" rx="5.5" ry="4" fill="#8ab577" />
          {[[-2.5, -1], [-0.8, 1.3], [1.5, -1.2], [2.8, 1]].map(([dx, dy], i) => (
            <circle key={i} cx={78.12 + dx} cy={11.49 + dy} r="0.6" fill="#5c8a4a" />
          ))}
        </g>

        {/* Botanical Garden -- station #83 @ (101.41, 33.19) */}
        <ellipse cx="101.41" cy="33.19" rx="5.5" ry="4" fill="#9dc48a" opacity="0.85" />

        {/* Vidhana Soudha -- real Indian legislative building, station
            #24 @ (48.59, 43.02). Domed-colonnade silhouette. Icon only. */}
        <g transform="translate(48.59, 40.5)">
          <rect x="-3" y="0" width="6" height="1.8" fill="#c9b98a" />
          <rect x="-3.4" y="1.6" width="6.8" height="0.5" fill="#a8926a" />
          {[-2.4, -1.2, 0, 1.2, 2.4].map((dx, i) => (
            <rect key={i} x={dx - 0.15} y={-0.4} width="0.3" height="1.4" fill="#8a7550" />
          ))}
          <circle cx="0" cy="-1.1" r="1.1" fill="#c9b98a" />
          <circle cx="0" cy="-2.0" r="0.25" fill="#8a7550" />
        </g>

        {/* Bengaluru Palace -- Tudor-style crenellated silhouette,
            station #25 @ (55.26, 34.3). Icon only. */}
        <g transform="translate(55.26, 32)">
          <rect x="-2.6" y="0" width="5.2" height="1.8" fill="#d8b98a" />
          {[-2.2, -1.1, 0, 1.1, 2.2].map((dx, i) => (
            <rect key={i} x={dx - 0.35} y={-0.7} width="0.7" height="0.9" fill="#d8b98a" />
          ))}
          <rect x="-0.9" y="-1.8" width="1.8" height="2.7" fill="#c2a476" />
          <polygon points="0,-3 -1,-1.8 1,-1.8" fill="#8a6d3a" />
        </g>

        {/* Kempegowda International Airport -- station #1 @ (65.74, -1.19),
            genuine northernmost point on the map. Airplane silhouette,
            icon only. */}
        <g transform="translate(65.74, -3.6) rotate(-30)">
          <path d="M 0 -2.2 L 0.5 1.5 L 2.8 2.8 L 2.8 3.5 L 0.4 2.8 L 0.55 4.3 L 1.5 5 L 1.5 5.6 L 0 5.1 L -1.5 5.6 L -1.5 5 L -0.55 4.3 L -0.4 2.8 L -2.8 3.5 L -2.8 2.8 L -0.5 1.5 Z"
                fill="#5c6066" />
        </g>

        {/* IISc -- academic institution, station #69 @ (46.46, 27.8).
            Graduation-cap/mortarboard silhouette. Icon only. */}
        <g transform="translate(46.46, 25.5)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* IIM Bangalore -- same academic-institution language as IISc,
            station #41 @ (62.65, 84.29). Icon only. */}
        <g transform="translate(62.65, 81.9)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* Christ University -- station #70 @ (18.39, 30.03) [repositioned
            during layout adjustments -- icon kept in sync with the
            station's actual current coordinates]. Same academic
            mortarboard language, groups all three institutes visually.
            Icon only. */}
        <g transform="translate(18.39, 27.7)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* IKEA Nagasandra -- retail/storefront icon, station #30 @
            (16.23, 19.84). Icon only. */}
        <g transform="translate(16.23, 17.6)">
          <rect x="-2.4" y="-0.2" width="4.8" height="2.4" fill="#2a5fa5" />
          <polygon points="-2.7,-0.2 0,-1.8 2.7,-0.2" fill="#1f4a85" />
          <rect x="-0.9" y="0.4" width="1.8" height="1.2" fill="#ffcc33" />
        </g>

        {/* Phoenix Mall -- station #8 @ (99, 39.21). Same retail-box
            language as IKEA, distinct color so the two don't read as
            the same store. Icon only. */}
        <g transform="translate(99, 36.8)">
          <rect x="-2.4" y="-0.2" width="4.8" height="2.4" fill="#a5522a" />
          <polygon points="-2.7,-0.2 0,-1.8 2.7,-0.2" fill="#853f1f" />
          <rect x="-0.9" y="0.4" width="1.8" height="1.2" fill="#ffcc33" />
        </g>

        {/* Manyata Tech Park -- office/tech campus, station #81 @
            (67.05, 19.4). Simplified glass-tower cluster. Icon only. */}
        <g transform="translate(67.05, 17.1)">
          <rect x="-2.2" y="-1.5" width="1.4" height="3.5" fill="#6b8caf" />
          <rect x="-0.6" y="-2.3" width="1.4" height="4.3" fill="#547599" />
          <rect x="1" y="-1" width="1.4" height="3" fill="#6b8caf" />
        </g>
      </>
    );
  }

  if (bg.kind === "citymap" && bg.theme === "city-of-sendhwa") {
    // City of Sendhwa: 86-station town map. NO river/water graphic (per
    // explicit request -- unlike the generic "plain" fallback, which
    // always includes one) -- just the base fill plus a small set of
    // real landmark icons and a fort boundary, all positioned using this
    // map's ACTUAL station coordinates (checked directly, not guessed).
    return (
      <>
        <rect x="-2" y="-2" width={w + 4} height={h + 4} fill="#ece3d0" />

        {/* Lake near Chhota GhatyaPatya -- station #80 @ (42.65, 11.6) */}
        <ellipse cx="42.65" cy="11.6" rx="5.5" ry="3.8" fill="url(#lakeGrad)" opacity="0.9" />

        {/* School icon (mortarboard) near New Lions -- station #3 @
            (20.16, 69.47). Icon only -- the station's own name label
            already handles the text. */}
        <g transform="translate(20.16, 66.8)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* School icon near Sendhwa Public School -- station #76 @
            (61.07, 15.51) */}
        <g transform="translate(61.07, 12.84)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* School icon near Raghuwansh Public School -- station #35 @
            (77.04, 93.31) */}
        <g transform="translate(77.04, 90.64)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* Bus icon near New Bus Stand -- station #10 @ (135.94, 58.4).
            A simple bus silhouette (body + windows + wheels), distinct
            from the school/civic icon language used elsewhere. */}
        <g transform="translate(135.94, 55.0)">
          <rect x="-2.6" y="-1.2" width="5.2" height="2.4" rx="0.4" fill="#3a6b8a" />
          <rect x="-2.1" y="-0.8" width="1.1" height="1" fill="#bcd6e6" />
          <rect x="-0.55" y="-0.8" width="1.1" height="1" fill="#bcd6e6" />
          <rect x="1" y="-0.8" width="1.1" height="1" fill="#bcd6e6" />
          <circle cx="-1.6" cy="1.3" r="0.5" fill="#2a2a2a" />
          <circle cx="1.6" cy="1.3" r="0.5" fill="#2a2a2a" />
        </g>

        {/* Police icon near Police Thana -- station #34 @ (109.4,
            68.41). A simple shield shape, standard civic/police
            language. */}
        <g transform="translate(109.4, 65.6)">
          <path d="M 0,-2 L 2,-1.2 L 2,0.8 Q 2,2.2 0,3 Q -2,2.2 -2,0.8 L -2,-1.2 Z" fill="#2f4a7a" />
          <path d="M 0,-1.3 L 1.3,-0.75 L 1.3,0.7 Q 1.3,1.6 0,2.2 Q -1.3,1.6 -1.3,0.7 L -1.3,-0.75 Z" fill="#4a6fa8" />
        </g>

        {/* Fort boundary -- a rectangle enclosing the cluster of stations
            that together represent the fort area (23, 58, 59, 57, 41,
            54, 13, 52). Bounding box of those stations' real
            coordinates is x:[98.36,130.94] y:[32.16,58.92] -- padded out
            further so the rectangle clearly contains all 8 nodes with
            genuine margin, not just barely touching the outermost ones. */}
        <rect
          x="93"
          y="26"
          width="43"
          height="38"
          rx="1.5"
          fill="none"
          stroke="#8a6a3a"
          strokeWidth="0.6"
          strokeDasharray="2,1.2"
          opacity="0.7"
        />
        {/* Fort icon -- crenellated tower silhouette, placed just above
            the boundary rectangle's top edge so it doesn't overlap any
            station inside it. */}
        <g transform="translate(114.5, 23)">
          <rect x="-3" y="0" width="6" height="2.2" fill="#a8926a" />
          {[-2.4, -1, 0.4, 1.8].map((dx, i) => (
            <rect key={i} x={dx} y={-0.8} width="0.9" height="1" fill="#a8926a" />
          ))}
          <rect x="-4" y="1.8" width="8" height="0.6" fill="#8a7550" />
          <polygon points="0,-2.2 -1.2,-0.8 1.2,-0.8" fill="#6b5636" />
        </g>
      </>
    );
  }


  // Default / "plain" — parchment base with soft district blobs and a river.
  // Used by city.js, and a reasonable fallback for any new map that hasn't
  // authored custom background art yet.
  return (
    <>
      <rect x="0" y="0" width={w} height={h} fill="#f3ecd9" />
      <circle cx="20" cy="25" r="17" fill="#ece2ca" opacity="0.6" />
      <circle cx="75" cy="20" r="15" fill="#ece2ca" opacity="0.6" />
      <circle cx="18" cy="70" r="16" fill="#e7e0c9" opacity="0.6" />
      <circle cx="80" cy="70" r="18" fill="#e7e0c9" opacity="0.6" />
      <circle cx="48" cy="55" r="20" fill="#eee5cd" opacity="0.5" />
      <path
        d="M -5 30 C 15 40, 25 45, 40 55 S 65 65, 80 60 S 100 50, 108 55"
        stroke="url(#riverGrad)"
        strokeWidth="5"
        fill="none"
        opacity="0.85"
      />
    </>
  );
}

// Decorative frame + compass rose, currently only used by the "regions"
// background kind (Westeros-style illustrated maps). Kept separate from
// MapBackground so a future "regions" map can opt out of the frame/compass
// if it doesn't fit the art style, by simply not rendering this component.
export function MapFrameAndCompass({ map }) {
  const w = map.viewW;
  const h = map.viewH;
  if (map.background?.kind !== "regions") return null;
  return (
    <>
      <rect
        x="0.6" y="0.6" width={w - 1.2} height={h - 1.2}
        fill="none" stroke="#8a6d3a" strokeWidth="0.6" opacity="0.35" rx="1.5"
      />
      <rect
        x="1.6" y="1.6" width={w - 3.2} height={h - 3.2}
        fill="none" stroke="#8a6d3a" strokeWidth="0.25" opacity="0.25" rx="1"
      />
      <g transform={`translate(9, ${h - 9})`} opacity="0.7">
        <circle r="5.5" fill="none" stroke="#6b5636" strokeWidth="0.3" />
        <circle r="3.6" fill="none" stroke="#6b5636" strokeWidth="0.18" />
        <polygon points="0,-5.2 0.7,0 0,5.2 -0.7,0" fill="#6b5636" opacity="0.85" />
        <polygon points="-5.2,0 0,0.7 5.2,0 0,-0.7" fill="#6b5636" opacity="0.6" />
        <text x="0" y="-6.3" fontSize="1.7" textAnchor="middle" fill="#6b5636" fontWeight="700">N</text>
        <text x="0" y="7.6" fontSize="1.4" textAnchor="middle" fill="#6b5636" fontWeight="600">S</text>
        <text x="6.4" y="0.5" fontSize="1.4" textAnchor="middle" fill="#6b5636" fontWeight="600">E</text>
        <text x="-6.4" y="0.5" fontSize="1.4" textAnchor="middle" fill="#6b5636" fontWeight="600">W</text>
      </g>
    </>
  );
}
