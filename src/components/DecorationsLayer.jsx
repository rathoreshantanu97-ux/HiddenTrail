import React from "react";
import { renderIconPaths } from "../lib/decorationIcons.jsx";

// ---------------------------------------------------------------------------
// DECORATIONS LAYER — shared, read-only renderer for an admin's
// icon/shape/image/text beautification layer, used identically by
// GameBoard.jsx, ReplayView.jsx, and MapEditorPanel.jsx's live preview
// (same "one shared component, not three copies" pattern as
// curveGeometry.js and DecorationsLayer's own sibling files).
//
// Deliberately dumb: this component only draws what it's given, in array
// order (index 0 = furthest back within this layer). It never receives
// pointer events in the actual game (pointerEvents="none" on the whole
// group) -- decorations are purely cosmetic and must never intercept a
// click meant for a station or edge. The one place this layer IS
// interactive is inside MapEditorPanel.jsx, which renders its own
// editable version directly (drag/resize/rotate handles, selection),
// not through this component -- this file is only the "just show it"
// renderer, reused for its LIVE PREVIEW alongside the editable overlay.
//
// This layer is always painted directly after the background and before
// any transit lines or stations, so it can never visually cover up
// anything that affects gameplay -- see the "simple, always-behind"
// layering decision from the original scoping discussion.
// ---------------------------------------------------------------------------
export default function DecorationsLayer({ decorations }) {
  if (!decorations || decorations.length === 0) return null;
  return (
    <g pointerEvents="none">
      {decorations.map((d) => (
        <DecorationItem key={d.id} d={d} />
      ))}
    </g>
  );
}

export function DecorationItem({ d }) {
  const rotation = d.rotation || 0;
  const opacity = d.opacity != null ? d.opacity : 1;
  const color = d.color || "#5c5648";

  if (d.type === "icon") {
    const size = d.size || 6;
    return (
      // style={{color}} matters here, not just fill: a few icons (river,
      // port, bridge, playground, anchor, compass) draw parts as strokes
      // using stroke="currentColor" rather than fill, since a filled
      // shape doesn't read as "a line" (a river, a rope, a pole) --
      // currentColor resolves from the CSS `color` property, which fill
      // alone does not set.
      <g
        transform={`translate(${d.x}, ${d.y}) rotate(${rotation}) scale(${size / 10})`}
        fill={color}
        opacity={opacity}
        style={{ color }}
      >
        {renderIconPaths(d.icon)}
      </g>
    );
  }

  if (d.type === "shape") {
    const w = d.w || 8;
    const h = d.h || 8;
    const strokeW = d.strokeWidth != null ? d.strokeWidth : 0;
    const fill = strokeW > 0 && d.fillColor === "none" ? "none" : color;
    const stroke = d.strokeColor || (strokeW > 0 ? "#3d3728" : "none");
    if (d.shape === "circle") {
      return (
        <ellipse
          cx={d.x}
          cy={d.y}
          rx={w / 2}
          ry={h / 2}
          fill={fill}
          stroke={strokeW > 0 ? stroke : "none"}
          strokeWidth={strokeW}
          opacity={opacity}
          transform={rotation ? `rotate(${rotation} ${d.x} ${d.y})` : undefined}
        />
      );
    }
    if (d.shape === "line") {
      const half = w / 2;
      return (
        <line
          x1={d.x - half}
          y1={d.y}
          x2={d.x + half}
          y2={d.y}
          stroke={color}
          strokeWidth={Math.max(0.2, strokeW || 0.4)}
          strokeLinecap="round"
          opacity={opacity}
          transform={rotation ? `rotate(${rotation} ${d.x} ${d.y})` : undefined}
        />
      );
    }
    // rect (default)
    return (
      <rect
        x={d.x - w / 2}
        y={d.y - h / 2}
        width={w}
        height={h}
        fill={fill}
        stroke={strokeW > 0 ? stroke : "none"}
        strokeWidth={strokeW}
        opacity={opacity}
        transform={rotation ? `rotate(${rotation} ${d.x} ${d.y})` : undefined}
      />
    );
  }

  if (d.type === "text") {
    return (
      <text
        x={d.x}
        y={d.y}
        fontSize={d.fontSize || 2.5}
        fill={color}
        opacity={opacity}
        textAnchor="middle"
        fontWeight={700}
        transform={rotation ? `rotate(${rotation} ${d.x} ${d.y})` : undefined}
      >
        {d.text || ""}
      </text>
    );
  }

  if (d.type === "image" && d.url) {
    const w = d.w || 10;
    const h = d.h || 10;
    return (
      <image
        href={d.url}
        x={d.x - w / 2}
        y={d.y - h / 2}
        width={w}
        height={h}
        opacity={opacity}
        transform={rotation ? `rotate(${rotation} ${d.x} ${d.y})` : undefined}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }

  return null;
}
