import React, { useState, useMemo } from "react";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import {
  REVEAL_ROUNDS,
  MAX_ROUNDS,
  MAX_MOVES,
  currentActor,
  validMovesFor,
  occupiedByDetective,
  formatLogEntry,
} from "../lib/gameEngine.js";

// ---------------------------------------------------------------------------
// GAME BOARD — renders the full playing screen: header, ticket panel,
// travel log / detective overview, the SVG map itself, and move controls.
//
// Works identically for pass-and-play and online multiplayer. The one
// real behavioral difference between the two modes is captured by two
// props:
//
//   myRole        null in pass-and-play (this device controls everyone,
//                 so nothing is role-restricted); "mrx" | "d0" | ... in
//                 multiplayer (this device only acts for ITS OWN role).
//
//   canSeeMyPosition   whether THIS client's own dot should render even
//                 when it's not currently their turn. In pass-and-play,
//                 Mr. X's dot is hidden except during Mr. X's own turn
//                 (since the device is shared and detectives are looking
//                 at the same screen a moment later). In multiplayer,
//                 Mr. X has their own device, so there's no reason to
//                 hide it from themselves outside their turn.
// ---------------------------------------------------------------------------
export default function GameBoard({
  map,
  match,
  myRole, // null (pass-and-play) | "mrx" | "d0" | "d1" | ... (multiplayer)
  mrxName,
  detectiveName,
  onDetectiveMove,
  onMrXMove,
  onActivateDoubleMove,
  extraHeaderContent, // e.g. a "pass to X" banner slot in pass-and-play, or a chat toggle in multiplayer
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pendingMove, setPendingMove] = useState(null);
  const [message, setMessage] = useState("");
  const dragState = React.useRef(null);
  const svgRef = React.useRef(null);

  const activeMode = map.modeTheme || MODE_DEFAULT;
  const stationLabel = (id) => (map.names ? `${map.names[id]} (#${id})` : `station ${id}`);

  const actor = currentActor(match); // whose turn is it, regardless of who's viewing
  const isMrXTurn = actor === "mrx";
  const activeDetective = actor && actor !== "mrx" ? match.detectives[parseInt(actor.slice(1))] : null;

  // In pass-and-play, myRole is null, so "it's my turn to act" collapses
  // to "it's this device's turn" (== whoever the current actor is, since
  // the device controls everyone). In multiplayer, only the player whose
  // role matches the current actor can act.
  const isMyTurnToAct = myRole === null || myRole === actor;
  const iAmMrX = myRole === "mrx";
  const iAmDetective = myRole && myRole !== "mrx";
  const myDetective = iAmDetective ? match.detectives[parseInt(myRole.slice(1))] : null;

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const baseW = map.viewW || 100;
  const baseH = map.viewH || 100;
  const viewSizeW = baseW / zoom;
  const viewSizeH = baseH / zoom;
  const maxPanX = baseW - viewSizeW;
  const maxPanY = baseH - viewSizeH;
  const clampPan = (p) => ({
    x: Math.max(0, Math.min(maxPanX, p.x)),
    y: Math.max(0, Math.min(maxPanY, p.y)),
  });

  function zoomBy(factor, centerX = baseW / 2, centerY = baseH / 2) {
    setZoom((z) => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
      const newViewSizeW = baseW / newZoom;
      const newViewSizeH = baseH / newZoom;
      setPan((p) => {
        const oldViewSizeW = baseW / z;
        const oldViewSizeH = baseH / z;
        const fx = (centerX - p.x) / oldViewSizeW;
        const fy = (centerY - p.y) / oldViewSizeH;
        const newP = { x: centerX - fx * newViewSizeW, y: centerY - fy * newViewSizeH };
        return clampPan(newP);
      });
      return newZoom;
    });
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomBy(factor);
  }

  function handlePointerDown(e) {
    if (zoom <= 1) return;
    dragState.current = { lastX: e.clientX, lastY: e.clientY };
    const onMove = (ev) => {
      if (!dragState.current || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dxPx = ev.clientX - dragState.current.lastX;
      const dyPx = ev.clientY - dragState.current.lastY;
      const dx = (dxPx / rect.width) * viewSizeW;
      const dy = (dyPx / rect.height) * viewSizeH;
      dragState.current.lastX = ev.clientX;
      dragState.current.lastY = ev.clientY;
      setPan((p) => clampPan({ x: p.x - dx, y: p.y - dy }));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function handleTouchMove(e) {
    if (!dragState.current || !svgRef.current) return;
    const touch = e.touches[0];
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dxPx = touch.clientX - dragState.current.lastX;
    const dyPx = touch.clientY - dragState.current.lastY;
    const dx = (dxPx / rect.width) * viewSizeW;
    const dy = (dyPx / rect.height) * viewSizeH;
    dragState.current.lastX = touch.clientX;
    dragState.current.lastY = touch.clientY;
    setPan((p) => clampPan({ x: p.x - dx, y: p.y - dy }));
  }
  function handleTouchStart(e) {
    if (zoom <= 1) return;
    const touch = e.touches[0];
    dragState.current = { lastX: touch.clientX, lastY: touch.clientY };
  }

  const theme = { mrxName, detectiveName, stationLabel, modeLabel: (m) => activeMode[m].label };

  const legalTargets = useMemo(() => {
    if (!isMyTurnToAct) return new Set();
    if (isMrXTurn && iAmMrX0(myRole)) {
      return new Set(validMovesFor(map, match.mrX.pos, match.mrX.tickets, true).map((m) => m.to));
    }
    if (activeDetective && (myRole === null || myRole === actor)) {
      return new Set(
        validMovesFor(map, activeDetective.pos, activeDetective.tickets, false)
          .filter((m) => !occupiedByDetective(match.detectives, m.to))
          .map((m) => m.to)
      );
    }
    return new Set();
    function iAmMrX0(role) {
      // pass-and-play (role null) always allows acting as whoever's turn
      // it is; multiplayer only allows it if this client IS Mr. X
      return role === null || role === "mrx";
    }
  }, [isMyTurnToAct, isMrXTurn, activeDetective, match, map, myRole, actor]);

  // Whether MY OWN position dot should render right now. Pass-and-play:
  // only during Mr. X's own turn (shared-device secrecy). Multiplayer:
  // Mr. X always sees themselves regardless of turn, since match.mrX.pos
  // is only ever populated for the Mr. X client to begin with (see
  // matchStateAdapter.js) -- a detective client's match.mrX.pos is
  // already null, so there's nothing to accidentally reveal either way.
  const showMrXPos = myRole === null ? isMrXTurn : iAmMrX;

  function handleStationClick(station) {
    if (!isMyTurnToAct) return;
    if (isMrXTurn) {
      if (myRole !== null && myRole !== "mrx") return; // multiplayer: not your role
      const edge = (map.graph[match.mrX.pos] || []).find((m) => m.to === station);
      if (!edge) {
        setMessage("No direct connection there.");
        return;
      }
      if (edge.mode === "ferry" && match.mrX.tickets.black <= 0) {
        setMessage(`No black tickets left — ${activeMode.ferry.label.toLowerCase()} crossings require one.`);
        return;
      }
      setPendingMove({ to: station, mode: edge.mode, edgeMode: edge.mode });
      if (occupiedByDetective(match.detectives, station)) {
        setMessage(`${stationLabel(station)} has a detective on it. Moving there is legal but ends the game — ${mrxName()} would be caught.`);
      } else if (edge.mode === "ferry") {
        setMessage(`Selected ${stationLabel(station)} via ${activeMode.ferry.label.toLowerCase()}. This will cost a black ticket.`);
      } else {
        setMessage(`Selected ${stationLabel(station)}. Choose which ticket to spend.`);
      }
    } else {
      if (myRole !== null && myRole !== actor) return; // multiplayer: not your role
      const d = activeDetective;
      if (occupiedByDetective(match.detectives, station)) {
        setMessage("Another detective already occupies that station.");
        return;
      }
      const edge = (map.graph[d.pos] || []).find((m) => m.to === station);
      if (!edge) {
        setMessage("No direct connection there.");
        return;
      }
      if (d.tickets[edge.mode] <= 0) {
        setMessage(`No ${activeMode[edge.mode].label} tickets left.`);
        return;
      }
      setPendingMove({ to: station, mode: edge.mode, edgeMode: edge.mode });
      setMessage(`Selected ${stationLabel(station)} via ${activeMode[edge.mode].label}. Confirm to move.`);
    }
  }

  function commitDetectiveMove(detId, to, mode) {
    setPendingMove(null);
    setMessage("");
    onDetectiveMove(detId, to, mode);
  }

  function commitMrXMove(ticketUsed) {
    if (!pendingMove) return;
    const { to, edgeMode } = pendingMove;
    setPendingMove(null);
    onMrXMove(to, edgeMode, ticketUsed);
  }

  const isWesteros = map.id === "westeros";

  return (
    <div style={styles.pagePlaying}>
      <div style={styles.playingLayoutSidebar}>
        <div style={styles.sidebarPermanent}>
          <div style={styles.headerBar}>
            <div>
              <div style={styles.roundLabel}>
                Round {match.round} / {MAX_ROUNDS}
              </div>
              <div style={styles.turnLabel}>
                {isMrXTurn ? `${mrxName()}'s Turn` : `${detectiveName(activeDetective.id)}'s Turn`}
              </div>
            </div>
            <div style={styles.ticketsPanel}>
              {isMrXTurn
                ? Object.entries(match.mrX.tickets)
                    .filter(([mode]) => mode !== "double")
                    .map(([mode, count]) => <TicketChip key={mode} mode={mode} count={count} modeTheme={activeMode} />)
                : Object.entries(activeDetective.tickets).map(([mode, count]) => (
                    <TicketChip key={mode} mode={mode} count={count} modeTheme={activeMode} />
                  ))}
            </div>
          </div>

          {extraHeaderContent}

          {isMrXTurn && (
            <div style={styles.detectiveOverviewPanel}>
              <div style={styles.travelLogTitle}>Detective ticket counts</div>
              <div style={styles.detectiveOverviewRow}>
                {match.detectives.map((d) => (
                  <div key={d.id} style={styles.detectiveOverviewCard}>
                    <div style={{ ...styles.detectiveOverviewDot, background: d.color }} />
                    <span style={{ fontWeight: 700, marginRight: 4 }}>
                      {isWesteros ? detectiveName(d.id) : `D${d.id + 1}`}
                    </span>
                    {Object.entries(d.tickets).map(([mode, count]) => (
                      <span key={mode} style={{ ...styles.miniChip, color: activeMode[mode].color }}>
                        {activeMode[mode].short}
                        {count}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isMrXTurn && (
            <div style={styles.travelLogPanel}>
              <div style={styles.travelLogTitle}>
                {mrxName()}'s travel log (24 moves max — 22 rounds + 2 double-move legs)
              </div>
              {(() => {
                const nextReveal = [...REVEAL_ROUNDS].filter((r) => r >= match.round).sort((a, b) => a - b)[0];
                if (!nextReveal) return null;
                const roundsAway = nextReveal - match.round;
                return (
                  <div style={styles.nextRevealBanner}>
                    {roundsAway === 0
                      ? `👁 Reveal round is NOW (round ${nextReveal}) — ${mrxName()}'s true station will show once they move.`
                      : `👁 Next reveal in ${roundsAway} round${roundsAway === 1 ? "" : "s"} (round ${nextReveal})`}
                  </div>
                );
              })()}
              <div style={styles.logBoard}>
                {Array.from({ length: MAX_MOVES }, (_, i) => i + 1).map((moveNum) => {
                  const entry = match.mrX.travelLog.find((e) => e.move === moveNum);
                  const belongsToRevealRound = entry && REVEAL_ROUNDS.has(entry.round);
                  const isFuture = !entry;
                  return (
                    <div
                      key={moveNum}
                      style={{
                        ...styles.logBoardCell,
                        ...(belongsToRevealRound ? styles.logBoardCellReveal : {}),
                        ...(isFuture ? styles.logBoardCellFuture : {}),
                      }}
                      title={
                        entry
                          ? `Move ${moveNum} (round ${entry.round}): ${activeMode[entry.mode].label}${belongsToRevealRound ? " — reveal round" : ""}`
                          : `Move ${moveNum}: not yet played`
                      }
                    >
                      <div style={styles.logBoardRoundNum}>
                        {moveNum}
                        {entry ? ` · R${entry.round}` : ""}
                      </div>
                      {entry ? (
                        <div
                          style={{
                            ...styles.logBoardModeTag,
                            background: activeMode[entry.mode].color,
                            color: entry.mode === "black" ? "#fff" : "#1a1a1a",
                          }}
                        >
                          {activeMode[entry.mode].short}
                        </div>
                      ) : (
                        <div style={styles.logBoardModeTagEmpty}>·</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {match.mrX.revealedPos && (
                <div style={styles.travelLogReveal}>
                  Last confirmed sighting: {stationLabel(match.mrX.revealedPos)} (round {match.mrX.lastRevealRound})
                </div>
              )}
              <div style={styles.logBoardLegendNote}>
                Red-outlined boxes are moves made during a reveal round (3, 8, 13, 18, 22) — {mrxName()}'s true
                station was shown that round. Two moves can share a round if a 2x card was used.
              </div>
            </div>
          )}

          {isMrXTurn && isMyTurnToAct && !pendingMove && (
            <div style={styles.ruleNote}>
              Stations with a red dashed ring hold a detective — moving onto one ends the game immediately.
            </div>
          )}

          {message && <div style={styles.messageBar}>{message}</div>}

          {isMrXTurn && isMyTurnToAct && !pendingMove && (
            <div style={styles.rowCenter}>
              <button
                style={{
                  ...styles.doubleBtn,
                  opacity: match.mrX.tickets.double > 0 && !match.mrX.doubleMoveActive ? 1 : 0.4,
                  cursor: match.mrX.tickets.double > 0 && !match.mrX.doubleMoveActive ? "pointer" : "default",
                }}
                disabled={match.mrX.tickets.double <= 0 || match.mrX.doubleMoveActive}
                onClick={onActivateDoubleMove}
              >
                Play 2x card ({match.mrX.tickets.double} left)
              </button>
            </div>
          )}

          {isMrXTurn && isMyTurnToAct && pendingMove && (
            <div style={styles.ticketChooser}>
              <div style={{ marginBottom: 6 }}>Move to {stationLabel(pendingMove.to)} via:</div>
              <div style={styles.rowCenter}>
                {pendingMove.edgeMode === "ferry" ? (
                  <button style={{ ...styles.primaryBtn, background: activeMode.ferry.color }} onClick={() => commitMrXMove("black")}>
                    {activeMode.ferry.label} (uses 1 black ticket)
                  </button>
                ) : (
                  <>
                    {match.mrX.tickets[pendingMove.edgeMode] > 0 && (
                      <button style={styles.primaryBtn} onClick={() => commitMrXMove(pendingMove.edgeMode)}>
                        {activeMode[pendingMove.edgeMode].label} ticket
                      </button>
                    )}
                    {match.mrX.tickets.black > 0 && (
                      <button style={{ ...styles.primaryBtn, background: "#2b2b2b" }} onClick={() => commitMrXMove("black")}>
                        Black ticket (camouflage)
                      </button>
                    )}
                  </>
                )}
              </div>
              <button style={styles.linkBtn} onClick={() => setPendingMove(null)}>
                Cancel
              </button>
            </div>
          )}

          {!isMrXTurn && activeDetective && isMyTurnToAct && pendingMove && (
            <div style={styles.ticketChooser}>
              <div style={{ marginBottom: 10 }}>
                Move to {stationLabel(pendingMove.to)} using a {activeMode[pendingMove.mode].label} ticket?
              </div>
              <div style={styles.rowCenter}>
                <button
                  style={styles.primaryBtn}
                  onClick={() => commitDetectiveMove(activeDetective.id, pendingMove.to, pendingMove.mode)}
                >
                  Confirm move
                </button>
              </div>
              <button style={styles.linkBtn} onClick={() => setPendingMove(null)}>
                Cancel
              </button>
            </div>
          )}

          {!isMyTurnToAct && myRole !== null && (
            <div style={styles.ruleNote}>Waiting for {isMrXTurn ? mrxName() : detectiveName(activeDetective.id)}...</div>
          )}

          <div style={styles.legend}>
            {Object.entries(activeMode).map(([key, m]) => (
              <div key={key} style={styles.legendItem}>
                <span style={{ ...styles.legendDot, background: m.color }} />
                {m.label}
              </div>
            ))}
          </div>
        </div>

        <div style={styles.boardColumnFull}>
          <div
            style={{
              ...styles.boardWrap,
              maxWidth: Math.min(1400, baseW * 10),
              aspectRatio: `${baseW} / ${baseH}`,
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`${pan.x} ${pan.y} ${viewSizeW} ${viewSizeH}`}
              style={{
                ...styles.board,
                width: "100%",
                height: "100%",
                maxWidth: "none",
                cursor: zoom > 1 ? "grab" : "default",
                touchAction: "none",
              }}
              onWheel={handleWheel}
              onMouseDown={handlePointerDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={() => (dragState.current = null)}
            >
              <defs>
                <linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#bcdcea" />
                  <stop offset="100%" stopColor="#a7cede" />
                </linearGradient>
                <radialGradient id="lakeGrad" cx="50%" cy="40%" r="65%">
                  <stop offset="0%" stopColor="#bfe0ec" />
                  <stop offset="100%" stopColor="#9ccbdb" />
                </radialGradient>
                <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#a8cbdb" />
                  <stop offset="100%" stopColor="#88b3c9" />
                </linearGradient>
                <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="0.3" stdDeviation="0.4" floodColor="#000" floodOpacity="0.25" />
                </filter>
                <filter id="iconShadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="0.15" stdDeviation="0.25" floodColor="#000" floodOpacity="0.35" />
                </filter>
                <filter id="regionShadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0.4" stdDeviation="0.6" floodColor="#3d4a3a" floodOpacity="0.18" />
                </filter>
              </defs>

              <MapBackground map={map} />
              <MapFrameAndCompass map={map} />

              {map.allRenderEdges.map(([a, b, mode], i) => {
                const [ax, ay] = map.stations[a];
                const [bx, by] = map.stations[b];
                const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                const group = map.edgeGroups[key] || [mode];
                const slot = group.indexOf(mode);
                const total = group.length;
                const mx = (ax + bx) / 2;
                const my = (ay + by) / 2;
                const dx = bx - ax,
                  dy = by - ay;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const nx = -dy / len,
                  ny = dx / len;
                const spread = 1.6;
                const offset = total > 1 ? (slot - (total - 1) / 2) * spread : 0;
                const cx = mx + nx * offset;
                const cy = my + ny * offset;
                const strokeW = mode === "underground" ? 0.45 : mode === "bus" ? 0.35 : mode === "ferry" ? 0.42 : 0.24;
                const taxiFadeOpacity = zoom < 1.6 ? 0.35 : 0.85;
                const lineOpacity = mode === "taxi" ? taxiFadeOpacity : 0.85;
                return (
                  <g key={`${key}-${mode}-${i}`}>
                    <path
                      d={`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={strokeW + 0.35}
                      strokeLinecap="round"
                      opacity={mode === "taxi" ? taxiFadeOpacity * 0.9 : 0.9}
                    />
                    <path
                      d={`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`}
                      fill="none"
                      stroke={activeMode[mode].color}
                      strokeWidth={strokeW}
                      strokeDasharray={mode === "ferry" ? "1.2,0.8" : undefined}
                      opacity={lineOpacity}
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}

              {Object.entries(map.stations).map(([id, [x, y]]) => {
                const numId = Number(id);
                const isLegal = legalTargets.has(numId);
                const detHere = match.detectives.find((d) => d.pos === numId);
                const mrXHere = showMrXPos && match.mrX.pos != null && numId === match.mrX.pos;
                const isLastKnown = !isMrXTurn && match.mrX.revealedPos === numId;
                const dangerTarget = isMrXTurn && isLegal && detHere;
                let fill = "#ffffff";
                let stroke = "#8a8375";
                if (detHere) {
                  fill = detHere.color;
                  stroke = "#fff";
                }
                if (mrXHere) {
                  fill = "#1a1a1a";
                  stroke = "#fff";
                }
                if (isLastKnown) {
                  fill = "#1a1a1a";
                  stroke = "#e11";
                }

                const sizeScale = 1;
                const nodeR = 1.6 * sizeScale;
                const isMajor = map.majorStations && map.majorStations.has(numId);
                const labelDir = isMajor ? map.majorLabelDir && map.majorLabelDir[numId] : map.minorLabelDir && map.minorLabelDir[numId];

                const DIR_VECS = {
                  N: [0, -1],
                  S: [0, 1],
                  E: [1, 0],
                  W: [-1, 0],
                  NE: [0.707, -0.707],
                  NW: [-0.707, -0.707],
                  SE: [0.707, 0.707],
                  SW: [-0.707, 0.707],
                };
                const ANCHOR_FOR_DIR = {
                  E: "start",
                  NE: "start",
                  SE: "start",
                  W: "end",
                  NW: "end",
                  SW: "end",
                  N: "middle",
                  S: "middle",
                };

                return (
                  <g key={id} onClick={() => handleStationClick(numId)} style={{ cursor: isLegal ? "pointer" : "default" }}>
                    <circle cx={x} cy={y} r={2.6 * sizeScale} fill="transparent" />
                    {isLegal && !dangerTarget && (
                      <circle cx={x} cy={y} r={nodeR + 0.7} fill="none" stroke="#1a1a1a" strokeWidth={0.25} strokeDasharray="0.7,0.7" opacity={0.7} />
                    )}
                    {dangerTarget && (
                      <circle cx={x} cy={y} r={nodeR + 0.9} fill="none" stroke="#c0392b" strokeWidth={0.4} strokeDasharray="0.5,0.5" />
                    )}
                    {isLastKnown && (
                      <circle cx={x} cy={y} r={nodeR + 1.4} fill="none" stroke="#e11" strokeWidth={0.35} opacity={0.8}>
                        <animate attributeName="r" values={`${nodeR + 1}; ${nodeR + 2.2}; ${nodeR + 1}`} dur="1.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.6s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx={x} cy={y} r={nodeR} fill={fill} stroke={stroke} strokeWidth={0.35} filter="url(#softShadow)" />
                    {[...map.stationModes[id]].map((m, mi, arr) => {
                      const angle = (mi / arr.length) * 2 * Math.PI - Math.PI / 2;
                      const dotR = nodeR + 0.55;
                      const dx2 = Math.cos(angle) * dotR;
                      const dy2 = Math.sin(angle) * dotR;
                      return <circle key={m} cx={x + dx2} cy={y + dy2} r={0.42} fill={activeMode[m].color} stroke="#fff" strokeWidth={0.12} />;
                    })}
                    <text
                      x={x}
                      y={y + 0.55 * sizeScale}
                      fontSize={1.35 * sizeScale}
                      textAnchor="middle"
                      fill={detHere || mrXHere || isLastKnown ? "#ffffff" : map.id === "bengaluru" ? "#3c4043" : "#5c5648"}
                      fontWeight="700"
                    >
                      {id}
                    </text>
                    {map.names &&
                      labelDir &&
                      (() => {
                        const dvec = DIR_VECS[labelDir];
                        const dist = (isMajor ? 3.0 : 2.3) * sizeScale;
                        const lx = x + dvec[0] * dist;
                        const ly = y + dvec[1] * dist + (dvec[1] === 0 ? 0.5 * sizeScale : 0);
                        return (
                          <text
                            x={lx}
                            y={ly}
                            fontSize={(isMajor ? 1.6 : 1.1) * sizeScale}
                            textAnchor={ANCHOR_FOR_DIR[labelDir]}
                            fill={isMajor ? "#1a1a1a" : "#5f6368"}
                            fontWeight={isMajor ? 700 : 600}
                            stroke="#ffffff"
                            strokeWidth={(isMajor ? 0.35 : 0.28) * sizeScale}
                            paintOrder="stroke"
                          >
                            {map.names[id]}
                          </text>
                        );
                      })()}
                    {map.names && <title>{map.names[id]}</title>}
                  </g>
                );
              })}
            </svg>
            <div style={styles.zoomControls}>
              <button style={styles.zoomBtn} onClick={() => zoomBy(1.4)} aria-label="Zoom in">
                +
              </button>
              <button style={styles.zoomBtn} onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
                −
              </button>
              {zoom > 1 && (
                <button style={styles.zoomResetBtn} onClick={resetView}>
                  Reset view
                </button>
              )}
            </div>
          </div>

          <div style={styles.legend}>
            {Object.entries(activeMode).map(([key, m]) => (
              <div key={key} style={styles.legendItem}>
                <span style={{ ...styles.legendDot, background: m.color }} />
                {m.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TicketChip({ mode, count, modeTheme }) {
  const m = (modeTheme || MODE_DEFAULT)[mode];
  return (
    <div style={{ ...styles.chip, borderColor: m.color }}>
      <span style={{ ...styles.chipDot, background: m.color }} />
      {m.short} {count}
    </div>
  );
}

export const styles = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100vh",
    background: "#f7f6f3",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: 16,
    boxSizing: "border-box",
  },
  pagePlaying: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    height: "100vh",
    background: "#f7f6f3",
    boxSizing: "border-box",
    padding: 16,
    overflow: "hidden",
  },
  playingLayoutSidebar: {
    position: "relative",
    display: "flex",
    flexDirection: "row",
    height: "100%",
    width: "100%",
    maxWidth: 1920,
    margin: "0 auto",
    gap: 0,
  },
  sidebarPermanent: {
    width: 420,
    flexShrink: 0,
    height: "100%",
    background: "#f7f6f3",
    overflowY: "auto",
    padding: "24px 24px 48px",
    boxShadow: "2px 0 12px rgba(0,0,0,0.06)",
    boxSizing: "border-box",
  },
  boardColumnFull: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: 0,
    overflowY: "auto",
    minWidth: 0,
    padding: "24px",
  },
  setupCard: {
    background: "#fff",
    borderRadius: 16,
    padding: 28,
    maxWidth: 640,
    width: "100%",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    textAlign: "center",
  },
  title: { margin: "0 0 4px", fontSize: 28, letterSpacing: -0.5 },
  subtitle: { color: "#777", marginBottom: 20, fontSize: 14 },
  label: { display: "block", fontSize: 13, color: "#555", marginBottom: 8, fontWeight: 600 },
  rowCenter: { display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" },
  characterPickerGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 8,
  },
  characterPickerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  characterSelect: {
    flex: 1,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1.5px solid #ddd",
    fontSize: 14,
    background: "#fff",
  },
  mapPill: {
    border: "1.5px solid #ddd",
    background: "#fff",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
    minWidth: 140,
  },
  mapPillActive: { borderColor: "#111", background: "#111", color: "#fff" },
  pill: {
    border: "1.5px solid #ddd",
    background: "#fff",
    borderRadius: 999,
    padding: "8px 16px",
    fontSize: 15,
    cursor: "pointer",
  },
  pillActive: { borderColor: "#111", background: "#111", color: "#fff" },
  rulesBox: {
    textAlign: "left",
    background: "#f4f2ec",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 13.5,
    color: "#444",
    margin: "20px 0",
  },
  primaryBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
    marginTop: 6,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#888",
    marginTop: 10,
    cursor: "pointer",
    fontSize: 13,
    textDecoration: "underline",
  },
  handoffCard: {
    background: "#111",
    color: "#fff",
    borderRadius: 20,
    padding: "56px 40px",
    textAlign: "center",
    maxWidth: 460,
    width: "100%",
    marginTop: "18vh",
  },
  handoffIcon: { fontSize: 40, marginBottom: 12 },
  handoffName: { fontSize: 26, fontWeight: 700, marginBottom: 4 },
  headerBar: {
    width: "100%",
    maxWidth: 760,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  roundLabel: { fontSize: 12, color: "#888" },
  turnLabel: { fontSize: 18, fontWeight: 700 },
  ticketsPanel: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 220 },
  chip: {
    border: "1.5px solid #ccc",
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#fff",
  },
  chipDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block" },
  boardWrap: {
    position: "relative",
    width: "100%",
    maxHeight: "100%",
  },
  board: {
    width: "100%",
    maxWidth: 760,
    borderRadius: 16,
    boxShadow: "0 2px 14px rgba(0,0,0,0.1)",
    overflow: "hidden",
    display: "block",
  },
  zoomControls: {
    position: "absolute",
    right: 10,
    bottom: 10,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "flex-end",
  },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: "1px solid #d7d2c4",
    background: "#fff",
    color: "#333",
    fontSize: 18,
    fontWeight: 700,
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
    cursor: "pointer",
    lineHeight: 1,
  },
  zoomResetBtn: {
    fontSize: 10,
    color: "#555",
    background: "#fff",
    border: "1px solid #d7d2c4",
    borderRadius: 6,
    padding: "3px 6px",
    cursor: "pointer",
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
  },
  detectiveOverviewPanel: {
    width: "100%",
    maxWidth: 760,
    background: "#fff",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  detectiveOverviewRow: { display: "flex", flexDirection: "column", gap: 6 },
  detectiveOverviewCard: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    flexWrap: "wrap",
  },
  detectiveOverviewDot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  miniChip: {
    fontWeight: 700,
    fontSize: 11,
    border: "1px solid currentColor",
    borderRadius: 5,
    padding: "1px 4px",
  },
  logBoard: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(24px, 1fr))",
    gap: 3,
  },
  logBoardCell: {
    border: "1px solid #ddd7c4",
    borderRadius: 5,
    padding: "2px 1px",
    textAlign: "center",
    background: "#fbf9f2",
    minHeight: 32,
  },
  logBoardCellReveal: {
    border: "1.5px solid #c0392b",
    background: "#fdecea",
  },
  logBoardCellFuture: {
    opacity: 0.55,
  },
  logBoardRoundNum: { fontSize: 7, color: "#8a8375", fontWeight: 700, lineHeight: 1.1 },
  logBoardModeTag: {
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 4,
    marginTop: 2,
    padding: "1px 0",
  },
  logBoardModeTagEmpty: { fontSize: 10, marginTop: 2, color: "#c0392b" },
  logBoardLegendNote: { fontSize: 11, color: "#999", marginTop: 8 },
  nextRevealBanner: {
    fontSize: 12.5,
    fontWeight: 700,
    color: "#a33",
    background: "#fdecea",
    border: "1.3px solid #e0a8a8",
    borderRadius: 8,
    padding: "6px 10px",
    marginBottom: 8,
  },
  travelLogPanel: {
    width: "100%",
    maxWidth: 760,
    background: "#fff",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  travelLogTitle: { fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6 },
  travelLogRow: { display: "flex", gap: 5, flexWrap: "wrap" },
  travelLogChip: {
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 6,
    padding: "3px 6px",
  },
  travelLogReveal: { fontSize: 12, color: "#a33", marginTop: 8, fontWeight: 600 },
  doubleBtn: {
    border: "1.5px solid #6b4fa0",
    color: "#6b4fa0",
    background: "#f4effa",
    borderRadius: 10,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    marginTop: 8,
  },
  ruleNote: {
    width: "100%",
    maxWidth: 760,
    marginTop: 8,
    fontSize: 12,
    color: "#8a5a3a",
    textAlign: "center",
  },
  messageBar: {
    width: "100%",
    maxWidth: 760,
    marginTop: 10,
    fontSize: 13,
    color: "#a33",
    textAlign: "center",
  },
  ticketChooser: {
    marginTop: 14,
    background: "#fff",
    borderRadius: 12,
    padding: 16,
    textAlign: "center",
    maxWidth: 760,
    width: "100%",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  },
  legend: {
    display: "flex",
    gap: 14,
    marginTop: 14,
    fontSize: 12,
    color: "#666",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  legendItem: { display: "flex", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block" },
  revealPathBox: {
    textAlign: "left",
    background: "#fdf6ea",
    borderRadius: 10,
    padding: 12,
    margin: "14px 0",
  },
  logBox: { textAlign: "left", background: "#f4f2ec", borderRadius: 10, padding: 12, margin: "14px 0", fontSize: 13 },
  logLine: { padding: "2px 0", borderBottom: "1px solid #e5e2d8" },
};
