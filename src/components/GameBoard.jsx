import React, { useState, useMemo, useEffect } from "react";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";
import { useHighlightStyles } from "../lib/useHighlightStyles.js";
import HighlightRing from "./HighlightRing.jsx";
import MovePopup from "./MovePopup.jsx";
import { useMoveAnimation } from "../lib/useMoveAnimation.js";
import { useFeatureEnabled } from "../lib/useFeatureEnabled.js";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import {
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
// timerBarColor — smooth linear interpolation across three stops (green
// at full time, yellow at half time, red as time runs out), so the turn
// timer bar's color genuinely CHANGES continuously as time reduces,
// rather than snapping abruptly at one threshold.
function timerBarColor(fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  // Stops: 1.0 -> green (#2e9e4f), 0.5 -> yellow (#e0b400), 0.0 -> red (#c0392b)
  const stops = [
    { at: 1.0, color: [46, 158, 79] },
    { at: 0.5, color: [224, 180, 0] },
    { at: 0.0, color: [192, 57, 43] },
  ];
  let lower = stops[1], upper = stops[0];
  if (f <= 0.5) {
    lower = stops[2];
    upper = stops[1];
  }
  const span = upper.at - lower.at;
  const t = span === 0 ? 0 : (f - lower.at) / span;
  const [r1, g1, b1] = lower.color;
  const [r2, g2, b2] = upper.color;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// EDGE_MARGIN: a small buffer added around every map's own declared
// viewW/viewH so stations sitting right at (or slightly past) the
// nominal edge -- and their labels, which extend further out from the
// node than the node itself -- have room to render fully on-canvas.
// ASYMMETRIC, not a uniform margin on all four sides: checked the actual
// overflow on the real map data (Bengaluru's Airport sits at y=-1.19,
// the only station anywhere near an edge) and a uniform 6-unit margin
// was wildly oversized for that -- it left roughly 9-10% of the visible
// canvas as pure empty space on every side, most of it solving nothing
// (the left/right/bottom edges had no actual overflow at all, up to
// 9-11 units of natural clearance already). This targets just enough
// margin on the TOP (where the real, measured problem is: ~1.2 units of
// coordinate overflow + a "N"-direction label needs roughly 5 units of
// clearance above a major station) while keeping the other three sides
// minimal, so the map fills the available canvas rather than floating
// in a mostly-empty box.
const EDGE_MARGIN_TOP = 5;
const EDGE_MARGIN_OTHER = 1;

export default function GameBoard({
  map,
  match,
  myRole, // null (pass-and-play) | "mrx" | "d0" | "d1" | ... (multiplayer)
  roomId = null, // null in pass-and-play (no room-level override applies); the real room id in multiplayer
  mrxName,
  detectiveName,
  onDetectiveMove,
  onMrXMove,
  onActivateDoubleMove,
  onPassTurn, // (actor) => void -- called when the current actor genuinely has zero legal moves; fixes the real bug where this situation permanently soft-locked the game
  extraHeaderContent, // e.g. a "pass to X" banner slot in pass-and-play; votes in multiplayer -- renders at the very TOP, above everything else
  belowTicketsContent, // e.g. chat in multiplayer -- renders AFTER the log/tickets panels, per the agreed sidebar order (votes -> huddle -> explorer -> log -> tickets -> chat)
  onExploreModeChange, // (mode|null) => void -- reports this client's own explore-mode selection upward, so App.jsx can broadcast it via Presence
  teammatesExploring = [], // [{playerId, displayName, color, exploreMode}] -- OTHER detectives' current exploration, for the huddle panel (multiplayer only)
  anyDetectiveExploring = false, // true if ANY detective (including possibly this client) currently has an active exploration -- drives Mr.X's content-free "Detectives are discussing" indicator
  detectivePlayerNames = {}, // detectiveId -> player display name (multiplayer only) -- for the ticket counter's "Priya — D1" labeling
  secondsRemaining = null, // null (no timer set for this room) | number of seconds left in the current turn -- shown to EVERYONE regardless of whose turn it is
  turnTimerSeconds = null, // the room's configured timer length, for showing "12 / 60s" style displays
  roomCode = null, // multiplayer only -- shown persistently so a disconnected player can be told the code to rejoin
}) {
  const { positionStyle: highlightPositionStyle, destinationStyle: highlightDestinationStyle } = useHighlightStyles(roomId); // each independently 'ring' | 'rotating' | 'blink' | 'static' | 'none'
  const { getProgress } = useMoveAnimation(match.detectives);
  // Detect a just-happened capture ending, so the collision effect knows
  // WHERE to draw itself (the station both Mr.X and the capturing
  // detective now share) -- distinct from the general ended-transition
  // delay (useDelayedEndedTransition, used by App.jsx), this is purely
  // about the VISUAL, and only meaningful for as long as this component
  // stays mounted showing the board during that brief pause.
  const lastLogEntry = match.log[match.log.length - 1];
  const isCaptureEnding =
    match.phase === "ended" &&
    lastLogEntry &&
    (lastLogEntry.kind === "detective_capture" || lastLogEntry.kind === "mrx_walked_into_detective");
  const collisionStationId = isCaptureEnding
    ? lastLogEntry.kind === "detective_capture"
      ? lastLogEntry.payload?.to
      : match.mrX.pos
    : null;
  // Which detective actually made the catch (only known for the
  // "detective_capture" ending -- when Mr.X walks into a detective
  // instead, it's the SAME collision but Mr.X's own mistake, so there's
  // no single "capturing" detective to credit; that station may also
  // have multiple detectives on it in principle, though in practice only
  // one can legally occupy a station at a time). Used to color the catch
  // effect with the actual detective's color instead of a generic red,
  // so it reads as "Priya caught Mr.X" rather than a generic system event.
  const capturingDetective =
    isCaptureEnding && lastLogEntry.kind === "detective_capture"
      ? match.detectives.find((d) => d.id === lastLogEntry.payload?.detId)
      : null;
  const collisionColor = capturingDetective ? capturingDetective.color : "#c0392b";
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: -EDGE_MARGIN_OTHER, y: -EDGE_MARGIN_TOP });
  const [pendingMove, setPendingMove] = useState(null);
  const [exploreMode, setExploreMode] = useState(null); // null | "taxi" | "bus" | "underground" -- which mode's reachable stations to highlight
  const [exploreFromDetectiveId, setExploreFromDetectiveId] = useState(null); // which of MY OWN detectives to explore from, if I control more than one
  const [peekedTeammateId, setPeekedTeammateId] = useState(null); // playerId whose exploration we're currently peeking at, via the huddle panel

  // Report our own explore-mode selection upward so App.jsx can
  // broadcast it via Presence -- teammates' huddle panels update live
  // off this, and it correctly clears (broadcasts null) the moment we
  // clear our own selection, so nothing lingers stale for others.
  useEffect(() => {
    onExploreModeChange && onExploreModeChange(exploreMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreMode]);
  const routeExplorerEnabled = useFeatureEnabled("route_explorer_enabled", roomId);
  const [message, setMessage] = useState("");
  const dragState = React.useRef(null);
  const svgRef = React.useRef(null);

  // Converts a station's coordinates (in the SVG's own viewBox
  // coordinate space, e.g. 0-100) into actual SCREEN pixels, accounting
  // for the SVG's current pan/zoom state and its rendered size/position
  // on the page -- this is what lets MovePopup stay visually anchored to
  // the right station regardless of zoom level or how far the map has
  // been panned. Mirrors the exact same conversion factor already used
  // by the existing drag-to-pan handlers above (rect.width/viewSizeW),
  // just applied to a fixed station position instead of a mouse delta.
  function svgPointToScreenPoint(svgX, svgY) {
    if (!svgRef.current) return { x: window.innerWidth / 2, y: window.innerHeight / 2, fallback: true, openDirection: "center" };
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2, fallback: true, openDirection: "center" };
    }
    const px = rect.left + ((svgX - pan.x) / viewSizeW) * rect.width;
    const py = rect.top + ((svgY - pan.y) / viewSizeH) * rect.height;
    // Real bug fix: previously the popup always opened ABOVE the clicked
    // station, with no check for whether there was actually room --
    // a station near the top of the screen would push the popup
    // partially or fully off-screen, with no way to reach its buttons
    // (since it only closes via its own explicit X). Now: check the
    // ACTUAL viewport (window.innerHeight/innerWidth, not any assumed
    // size) for real available space in each direction, and tell
    // MovePopup which way to open instead.
    const POPUP_HEIGHT_ESTIMATE = 160; // generous estimate of the popup's own rendered height
    const POPUP_WIDTH_ESTIMATE = 220;
    const openDirection =
      py < POPUP_HEIGHT_ESTIMATE + 20
        ? "below"
        : px < POPUP_WIDTH_ESTIMATE / 2 + 10
          ? "right"
          : px > window.innerWidth - POPUP_WIDTH_ESTIMATE / 2 - 10
            ? "left"
            : "above";
    return { x: px, y: py, fallback: false, openDirection };
  }

  const activeMode = map.modeTheme || MODE_DEFAULT;
  const stationLabel = (id) => (map.names ? `${map.names[id]} (#${id})` : `station ${id}`);

  const actor = currentActor(match); // whose turn is it, regardless of who's viewing
  const isMrXTurn = actor === "mrx";
  const activeDetective = actor && actor !== "mrx" ? match.detectives[parseInt(actor.slice(1))] : null;

  // Defensive safeguard: clear any leftover "Selected [station]..."
  // message and pending-move state whenever the actual active turn
  // changes (new round, or turn passed to the next actor). This is IN
  // ADDITION TO the real fix (commitMrXMove was missing setMessage(""),
  // which is why the confirmation text stayed visible even after the
  // turn had already moved on) -- catching the symptom here too means
  // this exact class of stale-message bug can't resurface via some
  // other path we haven't found yet.
  useEffect(() => {
    setMessage("");
    setPendingMove(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, match.round]);

  // In pass-and-play, myRole is null, so "it's my turn to act" collapses
  // to "it's this device's turn" (== whoever the current actor is, since
  // the device controls everyone). In multiplayer, only the player whose
  // role CONTAINS the current actor can act -- myRole can be a
  // comma-joined list for a multi-detective seat (e.g. "d0,d1,d2"), so
  // this must be a membership check, not exact string equality (a plain
  // === here was a real bug: a player controlling multiple detectives
  // could never act on any of their seats except via exact single-role
  // match, which never happens once a role is comma-joined). A third
  // case, isSpectator, means "no role at all, and no permission to act
  // as anyone" -- unlike pass-and-play's myRole===null (which means
  // "this device controls everyone"), a spectator controls nobody.
  const isSpectator = myRole === "__spectator__";
  const myRoleSeats = !isSpectator && myRole ? myRole.split(",") : [];
  const controlsSeat = (seat) => myRole === null || myRoleSeats.includes(seat);
  const isMyTurnToAct = !isSpectator && controlsSeat(actor);
  const iAmMrX = !isSpectator && myRole === "mrx";
  const iAmDetective = !isSpectator && myRole && myRole !== "mrx";
  // myDetective is "whichever of my detectives currently has the turn" --
  // only meaningful during that detective's own turn; a multi-detective
  // player's "my detective" is whoever the CURRENT ACTOR is among their
  // seats, not a single fixed detective (they might control several).
  const myDetective = iAmDetective && activeDetective && controlsSeat(actor) ? activeDetective : null;
  // myOwnDetectives: EVERY detective this player controls, regardless of
  // whose turn it currently is -- used by the route explorer, which (per
  // project design) is available anytime, not just on your own turn, so
  // detectives can coordinate continuously rather than only in the
  // narrow window of their own move. Pass-and-play (myRole===null) has
  // no real "own detective" concept here since the device controls
  // everyone -- the explorer stays turn-gated in that mode (see
  // isMyTurnToAct usage below), since there's no multiplayer
  // coordination to enable in the first place.
  const myOwnDetectives =
    iAmDetective && myRoleSeats.length > 0
      ? match.detectives.filter((d) => myRoleSeats.includes(`d${d.id}`))
      : [];

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const baseW = (map.viewW || 100) + EDGE_MARGIN_OTHER * 2;
  const baseH = (map.viewH || 100) + EDGE_MARGIN_TOP + EDGE_MARGIN_OTHER;
  const viewSizeW = baseW / zoom;
  const viewSizeH = baseH / zoom;
  const maxPanX = baseW - viewSizeW;
  const maxPanY = baseH - viewSizeH;
  const clampPan = (p) => ({
    x: Math.max(-EDGE_MARGIN_OTHER, Math.min(maxPanX - EDGE_MARGIN_OTHER, p.x)),
    y: Math.max(-EDGE_MARGIN_TOP, Math.min(maxPanY - EDGE_MARGIN_TOP, p.y)),
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
    setPan({ x: -EDGE_MARGIN_OTHER, y: -EDGE_MARGIN_TOP });
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
    if (activeDetective && controlsSeat(actor)) {
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

  // Route explorer: for whoever's turn it is, compute every station
  // reachable via a SPECIFIC transport mode from their current position
  // (following that mode's edges only, any number of hops -- this is a
  // "what's out there" exploratory view, not a ticket-budgeted move
  // preview, so it doesn't stop at however many tickets they hold for
  // that mode). Purely client-side: the map's graph is already fully
  // loaded, no server round-trip needed.
  // The detective this client is currently exploring FROM. In
  // multiplayer, this is always available (any of MY OWN detectives, at
  // any time) -- defaulting to the first one I control, or whichever I
  // explicitly picked via exploreFromDetectiveId if I control several.
  // In pass-and-play, there's no persistent "my own detective" concept
  // (myRole is null, the device controls everyone) -- the explorer stays
  // tied to whoever's turn it currently is, same as before.
  const exploringDetective =
    myRole === null
      ? activeDetective
      : myOwnDetectives.find((d) => d.id === exploreFromDetectiveId) || myOwnDetectives[0] || null;

  function computeReachableFrom(fromPos, mode) {
    // Shows only the DIRECT, one-hop legal destinations for this mode --
    // i.e. the actual stations you could move to right now by spending
    // one ticket of this type, not "everywhere eventually reachable via
    // unlimited hops of this mode." The taxi tier especially is a dense,
    // fully-connected local mesh (by design), so an unbounded walk would
    // reach nearly the entire map -- which is exactly the bug this fixes
    // (confirmed: taxi was highlighting almost every station).
    if (!mode || fromPos == null) return new Set();
    const reachable = new Set();
    for (const edge of map.graph[fromPos] || []) {
      if (edge.mode === mode) reachable.add(edge.to);
    }
    return reachable;
  }

  const exploreReachable = useMemo(() => {
    if (isMrXTurn) {
      // Mr.X's own explorer (still turn-gated -- Mr.X doesn't have a
      // "coordinate anytime" use case the way detectives do) uses his
      // actual position, only ever visible on his own client to begin
      // with (match.mrX.pos is null for everyone else).
      if (!exploreMode) return new Set();
      return computeReachableFrom(match.mrX.pos, exploreMode);
    }
    if (!exploreMode || !exploringDetective) return new Set();
    return computeReachableFrom(exploringDetective.pos, exploreMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreMode, isMrXTurn, match.mrX.pos, exploringDetective, map]);

  // The PEEKED teammate's reachable stations -- computed the same way,
  // from THEIR position (their own detective's current pos, looked up
  // by their broadcast role) and THEIR broadcast exploreMode, so peeking
  // shows exactly what they're currently seeing, live.
  const peekedTeammateData = teammatesExploring.find((t) => t.playerId === peekedTeammateId);
  const peekedReachable = useMemo(() => {
    if (!peekedTeammateData || !peekedTeammateData.exploreMode) return new Set();
    const theirDetective = match.detectives.find((d) => `d${d.id}` === peekedTeammateData.detectiveSeat);
    if (!theirDetective) return new Set();
    return computeReachableFrom(theirDetective.pos, peekedTeammateData.exploreMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peekedTeammateData, match.detectives, map]);

  // Which modes the exploring detective (or Mr.X, on his own turn)
  // actually holds at least one ticket for -- only these are offered as
  // explore buttons, per project design ("this should take into account
  // whether the player has that ticket"). Black tickets aren't
  // mode-specific, so they're excluded entirely -- there's no single
  // "black route" to show.
  const myCurrentTickets = isMrXTurn ? match.mrX.tickets : exploringDetective?.tickets;
  const exploreModeOptions = myCurrentTickets
    ? Object.entries(myCurrentTickets)
        .filter(([mode, count]) => (mode === "taxi" || mode === "bus" || mode === "underground") && count > 0)
        .map(([mode]) => mode)
    : [];

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
      if (!controlsSeat(actor)) return; // multiplayer: not your role
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
    setMessage("");
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
                Round {match.round} / {match.maxRounds}
              </div>
              <div style={styles.turnLabel}>
                {!isMrXTurn && (
                  <span style={{ ...styles.turnColorDot, background: activeDetective.color }} />
                )}
                {isMrXTurn ? `${mrxName()}'s Turn` : `${detectiveName(activeDetective.id)}'s Turn`}
              </div>
              {secondsRemaining != null && turnTimerSeconds && (
                <div style={styles.turnTimerBarWrap}>
                  <div style={styles.turnTimerBarTrack}>
                    <div
                      style={{
                        ...styles.turnTimerBarFill,
                        width: `${Math.max(0, Math.min(100, (secondsRemaining / turnTimerSeconds) * 100))}%`,
                        background: timerBarColor(secondsRemaining / turnTimerSeconds),
                      }}
                    />
                  </div>
                  <div style={styles.turnTimerBarText}>{secondsRemaining}s</div>
                </div>
              )}
              {roomCode && <div style={styles.roomCodeLabel}>Room code: {roomCode}</div>}
              <div style={styles.legendCompact}>
                {Object.entries(activeMode).map(([key, m]) => (
                  <span key={key} style={styles.legendCompactItem}>
                    <span style={{ ...styles.legendDot, background: m.color }} />
                    {m.label}
                  </span>
                ))}
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

          {isMrXTurn && isMyTurnToAct && !pendingMove && (
            <div style={{ ...styles.rowCenter, justifyContent: "flex-end", marginBottom: 8 }}>
              <button
                style={{
                  ...styles.doubleBtnCompact,
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

          {extraHeaderContent}

          {isMrXTurn && anyDetectiveExploring && (
            <div style={styles.huddleAmbientNote}>👀 Detectives are discussing...</div>
          )}

          {iAmDetective && teammatesExploring.length > 0 && (
            <div style={styles.huddlePanel}>
              <div style={styles.exploreLabel}>Teammates exploring:</div>
              {teammatesExploring.map((t) => (
                <button
                  key={t.playerId}
                  style={{
                    ...styles.huddleRow,
                    ...(peekedTeammateId === t.playerId ? styles.huddleRowActive : {}),
                  }}
                  onClick={() => setPeekedTeammateId(peekedTeammateId === t.playerId ? null : t.playerId)}
                >
                  <span style={{ ...styles.huddleDot, background: t.color }} />
                  {t.displayName}: {activeMode[t.exploreMode]?.label || t.exploreMode}
                  {peekedTeammateId === t.playerId ? " (peeking)" : ""}
                </button>
              ))}
            </div>
          )}

          {(isMrXTurn ? isMyTurnToAct : iAmDetective || myRole === null) && routeExplorerEnabled && exploreModeOptions.length > 0 && (
            <div style={styles.exploreRow}>
              {myOwnDetectives.length > 1 && (
                <select
                  style={styles.exploreDetectivePicker}
                  value={exploringDetective?.id ?? ""}
                  onChange={(e) => {
                    setExploreFromDetectiveId(Number(e.target.value));
                    setExploreMode(null); // switching whose position we explore from clears any active highlight, since it'd otherwise show stale reachability from the previous detective
                  }}
                >
                  {myOwnDetectives.map((d) => (
                    <option key={d.id} value={d.id}>
                      Explore from {isWesteros ? detectiveName(d.id) : `Detective ${d.id + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <span style={styles.exploreLabel}>Show reachable stations by:</span>
              {exploreModeOptions.map((mode) => (
                <button
                  key={mode}
                  style={{
                    ...styles.exploreBtn,
                    ...(exploreMode === mode ? { ...styles.exploreBtnActive, borderColor: activeMode[mode].color } : {}),
                  }}
                  onClick={() => setExploreMode(exploreMode === mode ? null : mode)}
                >
                  {activeMode[mode].label}
                </button>
              ))}
              {exploreMode && (
                <button style={styles.exploreClearBtn} onClick={() => setExploreMode(null)}>
                  Clear
                </button>
              )}
            </div>
          )}

          <div style={styles.travelLogPanel}>
            <div style={styles.travelLogTitle}>
              {mrxName()}'s travel log ({match.maxRounds + 2} moves max — {match.maxRounds} rounds + 2 double-move legs)
            </div>
              {(() => {
                const nextReveal = [...match.revealRounds].filter((r) => r >= match.round).sort((a, b) => a - b)[0];
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
                {Array.from({ length: match.maxRounds + 2 }, (_, i) => i + 1).map((moveNum) => {
                  const entry = match.mrX.travelLog.find((e) => e.move === moveNum);
                  const belongsToRevealRound = entry && match.revealRounds.includes(entry.round);
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
              {match.mrX.revealedPos && match.mrX.lastRevealRound === match.round && (
                <div style={styles.travelLogReveal}>
                  Last confirmed sighting: {stationLabel(match.mrX.revealedPos)} (round {match.mrX.lastRevealRound})
                </div>
              )}
            </div>

          <div style={styles.allTicketsPanel}>
            <div style={styles.travelLogTitle}>Everyone's tickets</div>
            <div style={styles.detectiveOverviewRow}>
              <div style={styles.detectiveOverviewCard}>
                <div style={{ ...styles.detectiveOverviewDot, background: "#1a1a1a" }} />
                <span style={{ fontWeight: 700, marginRight: 4 }}>{mrxName()}</span>
                {Object.entries(match.mrX.tickets).map(([mode, count]) => (
                  <span key={mode} style={{ ...styles.miniChip, color: activeMode[mode] ? activeMode[mode].color : "#666" }}>
                    {mode === "double" ? "2x" : activeMode[mode].short}
                    {count}
                  </span>
                ))}
              </div>
              {match.detectives.map((d) => {
                // Naming rules (agreed): pass-and-play (myRole===null, no
                // real player identities) keeps the old bare "Dn" label,
                // since there's nothing else to show. Multiplayer: your
                // OWN seat(s) show "You" (or "You — Character" on
                // Westeros, where players pick a fixed character rather
                // than typing their own name); other players show their
                // real display name (or their chosen character name on
                // Westeros) — never a bare seat number once real
                // identities exist.
                const isMine = controlsSeat(`d${d.id}`);
                let label;
                if (myRole === null) {
                  label = `D${d.id + 1}`;
                } else if (isWesteros) {
                  label = isMine ? `You — ${detectiveName(d.id)}` : `${detectiveName(d.id)} — D${d.id + 1}`;
                } else {
                  const playerName = detectivePlayerNames[d.id];
                  label = isMine ? `You — D${d.id + 1}` : playerName ? `${playerName} — D${d.id + 1}` : `D${d.id + 1}`;
                }
                return (
                  <div key={d.id} style={styles.detectiveOverviewCard}>
                    <div style={{ ...styles.detectiveOverviewDot, background: d.color }} />
                    <span style={{ fontWeight: 700, marginRight: 4 }}>{label}</span>
                    {Object.entries(d.tickets).map(([mode, count]) => (
                      <span key={mode} style={{ ...styles.miniChip, color: activeMode[mode].color }}>
                        {activeMode[mode].short}
                        {count}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {belowTicketsContent}

          {message && <div style={styles.messageBar}>{message}</div>}

          {isMyTurnToAct && !pendingMove && legalTargets.size === 0 && (
            <div style={styles.rowCenter}>
              <div style={styles.passTurnNote}>
                No legal moves available from your current station with your remaining tickets.
              </div>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  if (onPassTurn) onPassTurn(actor);
                }}
              >
                Pass Turn
              </button>
            </div>
          )}

          {!isMyTurnToAct && myRole !== null && (
            <div style={styles.ruleNote}>Waiting for {isMrXTurn ? mrxName() : detectiveName(activeDetective.id)}...</div>
          )}

        </div>

        <div style={styles.boardColumnFull}>
          <div
            style={{
              ...styles.boardWrap,
              // Simplest correct approach: the wrapper just fills its
              // TRUE flex-allocated box (boardColumnFull already has the
              // real available width via flex:1 and real available
              // height via height:100% cascading from pagePlaying's
              // 100vh -- no manual vh/% arithmetic needed, and no
              // aspect-ratio contradiction from trying to force both
              // axes to 100% while also constraining the ratio). The
              // actual "preserve the map's shape and fit it inside this
              // box, using whichever axis is tighter" job is handled by
              // the SVG's own native viewBox + preserveAspectRatio
              // below, which is exactly what that mechanism exists
              // for -- this replaces two earlier attempts (manual vh
              // calc(), then a width/height-swap heuristic) that were
              // both still fighting the browser's layout engine instead
              // of using the tool actually designed for this.
              width: "100%",
              height: "100%",
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`${pan.x} ${pan.y} ${viewSizeW} ${viewSizeH}`}
              preserveAspectRatio="xMidYMid meet"
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

              {[...map.allRenderEdges]
                .map((e, i) => [e, i])
                // Render taxi first, then bus, then underground/metro, then
                // ferry last -- so the rarer/more important tiers always
                // draw ON TOP of the dense taxi mesh instead of being
                // interleaved with it in data order. On a dense map (200+
                // edges), a metro or bus line that happens to be listed
                // early in the data was getting visually buried under
                // taxi lines drawn afterward, even though every edge was
                // technically rendering -- this fixes visibility without
                // touching any actual map data.
                .sort(([[, , modeA]], [[, , modeB]]) => {
                  const order = { taxi: 0, bus: 1, underground: 2, ferry: 3 };
                  return (order[modeA] ?? 0) - (order[modeB] ?? 0);
                })
                .map(([[a, b, mode], i]) => {
                const [ax, ay] = map.stations[a];
                const [bx, by] = map.stations[b];
                const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                const group = map.edgeGroups[key] || [mode];
                const slot = group.indexOf(mode);
                const total = group.length;
                const mx = (ax + bx) / 2;
                const my = (ay + by) / 2;
                // IMPORTANT: compute the perpendicular normal from a FIXED
                // reference direction (lower station id -> higher station
                // id), not from (a,b) as listed in this specific edge
                // tuple. Two parallel edges between the same pair of
                // stations don't always list their endpoints in the same
                // order in the raw data (e.g. [32,40,"underground"] but
                // [40,32,"bus"] -- this happened organically since edges
                // were added across many separate visual-editor sessions,
                // sometimes clicking the two stations in a different
                // order). If direction were taken from each edge's own
                // (a,b), the normal flips sign between the two edges, and
                // an opposite-signed offset lands at the exact SAME
                // physical point instead of the intended mirror-image
                // point -- so two "parallel" curves collapse onto each
                // other and one completely hides the other. Confirmed:
                // this was happening for real between Majestic and JP
                // Nagar's underground+bus pair, not just a theoretical
                // edge case.
                const [refX0, refY0] = a < b ? [ax, ay] : [bx, by];
                const [refX1, refY1] = a < b ? [bx, by] : [ax, ay];
                const dx = refX1 - refX0,
                  dy = refY1 - refY0;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const nx = -dy / len,
                  ny = dx / len;
                // Spread widened from 1.6 to 2.8: with the wider casing on
                // underground (strokeW 0.5+0.35=0.85) added to another
                // tier's own casing, a 1.6 total spread wasn't enough
                // separation at the midpoint of a typical edge -- the
                // thicker line's white casing could still visually swallow
                // a thinner parallel line sitting only ~0.8 units away
                // (confirmed: this was actually happening for the
                // Majestic<->JP Nagar bus+underground pair, not just a
                // theoretical risk). 2.8 keeps enough clearance even
                // between the widest (underground) and thinnest (ferry)
                // tiers.
                const spread = 2.8;
                const offset = total > 1 ? (slot - (total - 1) / 2) * spread : 0;
                const cx = mx + nx * offset;
                const cy = my + ny * offset;
                // Underground/metro gets a small additional weight boost
                // (0.5 vs the earlier 0.45) so it reads clearly even amid
                // a dense taxi mesh, since it's the rarest/most important
                // tier on the map.
                const strokeW = mode === "underground" ? 0.5 : mode === "bus" ? 0.35 : mode === "ferry" ? 0.22 : 0.32;
                const taxiFadeOpacity = zoom < 1.6 ? 0.35 : 0.85;
                const lineOpacity = mode === "taxi" ? taxiFadeOpacity : mode === "ferry" ? 0.4 : 0.85;
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
                // Real bug fix: this used to stay TRUE (and show a full
                // animated "Mr.X is here" style marker) forever after a
                // reveal, even many rounds later, which read as "Mr.X's
                // position is being revealed continuously." The sidebar
                // text ("Last confirmed sighting") already correctly
                // treats this as HISTORICAL info -- the map marker should
                // match that: strong and animated only DURING the actual
                // reveal round, then a much quieter static outline
                // Real, explicit instruction: NO marker at all should
                // remain visible on the map after the reveal round
                // passes -- not even a subtle outline. Only the exact
                // reveal round itself shows anything.
                const isCurrentReveal = isLastKnown && match.mrX.lastRevealRound === match.round;
                const isExploreReachable = exploreReachable.has(numId);
                const isPeekedReachable = peekedReachable.has(numId);
                // Turn indicator: for a detective's turn, this is visible
                // to EVERYONE (their position is always public). For
                // Mr.X's own turn, a SEPARATE private indicator is shown
                // -- but only ever rendered on Mr.X's own client (gated
                // by mrXHere, which itself only ever becomes true when
                // showMrXPos is true, i.e. this is Mr.X's own view of
                // their own position -- see showMrXPos's definition
                // above). Detectives' clients never receive a truthy
                // mrXHere for a hidden position, so this can never leak
                // Mr.X's location to anyone else -- it reuses the exact
                // same hidden-state boundary the rest of the board
                // already relies on, not a new one.
                const isCurrentTurnStation = !isMrXTurn && activeDetective && numId === activeDetective.pos;
                const isMrXOwnTurnIndicator = isMrXTurn && mrXHere;
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
                if (isCurrentReveal) {
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
                    {isLegal && (
                      <HighlightRing x={x} y={y} radius={nodeR + 0.7} color="#1a1a1a" strokeWidth={0.25} dashed style={highlightDestinationStyle} />
                    )}
                    {isExploreReachable && (
                      <circle
                        cx={x}
                        cy={y}
                        r={nodeR + 1.0}
                        fill={activeMode[exploreMode].color}
                        opacity={0.22}
                        stroke={activeMode[exploreMode].color}
                        strokeWidth={0.3}
                      />
                    )}
                    {isPeekedReachable && (
                      <circle
                        cx={x}
                        cy={y}
                        r={nodeR + 1.4}
                        fill="none"
                        stroke={peekedTeammateData?.color || "#666"}
                        strokeWidth={0.35}
                        strokeDasharray="0.4,0.4"
                        opacity={0.85}
                      />
                    )}
                    {isCurrentReveal && (
                      <circle cx={x} cy={y} r={nodeR + 1.4} fill="none" stroke="#e11" strokeWidth={0.35} opacity={0.8}>
                        <animate attributeName="r" values={`${nodeR + 1}; ${nodeR + 2.2}; ${nodeR + 1}`} dur="1.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.6s" repeatCount="indefinite" />
                      </circle>
                    )}
                    {isCurrentTurnStation && highlightPositionStyle !== "blink" && (
                      <HighlightRing x={x} y={y} radius={nodeR + 1.2} color={activeDetective.color} strokeWidth={0.4} style={highlightPositionStyle} />
                    )}
                    {isMrXOwnTurnIndicator && highlightPositionStyle !== "blink" && (
                      <HighlightRing x={x} y={y} radius={nodeR + 1.2} color="#1a1a1a" strokeWidth={0.4} style={highlightPositionStyle} />
                    )}
                    <circle cx={x} cy={y} r={nodeR} fill={fill} stroke={stroke} strokeWidth={0.35} filter="url(#softShadow)">
                      {/* Blink style: animates the actual node's own fill
                          opacity, per project request, instead of a
                          separate ring -- applied to whichever station
                          currently has one of the two position
                          indicators active. Only one of the two can ever
                          be true for the same station at once (a
                          detective's turn and Mr.X's turn never overlap),
                          so there's no conflict animating the same
                          element for both cases. Handled here rather
                          than inside HighlightRing since it animates a
                          DIFFERENT element (the station's own fill, not
                          a separate ring). */}
                      {highlightPositionStyle === "blink" && (isCurrentTurnStation || isMrXOwnTurnIndicator) && (
                        <animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />
                      )}
                    </circle>
                    {(() => {
                      const modes = [...map.stationModes[id]];
                      const dotR = nodeR + 0.55;
                      // Explicit per-count layout, per design spec, rather
                      // than evenly distributing dots around a full circle
                      // (the previous approach): labels now default to
                      // sitting directly above the node (north), so mode
                      // dots need to consistently stay OUT of that space
                      // -- never placed at the top -- while still reading
                      // clearly as a small cluster rather than a random
                      // scatter.
                      //   1 mode  -> straight down (bottom)
                      //   2 modes -> left and right (sideways)
                      //   3 modes -> bottom, plus left and right
                      //   4 modes -> bottom, plus three more spread across
                      //              the lower-left/left/right/lower-right
                      //              arc (still nothing at the top)
                      const DOWN = Math.PI / 2;
                      const LEFT = Math.PI;
                      const RIGHT = 0;
                      let angles;
                      if (modes.length <= 1) {
                        angles = [DOWN];
                      } else if (modes.length === 2) {
                        angles = [LEFT, RIGHT];
                      } else if (modes.length === 3) {
                        angles = [DOWN, LEFT, RIGHT];
                      } else {
                        // 4 (or more, defensively): bottom, plus the rest
                        // spread evenly across the lower semicircle
                        // (excluding straight-up), so they fan out below
                        // the node rather than stacking awkwardly.
                        const extra = modes.length - 1;
                        const spread = Math.PI * 0.8; // just short of the full lower semicircle, keeps them off the horizontal extremes too
                        angles = [DOWN, ...Array.from({ length: extra }, (_, k) => {
                          const t = extra === 1 ? 0.5 : k / (extra - 1);
                          return DOWN - spread / 2 + t * spread;
                        })];
                      }
                      return modes.map((m, mi) => {
                        const angle = angles[mi] ?? DOWN;
                        const dx2 = Math.cos(angle) * dotR;
                        const dy2 = Math.sin(angle) * dotR;
                        return <circle key={m} cx={x + dx2} cy={y + dy2} r={0.42} fill={activeMode[m].color} stroke="#fff" strokeWidth={0.12} />;
                      });
                    })()}
                    <text
                      x={x}
                      y={y + 0.55 * sizeScale}
                      fontSize={1.35 * sizeScale}
                      textAnchor="middle"
                      fill={detHere || mrXHere || isCurrentReveal ? "#ffffff" : map.id === "bengaluru" ? "#3c4043" : "#5c5648"}
                      fontWeight="700"
                    >
                      {id}
                    </text>
                    {map.names &&
                      labelDir &&
                      (() => {
                        const isTiny = map.tinyLabelStations && map.tinyLabelStations.has(numId);
                        const dvec = DIR_VECS[labelDir];
                        const dist = (isMajor ? 3.0 : isTiny ? 1.8 : 2.3) * sizeScale;
                        const lx = x + dvec[0] * dist;
                        const ly = y + dvec[1] * dist + (dvec[1] === 0 ? 0.5 * sizeScale : 0);
                        return (
                          <text
                            x={lx}
                            y={ly}
                            fontSize={(isMajor ? 1.6 : isTiny ? 0.75 : 1.1) * sizeScale}
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

              {/* Animated detective tokens: for any detective currently
                  mid-transition (see useMoveAnimation), draw an
                  interpolated token traveling from their old station to
                  their new one, on top of everything else. The detective's
                  STATIC dot (drawn in the loop above, at their final
                  match.detectives[i].pos) is still there underneath for
                  the whole duration -- that's fine, since the animated
                  token fully covers it while in flight, and once the
                  animation ends (this block stops rendering for that
                  detective), the static dot is already exactly where it
                  should be with no visible jump. */}
              {match.detectives.map((d) => {
                const anim = getProgress(d.id);
                if (!anim) return null;
                const [fx, fy] = map.stations[anim.fromPos];
                const [tx, ty] = map.stations[anim.toPos];
                const ix = fx + (tx - fx) * anim.progress;
                const iy = fy + (ty - fy) * anim.progress;
                return (
                  <circle
                    key={`anim-${d.id}`}
                    cx={ix}
                    cy={iy}
                    r={1.6}
                    fill={d.color}
                    stroke="#fff"
                    strokeWidth={0.35}
                    filter="url(#softShadow)"
                  />
                );
              })}

              {/* Collision effect: once a capture ending is detected (see
                  isCaptureEnding / collisionStationId above), draw a
                  richer catch animation at the shared station for the
                  short deliberate pause App.jsx holds before switching to
                  EndedScreen (see useDelayedEndedTransition) -- so players
                  actually SEE and FEEL the moment of capture. Three
                  layered pieces: (1) an expanding shockwave ring using
                  the CAPTURING DETECTIVE'S OWN COLOR when known, so a
                  detective-made capture reads as "that detective got him"
                  rather than a generic system event; Mr.X walking into a
                  detective himself keeps the muted red, since there's no
                  single detective to credit for that kind of ending. (2)
                  radiating burst lines, same as before. (3) NEW: Mr.X's
                  own station marker briefly "shatters" into small
                  fragments flying outward -- a concrete, game-specific
                  "gotcha" moment rather than an abstract starburst. */}
              {isCaptureEnding && collisionStationId != null && map.stations[collisionStationId] && (
                <g>
                  {(() => {
                    const [cx, cy] = map.stations[collisionStationId];
                    return (
                      <>
                        {/* Shockwave: a single fast expanding ring, distinct
                            timing from the slower pulsing ring below, to
                            read as an initial "impact" moment. */}
                        <circle cx={cx} cy={cy} r={1.6} fill="none" stroke={collisionColor} strokeWidth={0.5} opacity={0.9}>
                          <animate attributeName="r" values="1.6;7" dur="0.6s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.9;0" dur="0.6s" repeatCount="indefinite" />
                        </circle>
                        {/* Pulsing ring, slower/looping, gives the effect
                            some duration rather than a single flash. */}
                        <circle cx={cx} cy={cy} r={2} fill="none" stroke={collisionColor} strokeWidth={0.6} opacity={0.9}>
                          <animate attributeName="r" values="1.5;5;1.5" dur="0.9s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.9;0;0.9" dur="0.9s" repeatCount="indefinite" />
                        </circle>
                        {[...Array(6)].map((_, i) => {
                          const angle = (i / 6) * 2 * Math.PI;
                          return (
                            <line
                              key={i}
                              x1={cx}
                              y1={cy}
                              x2={cx + Math.cos(angle) * 3.5}
                              y2={cy + Math.sin(angle) * 3.5}
                              stroke={collisionColor}
                              strokeWidth={0.35}
                              opacity={0.8}
                            >
                              <animate attributeName="opacity" values="0.8;0;0.8" dur="0.9s" repeatCount="indefinite" />
                            </line>
                          );
                        })}
                        {/* Shatter fragments: small dark chips (echoing
                            Mr.X's own token color) flying outward and
                            fading, like his marker breaking apart at the
                            moment he's caught. Offset timing (starts
                            slightly after the shockwave) so the sequence
                            reads as impact -> shatter, not everything at
                            once. */}
                        {[...Array(8)].map((_, i) => {
                          const angle = (i / 8) * 2 * Math.PI + 0.3;
                          const dist = 4.2;
                          return (
                            <circle
                              key={`shard-${i}`}
                              cx={cx}
                              cy={cy}
                              r={0.35}
                              fill="#1a1a1a"
                              opacity={0}
                            >
                              <animate
                                attributeName="cx"
                                values={`${cx};${cx + Math.cos(angle) * dist}`}
                                dur="0.9s"
                                begin="0.15s"
                                repeatCount="indefinite"
                              />
                              <animate
                                attributeName="cy"
                                values={`${cy};${cy + Math.sin(angle) * dist}`}
                                dur="0.9s"
                                begin="0.15s"
                                repeatCount="indefinite"
                              />
                              <animate
                                attributeName="opacity"
                                values="0.9;0"
                                dur="0.9s"
                                begin="0.15s"
                                repeatCount="indefinite"
                              />
                            </circle>
                          );
                        })}
                      </>
                    );
                  })()}
                </g>
              )}
            </svg>
            {isMyTurnToAct && pendingMove && (() => {
              const [sx, sy] = map.stations[pendingMove.to];
              const screenPos = svgPointToScreenPoint(sx, sy);
              if (isMrXTurn) {
                const options = [];
                if (pendingMove.edgeMode === "ferry") {
                  options.push({
                    key: "ferry",
                    label: `${activeMode.ferry.label} (black ticket)`,
                    accent: activeMode.ferry.color,
                    onClick: () => commitMrXMove("black"),
                  });
                } else {
                  if (match.mrX.tickets[pendingMove.edgeMode] > 0) {
                    options.push({
                      key: "mode",
                      label: `${activeMode[pendingMove.edgeMode].label} ticket`,
                      onClick: () => commitMrXMove(pendingMove.edgeMode),
                    });
                  }
                  if (match.mrX.tickets.black > 0) {
                    options.push({ key: "black", label: "Black ticket (camouflage)", accent: "#2b2b2b", onClick: () => commitMrXMove("black") });
                  }
                }
                return (
                  <MovePopup
                    x={screenPos.x}
                    y={screenPos.y}
                    fallback={screenPos.fallback}
                    openDirection={screenPos.openDirection}
                    title={`Move to ${stationLabel(pendingMove.to)} via:`}
                    options={options}
                    onClose={() => setPendingMove(null)}
                  />
                );
              }

              if (activeDetective) {
                return (
                  <MovePopup
                    x={screenPos.x}
                    y={screenPos.y}
                    fallback={screenPos.fallback}
                    openDirection={screenPos.openDirection}
                    title={`Move to ${stationLabel(pendingMove.to)} using ${activeMode[pendingMove.mode].label}?`}
                    options={[
                      {
                        key: "confirm",
                        label: "Confirm move",
                        onClick: () => commitDetectiveMove(activeDetective.id, pendingMove.to, pendingMove.mode),
                      },
                    ]}
                    onClose={() => setPendingMove(null)}
                  />
                );
              }
              return null;
            })()}
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
    gap: 0,
  },
  sidebarPermanent: {
    // Reduced from 420 to 360 to hand more width back to the map itself
    // -- checked that the content that actually lives here (ticket
    // chips, the 26-cell travel log grid, chat) all use flexible
    // layouts (flex-wrap / CSS grid auto-fill) rather than fixed pixel
    // widths, so they reflow cleanly at this narrower width instead of
    // clipping or forcing horizontal scroll.
    width: 360,
    flexShrink: 0,
    height: "100%",
    background: "#f7f6f3",
    overflowY: "auto",
    padding: "14px 20px 24px",
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
    padding: "12px",
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
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, textAlign: "left" },
  backBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    color: "#555",
    cursor: "pointer",
    flexShrink: 0,
  },
  label: { display: "block", fontSize: 13, color: "#555", marginBottom: 8, fontWeight: 600 },
  featureOverrideSelect: { padding: "8px 10px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14, flex: 1, minWidth: 0 },
  timerStepBtn: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: 8,
    border: "1.5px solid #ddd",
    background: "#fff",
    fontSize: 16,
    fontWeight: 700,
    color: "#333",
    cursor: "pointer",
    lineHeight: 1,
  },
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
  turnLabel: { fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 },
  turnTimerBarWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    width: "100%",
    maxWidth: 220,
  },
  turnTimerBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 5,
    background: "#e5e2d8",
    overflow: "hidden",
  },
  turnTimerBarFill: {
    height: "100%",
    borderRadius: 5,
    transition: "width 1s linear, background-color 1s linear",
  },
  turnTimerBarText: {
    fontSize: 12,
    fontWeight: 700,
    color: "#666",
    minWidth: 28,
    textAlign: "right",
  },
  roomCodeLabel: { fontSize: 11, color: "#aaa", marginTop: 2, letterSpacing: 0.5 },
  legendCompact: { display: "flex", flexWrap: "nowrap", gap: 5, marginTop: 6, overflow: "hidden" },
  legendCompactItem: { display: "flex", alignItems: "center", gap: 2, fontSize: 9.5, color: "#888", whiteSpace: "nowrap" },
  turnColorDot: { width: 12, height: 12, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  ticketsPanel: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" },
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
  allTicketsPanel: {
    width: "100%",
    maxWidth: 760,
    background: "#fff",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
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
  doubleBtnCompact: {
    border: "1.5px solid #6b4fa0",
    color: "#6b4fa0",
    background: "#f4effa",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12.5,
    fontWeight: 600,
  },
  passTurnNote: {
    fontSize: 12.5,
    color: "#a33",
    textAlign: "center",
    marginBottom: 8,
    maxWidth: 320,
  },
  ruleNote: {
    width: "100%",
    maxWidth: 760,
    marginTop: 8,
    fontSize: 12,
    color: "#8a5a3a",
    textAlign: "center",
  },
  exploreRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 8,
    fontSize: 12,
  },
  exploreLabel: { color: "#777" },
  exploreBtn: {
    border: "1.5px solid #ddd",
    background: "#fff",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    color: "#444",
  },
  exploreBtnActive: { background: "#f4f2ec", fontWeight: 700 },
  exploreClearBtn: {
    border: "none",
    background: "none",
    color: "#999",
    fontSize: 11.5,
    textDecoration: "underline",
    cursor: "pointer",
  },
  exploreDetectivePicker: {
    border: "1.5px solid #ddd",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 12,
    marginRight: 4,
  },
  huddleAmbientNote: {
    textAlign: "center",
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
    marginTop: 8,
  },
  huddlePanel: {
    marginTop: 10,
    padding: "8px 10px",
    background: "#f7f6f3",
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  huddleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "1.5px solid transparent",
    background: "#fff",
    borderRadius: 8,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
  huddleRowActive: { borderColor: "#111", fontWeight: 700 },
  huddleDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
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
