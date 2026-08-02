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
    return (
      <>
        {/* Bengaluru: Google-Maps-style base — cool off-white land, soft
            green park patches, saturated blue water */}
        <rect x="0" y="0" width="100" height="100" fill="#eef1ec" />
        <circle cx="47" cy="47" r="6.5" fill="#d3e6ce" opacity="0.9" />
        <circle cx="45" cy="59" r="4.5" fill="#d3e6ce" opacity="0.85" />
        <circle cx="30" cy="30" r="16" fill="#e6e8e2" opacity="0.5" />
        <circle cx="70" cy="30" r="15" fill="#e6e8e2" opacity="0.5" />
        <circle cx="25" cy="70" r="16" fill="#e3e5df" opacity="0.5" />
        <circle cx="60" cy="75" r="17" fill="#e3e5df" opacity="0.5" />
        <path
          d="M 50 6 C 75 8, 92 25, 92 48 C 92 68, 78 84, 55 92
             C 38 96, 18 90, 10 72 C 4 55, 6 32, 20 16 C 30 6, 40 4, 50 6 Z"
          fill="none"
          stroke="#f5c065"
          strokeWidth="1"
          strokeDasharray="2.2,1.4"
          opacity="0.75"
        />
        <text x="50" y="4" fontSize="1.6" textAnchor="middle" fill="#b8863a" fontWeight="700" opacity="0.8">
          OUTER RING ROAD
        </text>
        <ellipse cx="55" cy="45" rx="5.5" ry="3.4" fill="url(#lakeGrad)" opacity="0.95" transform="rotate(18 55 45)" />
        <text x="55" y="45" fontSize="1.3" textAnchor="middle" fill="#3d6b7d" fontWeight="600" opacity="0.85">Ulsoor Lake</text>
        <ellipse cx="70" cy="69" rx="7" ry="4.4" fill="url(#lakeGrad)" opacity="0.95" transform="rotate(-12 70 69)" />
        <text x="70" y="69" fontSize="1.3" textAnchor="middle" fill="#3d6b7d" fontWeight="600" opacity="0.85">Bellandur Lake</text>
      </>
    );
  }

  if (bg.kind === "citymap" && bg.theme === "bengaluru-new") {
    // Bengaluru — New: the 100-station redesign. Same Google-Maps-style
    // base as the original theme, but with lakes repositioned to match
    // the NEW map's actual station coordinates (Ulsoor/Devarabeesanahalli/
    // Bellandur Gate/Bellandur form the real ferry chain here, at
    // different positions than the old 64-station map), plus genuine
    // Bengaluru garden/park landmarks and a couple of major buildings,
    // per explicit design request -- kept as a fully separate theme so
    // the original "bengaluru" map's visuals are never touched.
    return (
      <>
        <rect x="0" y="0" width="100" height="100" fill="#eef1ec" />

        {/* Soft neighborhood-tint patches, spread evenly since station
            layout itself is now evenly distributed rather than
            clustered by real geography */}
        <circle cx="25" cy="25" r="15" fill="#e6e8e2" opacity="0.45" />
        <circle cx="75" cy="25" r="15" fill="#e6e8e2" opacity="0.45" />
        <circle cx="25" cy="75" r="15" fill="#e3e5df" opacity="0.45" />
        <circle cx="75" cy="75" r="15" fill="#e3e5df" opacity="0.45" />
        <circle cx="50" cy="50" r="14" fill="#e9e6da" opacity="0.4" />

        {/* Cubbon Park -- real Bengaluru landmark, placed near the
            CENTRAL region cluster (MG Road / Cubbon Park / Vidhana
            Soudha all sit near map center per our regional naming) */}
        <ellipse cx="54" cy="44" rx="6.5" ry="5" fill="#cfe3c4" opacity="0.85" />
        <text x="54" y="44" fontSize="1.4" textAnchor="middle" fill="#4a7a3d" fontWeight="600" opacity="0.85">
          Cubbon Park
        </text>

        {/* Lalbagh -- second real garden landmark, placed toward the
            SOUTH region cluster */}
        <ellipse cx="48" cy="12" rx="5.5" ry="4.2" fill="#cfe3c4" opacity="0.85" />
        <text x="48" y="12" fontSize="1.3" textAnchor="middle" fill="#4a7a3d" fontWeight="600" opacity="0.85">
          Lalbagh
        </text>

        {/* Vidhana Soudha -- major real government building landmark,
            near the CENTRAL cluster. Icon only -- the station's own
            name label (with verified collision-free positioning) is
            already rendered by the main station-labeling system; a
            second text label here would just duplicate it. */}
        <rect x="56" y="52" width="3.2" height="2.4" fill="#d8cba8" opacity="0.9" rx="0.3" />

        {/* Bangalore Palace -- second major building landmark, placed
            toward the NORTHWEST cluster. Icon only, same reasoning. */}
        <rect x="22" y="80" width="3" height="2.2" fill="#d8cba8" opacity="0.9" rx="0.3" />

        {/* Kempegowda Airport -- real Bengaluru landmark, placed at the
            actual coordinates of the renamed station (station 4, the
            genuine northernmost station on this map, matching the real
            airport's real-world position north of the city). Simple
            runway-stripe glyph rather than a building icon. Icon only --
            the station's own name label already handles the text. */}
        <g opacity="0.85">
          <rect x="35" y="1.5" width="6" height="1" fill="#8a8f96" rx="0.15" />
          <rect x="36" y="0.8" width="4" height="0.5" fill="#d8d4c8" />
        </g>

        {/* Ulsoor Lake / Bellandur Lake -- kept as pure visual scenery
            (per updated design decision: lakes stay, but no longer
            gate a special crossing mechanic -- that's now handled by
            the separate secret-underground-network mechanic instead).
            Bridges are drawn across the lake shapes so normal
            taxi/bus/metro routes crossing through this area read as
            genuinely crossing OVER the water via a bridge, not
            floating through it. */}
        <path
          d="M 84 32 C 88 36, 90 42, 88 47 C 86 51, 84 54, 85 58
             C 86 61, 84 63, 81 62 L 78 59 C 80 54, 79 49, 80 44
             C 81 39, 80 34, 82 30 Z"
          fill="url(#lakeGrad)"
          opacity="0.9"
        />
        <text x="86" y="34" fontSize="1.2" textAnchor="middle" fill="#3d6b7d" fontWeight="600" opacity="0.85">
          Bellandur Lake
        </text>
        <text x="83" y="58" fontSize="1.2" textAnchor="middle" fill="#3d6b7d" fontWeight="600" opacity="0.85">
          Ulsoor Lake
        </text>
        {/* Bridge markers -- short pale crossbars, drawn wherever a
            normal route edge happens to pass over the lake shape, so
            it visually reads as "crossing a bridge" rather than an
            unexplained gap in the water. Positioned generically across
            the lake's narrow points. */}
        <rect x="82" y="43" width="6" height="1.4" fill="#d8d4c8" opacity="0.9" rx="0.3" transform="rotate(20 85 43.7)" />
        <rect x="80" y="52" width="6" height="1.4" fill="#d8d4c8" opacity="0.9" rx="0.3" transform="rotate(-15 83 52.7)" />
      </>
    );
  }

  if (bg.kind === "citymap" && bg.theme === "namma-bengaluru") {
    // Namma Bengaluru: richer visual pass -- real Bengaluru lakes and
    // landmark buildings, positioned at the ACTUAL coordinates of their
    // named stations after the v3 redistribution (verified against the
    // real station data, not guessed).
    return (
      <>
        <rect x="0" y="0" width="126" height="100" fill="#eef1ec" />
        <circle cx="30" cy="25" r="16" fill="#e6e8e2" opacity="0.35" />
        <circle cx="95" cy="25" r="16" fill="#e6e8e2" opacity="0.35" />
        <circle cx="30" cy="75" r="16" fill="#e3e5df" opacity="0.35" />
        <circle cx="95" cy="75" r="16" fill="#e3e5df" opacity="0.35" />
        <circle cx="63" cy="50" r="15" fill="#e9e6da" opacity="0.35" />

        {/* Ulsoor Lake -- real station at (81.2, 31.9). Icon only, no
            text label -- per explicit instruction. */}
        <ellipse cx="84" cy="30" rx="5.5" ry="3.8" fill="url(#lakeGrad)" opacity="0.9" transform="rotate(15 84 30)" />

        {/* Bellandur Lake -- real station at (108.2, 83.2), the largest
            water body. Icon only, no text label. */}
        <ellipse cx="112" cy="86" rx="7" ry="4.5" fill="url(#lakeGrad)" opacity="0.9" transform="rotate(-10 112 86)" />

        {/* Cubbon Park -- real station at (53.6, 42.3). Icon only -- the
            station's own name label already handles the text. */}
        <ellipse cx="57" cy="39" rx="5.5" ry="4" fill="#cfe3c4" opacity="0.85" />

        {/* Lalbagh -- real station at (49.2, 64.1). Icon only. */}
        <ellipse cx="46" cy="68" rx="5" ry="3.8" fill="#cfe3c4" opacity="0.85" />

        {/* Vidhana Soudha -- real Indian legislative building, rendered as
            a simplified domed-colonnade silhouette rather than a plain
            box, so it actually reads as "government building" at a
            glance. Station at (45.0, 24.4). Icon only. */}
        <g transform="translate(45.0, 22.5)">
          <rect x="-3" y="0" width="6" height="1.8" fill="#c9b98a" />
          <rect x="-3.4" y="1.6" width="6.8" height="0.5" fill="#a8926a" />
          {[-2.4, -1.2, 0, 1.2, 2.4].map((dx, i) => (
            <rect key={i} x={dx - 0.15} y={-0.4} width="0.3" height="1.4" fill="#8a7550" />
          ))}
          <circle cx="0" cy="-1.1" r="1.1" fill="#c9b98a" />
          <circle cx="0" cy="-2.0" r="0.25" fill="#8a7550" />
        </g>

        {/* Bengaluru Palace -- Tudor-style crenellated silhouette,
            distinct from the legislative dome above. Station at
            (54.2, 9.2). Icon only. */}
        <g transform="translate(54.2, 7.3)">
          <rect x="-2.6" y="0" width="5.2" height="1.8" fill="#d8b98a" />
          {[-2.2, -1.1, 0, 1.1, 2.2].map((dx, i) => (
            <rect key={i} x={dx - 0.35} y={-0.7} width="0.7" height="0.9" fill="#d8b98a" />
          ))}
          <rect x="-0.9" y="-1.8" width="1.8" height="2.7" fill="#c2a476" />
          <polygon points="0,-3 -1,-1.8 1,-1.8" fill="#8a6d3a" />
        </g>

        {/* Kempegowda International Airport -- simple airplane
            silhouette, unmistakably distinct from every building icon.
            Station at (78.8, 6). Icon only. */}
        <g transform="translate(78.77, 3.2) rotate(-30)">
          <path d="M 0 -2.2 L 0.5 1.5 L 2.8 2.8 L 2.8 3.5 L 0.4 2.8 L 0.55 4.3 L 1.5 5 L 1.5 5.6 L 0 5.1 L -1.5 5.6 L -1.5 5 L -0.55 4.3 L -0.4 2.8 L -2.8 3.5 L -2.8 2.8 L -0.5 1.5 Z"
                fill="#5c6066" />
        </g>

        {/* Indian Institute of Science (IISc) -- academic institution,
            rendered as a graduation-cap/mortarboard silhouette. Station
            at (25.8, 16.5). Icon only. */}
        <g transform="translate(25.81, 14.2)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* IIM Bangalore -- same academic-institution mortarboard
            language as IISc (visually groups them as "institutes"),
            station at (64.0, 94). Icon only. */}
        <g transform="translate(63.96, 91.7)">
          <polygon points="0,-1.3 3,0 0,1.3 -3,0" fill="#4a5a7a" />
          <rect x="-0.25" y="0" width="0.5" height="2.2" fill="#4a5a7a" />
          <circle cx="0" cy="2.3" r="0.35" fill="#4a5a7a" />
        </g>

        {/* IKEA Nagasandra -- simplified storefront/retail-box icon,
            deliberately more distinctive than a plain rectangle (a
            gabled roofline + a shopping-bag-like handle cue). Station
            at (7.4, 12). Icon only. */}
        <g transform="translate(7.38, 9.8)">
          <rect x="-2.4" y="-0.2" width="4.8" height="2.4" fill="#2a5fa5" />
          <polygon points="-2.7,-0.2 0,-1.8 2.7,-0.2" fill="#1f4a85" />
          <rect x="-0.9" y="0.4" width="1.8" height="1.2" fill="#ffcc33" />
        </g>
      </>
    );
  }

  if (bg.kind === "citymap" && bg.theme === "sendhwa") {
    // Sendhwa Corridor: a regional town map (portrait orientation, 95x126)
    // with real icons for schools, the fort, civic buildings, and (per
    // explicit privacy instruction) unlabeled generic home markers for
    // the private residence nodes -- no addresses, only the alias
    // already given in the spec (Shantanu's Home, Aayush's Mansion,
    // Tanu's Villa, Mayur's Mahal, Shubham's Den).
    return (
      <>
        <rect x="0" y="0" width="95" height="126" fill="#f1ede3" />
        <circle cx="30" cy="30" r="14" fill="#ece5d3" opacity="0.35" />
        <circle cx="60" cy="30" r="14" fill="#ece5d3" opacity="0.35" />
        <circle cx="20" cy="55" r="16" fill="#e8e0c8" opacity="0.4" />
        <circle cx="90" cy="60" r="14" fill="#e3dcc4" opacity="0.35" />
        <circle cx="60" cy="80" r="14" fill="#e3dcc4" opacity="0.35" />

        {/* Ghat/hill shading near Bijasan Ghat (the map's far LEFT end,
            per the real local layout), brown/olive contour strokes
            suggesting a mountain pass */}
        <g opacity="0.5">
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M ${10 + i * 2.5} ${48 + i * 3} Q ${6 + i * 2.5} ${55 + i * 3} ${11 + i * 2.5} ${62 + i * 3}`}
              stroke="#8a7550"
              strokeWidth="0.8"
              fill="none"
            />
          ))}
        </g>
        <text x="14" y="45" fontSize="1.4" textAnchor="middle" fill="#6b5636" fontWeight="600" opacity="0.7">
          Bijasan Ghat descent
        </text>

        {/* Fort Pond -- small internal water feature inside the fort
            compound, per the spec's explicit instruction. Repositioned
            to the new Fort location (74.2, 25.7). */}
        <ellipse cx="74.5" cy="29" rx="2.2" ry="1.5" fill="url(#lakeGrad)" opacity="0.85" />

        {/* Goi-side seasonal drainage -- pale blue broken line, NOT a
            large river (per explicit spec instruction not to invent
            one). Repositioned near the rural Chachariya/Semliya/
            Pisanawal cluster in its new location. */}
        <path d="M 92 85 Q 87 90 82 92" stroke="#8fb8cc" strokeWidth="0.5" strokeDasharray="1,1" fill="none" opacity="0.6" />

        {/* Sendhwa Fort -- the board's central heritage anchor, a
            crenellated fort silhouette, distinct from every school/
            civic icon. Icon only -- the station's own name label
            already handles the text. */}
        <g transform="translate(74.17, 22.7)">
          <rect x="-3" y="0" width="6" height="2.2" fill="#a8926a" />
          {[-2.4, -1, 0.4, 1.8].map((dx, i) => (
            <rect key={i} x={dx} y={-0.8} width="0.9" height="1" fill="#a8926a" />
          ))}
          <rect x="-4" y="1.8" width="8" height="0.6" fill="#8a7550" />
          <polygon points="0,-2.2 -1.2,-0.8 1.2,-0.8" fill="#6b5636" />
        </g>

        {/* School icon (shared silhouette language: a simple gabled
            schoolhouse) for all 3 school landmarks. Icon only -- each
            station's own name label already handles the text. */}
        {[
          { x: 66.77, y: 33.0 },
          { x: 64.31, y: 71.6 },
          { x: 53.25, y: 41.6 },
        ].map((school, i) => (
          <g key={i} transform={`translate(${school.x}, ${school.y})`}>
            <rect x="-1.8" y="-0.3" width="3.6" height="1.8" fill="#c26b4a" />
            <polygon points="-2.1,-0.3 0,-1.5 2.1,-0.3" fill="#8a4a30" />
            <rect x="-0.4" y="0.5" width="0.8" height="1" fill="#f1ede3" />
          </g>
        ))}

        {/* Private home markers -- deliberately GENERIC (a plain small
            house silhouette, no distinguishing detail beyond the
            existing alias already in the spec), per explicit privacy
            instruction: no addresses, no additional identifying
            details. Icon only -- each station's own name label already
            handles the text. */}
        {[
          { x: 64.7, y: 65.1 },
          { x: 56.27, y: 53.3 },
          { x: 31.22, y: 21.8 },
          { x: 94.62, y: 31.9 },
          { x: 83.63, y: 58.9 },
        ].map((home, i) => (
          <g key={i} transform={`translate(${home.x}, ${home.y - 2})`}>
            <rect x="-1.2" y="0" width="2.4" height="1.4" fill="#7a8a99" opacity="0.8" />
            <polygon points="-1.5,0 0,-1.1 1.5,0" fill="#5c6d7a" opacity="0.8" />
          </g>
        ))}

        {/* Omprakash Talkies -- cinema icon (film-reel/screen glyph).
            Icon only. */}
        <g transform="translate(44.0, 49.5)">
          <rect x="-1.6" y="-0.9" width="3.2" height="1.8" fill="#4a3a5c" />
          <circle cx="-0.6" cy="0" r="0.4" fill="#7a6a9c" />
          <circle cx="0.6" cy="0" r="0.4" fill="#7a6a9c" />
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
