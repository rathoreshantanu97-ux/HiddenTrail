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
            near the CENTRAL cluster */}
        <rect x="56" y="52" width="3.2" height="2.4" fill="#d8cba8" opacity="0.9" rx="0.3" />
        <text x="57.6" y="56.5" fontSize="1.1" textAnchor="middle" fill="#8a6d3a" fontWeight="600" opacity="0.85">
          Vidhana Soudha
        </text>

        {/* Bangalore Palace -- second major building landmark, placed
            toward the NORTHWEST cluster */}
        <rect x="22" y="80" width="3" height="2.2" fill="#d8cba8" opacity="0.9" rx="0.3" />
        <text x="23.5" y="84" fontSize="1.1" textAnchor="middle" fill="#8a6d3a" fontWeight="600" opacity="0.85">
          Bangalore Palace
        </text>

        {/* Kempegowda Airport -- real Bengaluru landmark, placed at the
            actual coordinates of the renamed station (station 4, the
            genuine northernmost station on this map, matching the real
            airport's real-world position north of the city). Simple
            runway-stripe glyph rather than a building icon. */}
        <g opacity="0.85">
          <rect x="35" y="1.5" width="6" height="1" fill="#8a8f96" rx="0.15" />
          <rect x="36" y="0.8" width="4" height="0.5" fill="#d8d4c8" />
        </g>
        <text x="38" y="5.5" fontSize="1.1" textAnchor="middle" fill="#5c6066" fontWeight="600" opacity="0.85">
          Kempegowda Airport
        </text>

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
    // Namma Bengaluru: built from a detailed hand-authored spec (non-
    // square 126x100 canvas). Clean, functional base for now -- richer
    // graphics (lakes, gardens, streets-vs-highways styling) are a
    // planned follow-up polish pass, kept deliberately simple here so
    // this map is fully playable immediately, prioritized ahead of
    // visual decoration per explicit instruction.
    return (
      <>
        <rect x="0" y="0" width="126" height="100" fill="#eef1ec" />
        <circle cx="30" cy="25" r="16" fill="#e6e8e2" opacity="0.4" />
        <circle cx="95" cy="25" r="16" fill="#e6e8e2" opacity="0.4" />
        <circle cx="30" cy="75" r="16" fill="#e3e5df" opacity="0.4" />
        <circle cx="95" cy="75" r="16" fill="#e3e5df" opacity="0.4" />
        <circle cx="63" cy="50" r="15" fill="#e9e6da" opacity="0.4" />
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
