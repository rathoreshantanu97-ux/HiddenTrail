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
  // Admin-set background color override (from the Map Editor's
  // background picker) -- a single flat fill that replaces just the base
  // rect/wash for whichever theme is active, leaving all the actual
  // decorative art (water gradients, parks, landmark icons, region
  // hulls) drawn on top exactly as before. Purely cosmetic, same override
  // mechanism as curve/station overrides -- see map_settings.background_
  // override in access_control_schema.sql.
  const overrideFill = map.backgroundOverrideColor || null;

  if (bg.kind === "regions" && bg.theme === "westeros") {
    const hulls = bg.regionHulls;
    return (
      <g>
        {/* Westeros: hand-drawn region hulls (derived from each region's
            actual station cluster), so the map keeps proper node spacing
            while still reading as a real illustrated continent. */}
        <rect x="0" y="0" width={w} height={h} fill={overrideFill || "url(#seaGrad)"} />

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
        <rect x="-10" y="-10" width="146" height="122" fill={overrideFill || "#f6f1e5"} />

        {/* Rural Lake, Small Lake, Lalbagh, Nice Road Park, State Forest,
            Bamboo Forest, Botanical Garden, Vidhana Soudha, Bengaluru
            Palace, Kempegowda International Airport, IISc, IIM
            Bangalore, Christ University, IKEA Nagasandra, Phoenix Mall,
            and Manyata Tech Park all used to be hand-coded inline SVG
            here. Converted to ordinary entries in this map's
            `decorations` array (see bengaluru.js's DECORATIONS_BENGALURU
            and DecorationsLayer.jsx) so an admin can select/move/resize/
            recolor/delete each one via the Map Editor, instead of them
            being permanently fixed, non-editable art -- this was the
            actual reported complaint ("the overlay and images that are
            already there on map... are not editable right now"). They
            still render here exactly as before, just via the shared
            DecorationsLayer component (see GameBoard.jsx/ReplayView.jsx/
            MapEditorPanel.jsx, all of which paint decorations directly
            after this background). */}
      </>
    );
  }

  if (bg.kind === "citymap" && bg.theme === "city-of-sendhwa") {
    // City of Sendhwa: 86-station town map. NO river/water graphic (per
    // explicit request -- unlike the generic "plain" fallback, which
    // always includes one) -- just the base fill plus a small set of
    // real landmark icons and a fort boundary, all positioned using this
    // map's ACTUAL station coordinates (checked directly, not guessed).
    // Fill matched to Bengaluru's already-verified #f6f1e5 (was #ece3d0,
    // the original un-lightened value) -- this map is the densest of the
    // three (86 stations, heavy edge overlap in the Fort/Sadar Bazaar
    // cluster), so the same contrast gains that helped Bengaluru's
    // route-line legibility apply here too, and using the identical
    // value keeps all citymap-style boards visually consistent instead
    // of introducing a third, slightly-different parchment tone.
    return (
      <>
        <rect x="-2" y="-2" width={w + 4} height={h + 4} fill={overrideFill || "#f6f1e5"} />

        {/* Lake, the 3 school icons, the bus icon, the police icon, and
            the fort tower icon all used to be hand-coded inline SVG
            here. Converted to ordinary entries in this map's
            `decorations` array (see cityOfSendhwa.js's
            DECORATIONS_CITY_OF_SENDHWA and DecorationsLayer.jsx) so an
            admin can select/move/resize/recolor/delete each one via the
            Map Editor, instead of them being permanently fixed,
            non-editable art. They still render exactly as before, just
            via the shared DecorationsLayer component. */}

        {/* Fort boundary dashed rectangle -- removed per explicit request
            (user doesn't want it). Used to enclose the fort-area station
            cluster (23, 58, 59, 57, 41, 54, 13, 52) with a dashed
            outline; DecorationsLayer's "shape" rect type has no
            dashed-stroke option so this was left as fixed art rather
            than converted to an editable decoration -- now just deleted
            outright instead. */}
        {/* Fort icon (crenellated tower silhouette, previously hand-coded
            just above the boundary rectangle's top edge) is now
            "sendhwa_fort" in DECORATIONS_CITY_OF_SENDHWA -- see the
            conversion note above. */}
      </>
    );
  }


  // Default / "plain" — parchment base with soft district blobs and a river.
  // Used by city.js, and a reasonable fallback for any new map that hasn't
  // authored custom background art yet. Matched to the same #f6f1e5 used
  // by Bengaluru and City of Sendhwa (was #f3ecd9, a close but not
  // identical shade) so every map shares one consistent, already-verified
  // background tone rather than three near-duplicates.
  return (
    <>
      <rect x="0" y="0" width={w} height={h} fill={overrideFill || "#f6f1e5"} />
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
