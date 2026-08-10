// ---------------------------------------------------------------------------
// CURVE GEOMETRY — single source of truth for turning a "perpendicular
// offset" (or several) into an actual SVG path, shared by GameBoard.jsx,
// ReplayView.jsx, and MapEditorPanel.jsx so all three render EXACTLY the
// same curve for the same data, never three independently-maintained
// copies of the same math drifting apart.
//
// A manual curve offset for an edge is either:
//   - a single number (legacy / simple case) -- ONE bend point, rendered
//     as a single quadratic Bezier exactly like every curve on this
//     project has always worked. Every existing manualCurveOffsets entry
//     in every map file is this shape, so this path renders them
//     PIXEL-IDENTICAL to before -- no visual regression from adding
//     multi-point support.
//   - an array of 2-3 numbers -- MULTIPLE bend points along the edge,
//     for longer routes that need an S-shape or a more deliberate bend
//     than a single symmetric bow can produce. Points are evenly spaced
//     along the straight line between the two stations (t = 1/(k+1),
//     2/(k+1), ... for k points) and each one is offset perpendicular to
//     the line by its own value -- same mental model as the single-point
//     case, just repeated. Rendered as a Catmull-Rom spline (converted to
//     chained cubic Beziers) through start -> each point -> end, which is
//     the standard technique for a smooth curve that actually PASSES
//     THROUGH a series of points (rather than just being pulled toward
//     them, the way plain Bezier control points work) -- this is what
//     makes dragging a point feel like bending the line at exactly that
//     spot, the same way a curve tool in a slide editor behaves.
// ---------------------------------------------------------------------------

export function normalizeCurveOffsets(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  return [value];
}

function perpendicular(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { dx, dy, len, nx: -dy / len, ny: dx / len };
}

// Returns the actual [x, y, t] for each control point, evenly spaced
// along the straight baseline between the two stations.
export function curveControlPoints(ax, ay, bx, by, rawOffsets) {
  const offsets = normalizeCurveOffsets(rawOffsets);
  if (!offsets || offsets.length === 0) return [];
  const { dx, dy, nx, ny } = perpendicular(ax, ay, bx, by);
  const k = offsets.length;
  return offsets.map((offset, i) => {
    const t = (i + 1) / (k + 1);
    const baseX = ax + dx * t;
    const baseY = ay + dy * t;
    return { x: baseX + nx * offset, y: baseY + ny * offset, t, index: i };
  });
}

// The actual SVG path `d` attribute for this edge.
export function curvePathD(ax, ay, bx, by, rawOffsets) {
  const offsets = normalizeCurveOffsets(rawOffsets);
  if (!offsets || offsets.length === 0) {
    return `M ${ax} ${ay} L ${bx} ${by}`;
  }
  if (offsets.length === 1) {
    // Exact legacy single-quadratic-Bezier behavior -- unchanged math.
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const { nx, ny } = perpendicular(ax, ay, bx, by);
    const cx = mx + nx * offsets[0];
    const cy = my + ny * offsets[0];
    return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const ctrl = curveControlPoints(ax, ay, bx, by, offsets);
  const pts = [
    [ax, ay],
    ...ctrl.map((p) => [p.x, p.y]),
    [bx, by],
  ];
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    // Uniform Catmull-Rom -> cubic Bezier conversion.
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// Sampled [x, y] points along the actual rendered path, for clearance
// checks against nearby stations (used by MapEditorPanel's live
// "too close to X" warning). `steps` is a target total; the multi-point
// case distributes it across segments.
export function sampleCurvePoints(ax, ay, bx, by, rawOffsets, steps = 60) {
  const offsets = normalizeCurveOffsets(rawOffsets);
  const pts = [];
  if (!offsets || offsets.length === 0) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return pts;
  }
  if (offsets.length === 1) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const { nx, ny } = perpendicular(ax, ay, bx, by);
    const cx = mx + nx * offsets[0];
    const cy = my + ny * offsets[0];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t ** 2 * bx;
      const y = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t ** 2 * by;
      pts.push([x, y]);
    }
    return pts;
  }
  const ctrl = curveControlPoints(ax, ay, bx, by, offsets);
  const allPts = [[ax, ay], ...ctrl.map((p) => [p.x, p.y]), [bx, by]];
  const segSteps = Math.max(4, Math.round(steps / (allPts.length - 1)));
  for (let i = 0; i < allPts.length - 1; i++) {
    const p0 = allPts[Math.max(0, i - 1)];
    const p1 = allPts[i];
    const p2 = allPts[i + 1];
    const p3 = allPts[Math.min(allPts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let s = 0; s <= segSteps; s++) {
      const t = s / segSteps;
      const x = (1 - t) ** 3 * p1[0] + 3 * (1 - t) ** 2 * t * cp1x + 3 * (1 - t) * t ** 2 * cp2x + t ** 3 * p2[0];
      const y = (1 - t) ** 3 * p1[1] + 3 * (1 - t) ** 2 * t * cp1y + 3 * (1 - t) * t ** 2 * cp2y + t ** 3 * p2[1];
      pts.push([x, y]);
    }
  }
  return pts;
}
