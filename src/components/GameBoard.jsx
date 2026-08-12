import React, { useState, useMemo, useEffect } from "react";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";
import { useHighlightStyles } from "../lib/useHighlightStyles.js";
import HighlightRing from "./HighlightRing.jsx";
import MovePopup from "./MovePopup.jsx";
import { useMoveAnimation } from "../lib/useMoveAnimation.js";
import { useFeatureEnabled } from "../lib/useFeatureEnabled.js";
import { MODE_DEFAULT, modeChipLetter } from "../maps/mapSchema.js";
import {
  currentActor,
  validMovesFor,
  occupiedByDetective,
  formatLogEntry,
} from "../lib/gameEngine.js";
import { curvePathD, autoParallelOffset } from "../lib/curveGeometry.js";
import DecorationsLayer from "./DecorationsLayer.jsx";

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

// EDGE_MARGIN: a MINIMAL buffer so a station sitting right at the
// nominal edge, and its label, still render fully on-canvas -- kept as
// small as the actual data requires, not a generous guess. Checked
// every station's worst-case top clearance need if labeled "N": Airport
// was a genuine outlier needing ~5.6 units (now resolved by giving
// Airport's label a different direction instead -- see its
// majorLabelDir entry -- since inflating the margin for one outlier
// station wastes space on every other station's view), and every other
// station needs at most ~0.2 units. TOP stays slightly larger than the
// sides/bottom only because that's where the real (now-resolved)
// problem was; sides/bottom get virtually nothing since checked
// overflow there was zero.
//
// This top margin is a BENGALURU-SPECIFIC fix (Airport's negative
// y-coordinate is unique to that map's data) -- applying it globally to
// every map wastes space on maps that don't have this problem. City of
// Sendhwa's coordinates were shifted into a clean 0-based viewBox from
// the start (verified: no station sits near the edge), so it doesn't
// need this margin at all. EDGE_MARGIN_TOP_BY_MAP looks up the correct
// value per map id, falling back to the original 6 for any map not
// explicitly listed (safe default, matches the original global
// behavior for Bengaluru/Westeros).
const EDGE_MARGIN_TOP_BY_MAP = { "city-of-sendhwa": 0.5 };
const EDGE_MARGIN_TOP_DEFAULT = 6;
const EDGE_MARGIN_OTHER = 0.5;

// TICKET_DISPLAY_ORDER: explicit taxi -> bus -> underground -> black ->
// double ordering for every place ticket counts get rendered, rather than
// relying on the underlying object's own key order (which, while it
// happens to already match this today, is an implicit dependency on
// insertion order elsewhere in the codebase -- a future refactor to how
// ticket objects get built could silently reorder these with no error).
// Any mode not in this list (shouldn't happen for a valid map) sorts
// after everything named here, rather than being dropped.
const TICKET_DISPLAY_ORDER = ["taxi", "bus", "underground", "black", "double"];
function sortTicketEntries(ticketsObj) {
  return Object.entries(ticketsObj).sort(([a], [b]) => {
    const ai = TICKET_DISPLAY_ORDER.indexOf(a);
    const bi = TICKET_DISPLAY_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

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
  extraHeaderContent, // shares a row with the "Play 2x card" button (e.g. Pause/End Game in multiplayer, End Game in pass-and-play) -- kept small/short controls only, since it's meant to sit alongside the 2x button without wrapping badly
  extraHeaderContentBelow, // renders as its OWN row, below the 2x/Pause/End-Game row -- for bulkier controls that shouldn't crowd that first row (e.g. multiplayer's Takeover Reversal / Redistribute Roles votes, and the TakeoverPanel)
  belowTicketsContent, // e.g. chat in multiplayer -- renders AFTER the log/tickets panels, per the agreed sidebar order (votes -> huddle -> explorer -> log -> tickets -> chat)
  onExploreModeChange, // (detectiveIds: number[]) => void -- reports this client's own EXTRA toggled-on detective ids (beyond their own, which are always shown by default) upward, so App.jsx can broadcast them via Presence
  onPeekableChange, // (peekable: boolean) => void -- reports this client's own "let teammates peek at my screen" preference upward, for the same Presence broadcast
  onStrokesChange, // (strokes: Stroke[]) => void -- reports this client's own drawing strokes upward, broadcast via Presence, so a peeking teammate can see them live
  onRemoteDraw, // (targetPlayerId, action) => void -- fires a draw action AT a specific other player's board (used while peeking them), via a one-off Presence broadcast rather than persistent state
  onRegisterRemoteStrokeHandler, // (handler: (payload) => void) => void -- called once on mount so App.jsx can wire incoming remote-draw events (from a teammate peeking ME) into this component's own stroke state
  detectivePlayersRoster = [], // [{playerId, displayName, detectiveIds: number[]}] -- every detective-seat player (not Mr.X), multiplayer only, used for the "peek into a player's screen" panel and for showing a peeked player's OWN highlights (which aren't separately broadcast, since they're deterministic from this same roster)
  presenceState = {}, // playerId -> {displayName, role, toggledDetectiveIds, strokes} -- live Presence payloads (multiplayer only), used to read a peeked player's EXTRA toggles and strokes
  myPlayerId = null, // this client's own player id (multiplayer only) -- used to exclude yourself from the peek list
  detectivePlayerNames = {}, // detectiveId -> player display name (multiplayer only) -- for the ticket counter's "Priya — D1" labeling
  secondsRemaining = null, // null (no timer set for this room) | number of seconds left in the current turn/phase -- shown to EVERYONE regardless of whose turn it is
  turnTimerSeconds = null, // the room's configured timer length (the detective act window), for showing "12 / 60s" style displays
  timerPhase = null, // null | "mrx" | "buffer" | "detective" -- which segment of the turn schedule is currently counting down (see useTurnTimer.js)
  preThinkActive = false, // true during the shared detective pre-think buffer -- no one may COMMIT a move, though everyone may still preview reachable stations via the explore/huddle system
  mrxSecondsForBar = null, // Mr. X's full turn window (schedule.mrxSeconds) -- the denominator for the timer bar while timerPhase === "mrx"
  bufferSecondsForBar = null, // the shared pre-think buffer's full length (schedule.bufferSeconds) -- the denominator while timerPhase === "buffer"
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
  const EDGE_MARGIN_TOP = EDGE_MARGIN_TOP_BY_MAP[map?.id] ?? EDGE_MARGIN_TOP_DEFAULT;
  const [pan, setPan] = useState({ x: -EDGE_MARGIN_OTHER, y: -EDGE_MARGIN_TOP });
  const [pendingMove, setPendingMove] = useState(null);
  // toggledIds: the FULL set of detectives currently highlighted on this
  // client's board -- own AND others', all equally togglable by clicking
  // their token (see handleStationClick). Seeded with your own
  // detectives once they're known (see the seeding effect below) so
  // "shown by default" still holds without making own detectives a
  // special un-toggleable case -- a real complaint with the earlier
  // version, where clicking your own piece did nothing.
  const [toggledIds, setToggledIds] = useState(() => new Set());
  const seededOwnRef = React.useRef(false);
  const [mrxSelfExplore, setMrxSelfExplore] = useState(false); // Mr.X clicking his OWN token toggles his own reachable-station highlight -- no teammates to coordinate with, so this stays purely local, never broadcast
  const [peekedPlayerId, setPeekedPlayerId] = useState(null); // playerId whose ENTIRE screen (their own detectives + their own extra toggles) we're currently mirroring, via the side panel
  const [myPeekable, setMyPeekable] = useState(true); // whether I allow TEAMMATES to peek into my screen -- off by choice, broadcast via Presence, purely a privacy preference

  // Peeking is only OFFERED during the shared pre-think buffer (see the
  // panel's own gating below) -- but the buffer can end mid-peek (it's a
  // countdown, not something you dismiss), so this auto-releases any
  // active peek the instant it does. Necessary, not just tidy: peeking
  // blocks board clicks entirely, so a detective who forgot to un-peek
  // right as their own act window opened would otherwise be locked out
  // of making their own move.
  useEffect(() => {
    if (!preThinkActive && peekedPlayerId) setPeekedPlayerId(null);
  }, [preThinkActive, peekedPlayerId]);

  // ---------------------------------------------------------------------
  // FREEHAND DRAWING -- a quick, disposable "let me show you my
  // reasoning" sketch layer, like circling a region on a real paper board
  // while thinking. NEVER shown to Mr.X (detectives-only, same boundary
  // as the route explorer). Strokes are in MAP-SPACE coordinates (SVG
  // viewBox units, via screenPointToSvgPoint), so a stroke lands in the
  // same place for a peeking teammate regardless of either client's own
  // zoom/pan. Auto-clears the instant the shared buffer ends (see the
  // useEffect below) -- a real player's board goes back to normal the
  // moment everyone breaks from huddling and looks at their own screen,
  // not just at the NEXT round's buffer. Broadcast via the SAME Presence
  // payload as the route-explorer toggles, on stroke COMPLETION only
  // (not live per-point), to keep Presence traffic reasonable.
  // ---------------------------------------------------------------------
  const [drawMode, setDrawMode] = useState(null); // null | "pen" | "eraser"
  const [myStrokes, setMyStrokes] = useState([]); // [{id, points: [{x,y}, ...]}]
  const [liveStrokePoints, setLiveStrokePoints] = useState(null); // points of the stroke currently being drawn (not yet committed to myStrokes)
  const [lastRoundStrokes, setLastRoundStrokes] = useState([]); // whatever myStrokes held right before the most recent auto-clear -- default behavior stays "blank," this is purely an opt-in recall
  const wasPreThinkActiveRef = React.useRef(false); // lets the clear effect detect the true -> false EDGE (buffer just ended), not just "buffer is currently off"
  const myStrokesRef = React.useRef(myStrokes); // lets the clear effect read the CURRENT strokes without depending on them (avoiding a clear-triggers-effect loop)
  myStrokesRef.current = myStrokes;

  // Auto-clear MY OWN strokes the moment the shared pre-think buffer
  // ends -- default is blank, per the real-board precedent (nobody keeps
  // scribbles visible once everyone's back to their own screen), but the
  // just-cleared strokes are stashed so the explicit "Recall last round"
  // button (see toolbar below) can bring them back if you actually
  // wanted to keep looking at them. Also clears on a plain round change
  // (belt-and-suspenders for rooms with no configured planning time,
  // where preThinkActive never turns on at all).
  useEffect(() => {
    const bufferJustEnded = wasPreThinkActiveRef.current && !preThinkActive;
    wasPreThinkActiveRef.current = preThinkActive;
    if (!bufferJustEnded) return;
    if (myStrokesRef.current.length > 0) setLastRoundStrokes(myStrokesRef.current);
    setMyStrokes([]);
    setLiveStrokePoints(null);
  }, [preThinkActive]);

  const lastClearedRoundRef = React.useRef(null);
  useEffect(() => {
    if (match?.round == null) return;
    if (lastClearedRoundRef.current === match.round) return;
    lastClearedRoundRef.current = match.round;
    if (preThinkActive) return; // this round's own buffer will handle the clear when IT ends -- don't clear twice
    if (myStrokesRef.current.length > 0) setLastRoundStrokes(myStrokesRef.current);
    setMyStrokes([]);
    setLiveStrokePoints(null);
  }, [match?.round]);

  function recallLastRoundStrokes() {
    if (lastRoundStrokes.length === 0) return;
    setMyStrokes(lastRoundStrokes);
  }

  function pointFromEvent(e) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return screenPointToSvgPoint(clientX, clientY);
  }

  // While peeking, drawing actions are redirected to the PEEKED player's
  // board instead of your own -- "reaching over and drawing on their
  // sheet while looking at it" (explicit design decision), rather than
  // silently accumulating on a board of yours that isn't even visible
  // right now. Local strokes and remote-targeted strokes never mix.
  function applyStrokeAction(action) {
    if (peekedPlayerId) {
      onRemoteDraw && onRemoteDraw(peekedPlayerId, action);
      return;
    }
    if (action.kind === "add") {
      setMyStrokes((prev) => [...prev, action.stroke]);
    } else if (action.kind === "undo") {
      setMyStrokes((prev) => prev.slice(0, -1));
    } else if (action.kind === "erase") {
      setMyStrokes((prev) => prev.filter((s) => !s.points.some((pt) => Math.hypot(pt.x - action.point.x, pt.y - action.point.y) < ERASE_RADIUS)));
    }
  }

  // Apply a stroke action that arrived FOR ME (someone peeking my screen
  // drew on it) -- lands in the exact same myStrokes state my own
  // drawing would, so it re-broadcasts to anyone ELSE peeking me too,
  // and clears at the next round exactly like my own strokes would.
  function handleIncomingRemoteStroke(payload) {
    if (payload.kind === "add") {
      setMyStrokes((prev) => [...prev, payload.stroke]);
    } else if (payload.kind === "undo") {
      setMyStrokes((prev) => prev.slice(0, -1));
    } else if (payload.kind === "erase") {
      setMyStrokes((prev) => prev.filter((s) => !s.points.some((pt) => Math.hypot(pt.x - payload.point.x, pt.y - payload.point.y) < ERASE_RADIUS)));
    }
  }
  // Expose this to App.jsx so it can wire it into usePresence's
  // onRemoteStroke callback -- App.jsx owns the Presence hook, GameBoard
  // owns the actual strokes state, so this ref is how the incoming event
  // reaches the right place without threading a second prop each render.
  const handleIncomingRemoteStrokeRef = React.useRef(handleIncomingRemoteStroke);
  handleIncomingRemoteStrokeRef.current = handleIncomingRemoteStroke;
  useEffect(() => {
    onRegisterRemoteStrokeHandler && onRegisterRemoteStrokeHandler((payload) => handleIncomingRemoteStrokeRef.current(payload));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ERASE_RADIUS = 2.5; // map-space units, shared by local + remote erase

  function handleDrawPointerDown(e) {
    if (!drawMode) return;
    const p = pointFromEvent(e);
    if (!p) return;
    if (drawMode === "pen") {
      setLiveStrokePoints([p]);
    } else if (drawMode === "eraser") {
      applyStrokeAction({ kind: "erase", point: p });
    }
  }

  function handleDrawPointerMove(e) {
    if (!drawMode) return;
    const p = pointFromEvent(e);
    if (!p) return;
    if (drawMode === "pen" && liveStrokePoints) {
      setLiveStrokePoints((prev) => [...prev, p]);
    } else if (drawMode === "eraser" && e.buttons === 1) {
      applyStrokeAction({ kind: "erase", point: p });
    }
  }

  function handleDrawPointerUp() {
    if (drawMode === "pen" && liveStrokePoints && liveStrokePoints.length > 1) {
      applyStrokeAction({ kind: "add", stroke: { id: `${Date.now()}-${Math.random()}`, points: liveStrokePoints } });
    }
    setLiveStrokePoints(null);
  }

  function undoLastStroke() {
    applyStrokeAction({ kind: "undo" });
  }

  function pointsToPath(points) {
    if (!points || points.length === 0) return "";
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} ` + points.slice(1).map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  }

  // Report our own strokes upward the same way as the explore toggles --
  // only on stroke COMPLETION (myStrokes changes), never on every
  // in-progress point, to keep Presence broadcast traffic reasonable.
  useEffect(() => {
    onStrokesChange && onStrokesChange(myStrokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myStrokes]);

  function toggleDetectiveHighlight(detId) {
    setToggledIds((prev) => {
      const next = new Set(prev);
      if (next.has(detId)) next.delete(detId);
      else next.add(detId);
      return next;
    });
  }

  // Report our FULL toggled set upward so App.jsx can broadcast it via
  // Presence -- other players' "peek" views mirror this exactly, and it
  // correctly reflects the moment we untoggle anything (including our own
  // detectives now), so nothing lingers stale for others.
  useEffect(() => {
    onExploreModeChange && onExploreModeChange(Array.from(toggledIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggledIds]);

  // Report our own peek-privacy preference upward the same way -- default
  // ON (matches the old always-visible behavior), but a player can turn
  // it off at any time, which immediately removes them from every
  // teammate's peek list, live.
  useEffect(() => {
    onPeekableChange && onPeekableChange(myPeekable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPeekable]);
  const routeExplorerEnabled = useFeatureEnabled("route_explorer_enabled", roomId);
  const [message, setMessage] = useState("");
  const dragState = React.useRef(null);
  const svgRef = React.useRef(null);
  const boardColumnRef = React.useRef(null);
  // Tracks the board column's own real pixel size via ResizeObserver, so
  // the board wrapper's width/height can be computed with EXACT
  // arithmetic in JS -- after multiple CSS-only attempts (manual vh
  // calc(), aspect-ratio + max-height, min()-based calc()) all failed to
  // reliably preserve the map's true aspect ratio across different
  // screen shapes (verified by direct measurement each time: several
  // "fixes" left the map visibly stretched on wide/ultrawide screens,
  // confirmed via automated ratio checks, not just eyeballing), this is
  // the one approach that's actually reliable: measure the real
  // available box, then compute the largest width/height pair that (a)
  // fits within that box on both axes and (b) preserves baseW:baseH
  // exactly, with no CSS derivation ambiguity involved at all.
  const [columnSize, setColumnSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = boardColumnRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setColumnSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The new top-of-map bar (round/turn banner + timer) sits ABOVE the
  // map inside the same boardColumnFull element that columnSize measures
  // as a whole -- so its own rendered height needs to be subtracted from
  // columnSize.height before that feeds into the map's fit-to-box math
  // below, or the map would be sized as if it had the FULL column height
  // available and overflow past the bottom by exactly the bar's height.
  const topBarRef = React.useRef(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  useEffect(() => {
    const el = topBarRef.current;
    if (!el) {
      setTopBarHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => {
      // getBoundingClientRect (not entry.contentRect) so this includes
      // the element's own padding/border -- and marginBottom is added
      // explicitly on top, since margin is never included in ANY
      // element measurement API (getBoundingClientRect or
      // ResizeObserver's contentRect/borderBoxSize) -- it's genuinely
      // outside the element's own box in the DOM model. Confirmed this
      // was a real, reproducible bug: using contentRect.height alone
      // undercounted by exactly the bar's 8px marginBottom on every
      // viewport size tested, which let the map wrapper claim 8px more
      // height than was actually available and overflow past the
      // bottom of the viewport by that same fixed 8px on every screen.
      const rect = el.getBoundingClientRect();
      const marginBottom = parseFloat(getComputedStyle(el).marginBottom) || 0;
      setTopBarHeight(rect.height + marginBottom);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // Inverse of svgPointToScreenPoint above -- converts a pointer event's
  // SCREEN coordinates into the SVG's own viewBox coordinate space, so a
  // freehand stroke lands at the same MAP position for a peeking teammate
  // regardless of either client's own zoom/pan state.
  function screenPointToSvgPoint(clientX, clientY) {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: pan.x + ((clientX - rect.left) / rect.width) * viewSizeW,
      y: pan.y + ((clientY - rect.top) / rect.height) * viewSizeH,
    };
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

  // Seed toggledIds with your own detectives ONCE they're known -- gives
  // the "shown by default" behavior without making own detectives a
  // special non-togglable case; after this one seed, it's entirely
  // player-controlled (including deselecting your own).
  // MOVED HERE, below myOwnDetectives' own declaration -- it used to sit
  // much earlier in the component (right after toggledIds' own useState),
  // but its dependency array read `myOwnDetectives.length`, which was a
  // genuine temporal-dead-zone bug: a dependency array is evaluated
  // eagerly, during render, at the exact line the useEffect call sits on
  // -- not deferred to when the effect callback actually runs -- so
  // referencing a `const` declared further down the SAME function scope
  // threw "Cannot access 'myOwnDetectives' before initialization" on
  // every single render, crashing the whole board. Confirmed via a live
  // repro before fixing.
  useEffect(() => {
    if (seededOwnRef.current) return;
    if (myRole === null && match.detectives.length > 0) {
      setToggledIds(new Set(match.detectives.map((d) => d.id)));
      seededOwnRef.current = true;
    } else if (myOwnDetectives.length > 0) {
      setToggledIds(new Set(myOwnDetectives.map((d) => d.id)));
      seededOwnRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOwnDetectives.length, match.detectives.length, myRole]);

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

  // ---------------------------------------------------------------------
  // ROUTE EXPLORER v2 -- redesigned around "click a piece on the map to
  // turn its highlight on/off," rather than a separate mode-picker
  // control. Reachable stations are now computed across EVERY mode that
  // piece actually holds a ticket for, all at once (not one mode at a
  // time) -- a station is only ever highlighted if it's genuinely
  // reachable given tickets currently held, per explicit design
  // decision, since showing an unreachable metro-only station to a
  // detective with zero metro tickets was actively misleading.
  // ---------------------------------------------------------------------
  function computeReachableAllModes(fromPos, tickets) {
    // Direct, one-hop destinations only (not unlimited-hop walks -- see
    // the original taxi-mesh bug this avoided), unioned across every
    // mode the piece holds at least one ticket for right now.
    if (fromPos == null || !tickets) return new Set();
    const reachable = new Set();
    for (const edge of map.graph[fromPos] || []) {
      if ((tickets[edge.mode] || 0) > 0) reachable.add(edge.to);
    }
    return reachable;
  }

  // showDetectiveHighlights: whether explore highlights are appropriate
  // for THIS client to see at all. Pass-and-play (myRole === null, one
  // shared device) only while it ISN'T Mr.X's own private turn, to avoid
  // handing Mr.X free intel about detective destinations on the same
  // device.
  const showDetectiveHighlights = iAmDetective || isSpectator || (myRole === null && !isMrXTurn);

  // If the peeked player turns their privacy toggle off WHILE being
  // peeked, this immediately stops surfacing their data (presenceState
  // updates live) -- no separate "kick out the peeker" step needed.
  const peekedPlayerIsPeekable = presenceState[peekedPlayerId]?.peekable !== false;

  // strokesToRender: whichever board is actually "in view" right now --
  // your own strokes normally, or the peeked player's live strokes while
  // peeking (never both, since you're looking at one board at a time).
  const strokesToRender = peekedPlayerId ? (peekedPlayerIsPeekable ? presenceState[peekedPlayerId]?.strokes || [] : []) : myStrokes;

  // The set of detectives currently highlighted on THIS client's board:
  // your own full toggled set normally, or -- while peeking -- EXACTLY
  // the peeked player's toggled set, REPLACING yours rather than merging
  // with it. This is "look at their screen," not "look at both at once"
  // -- merging was the source of the reported visual clutter (your own
  // highlights stacking on top of theirs with no way to tell them apart).
  const highlightedDetectiveIds = !showDetectiveHighlights
    ? new Set()
    : peekedPlayerId
      ? new Set(peekedPlayerIsPeekable ? presenceState[peekedPlayerId]?.toggledDetectiveIds || [] : [])
      : toggledIds;

  // reachableByDetectiveId: stationId -> [{detId, color}] for every
  // currently-highlighted detective that can reach it -- built once so
  // rendering can just look up a station and stack whichever detectives'
  // rings apply, rather than recomputing per-station during render.
  const reachableByDetectiveId = useMemo(() => {
    const map_ = new Map();
    for (const detId of highlightedDetectiveIds) {
      const det = match.detectives.find((d) => d.id === detId);
      if (!det) continue;
      const reachable = computeReachableAllModes(det.pos, det.tickets);
      for (const stationId of reachable) {
        if (!map_.has(stationId)) map_.set(stationId, []);
        map_.get(stationId).push({ detId, color: det.color });
      }
    }
    return map_;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(highlightedDetectiveIds).sort().join(","), match.detectives, map]);

  // Mr.X's own self-explore -- unchanged in spirit, but now shows ALL
  // modes he holds tickets for at once too, toggled by clicking his own
  // token rather than a separate mode-picker row.
  const mrxReachable = useMemo(() => {
    if (!mrxSelfExplore || !isMrXTurn) return new Set();
    return computeReachableAllModes(match.mrX.pos, match.mrX.tickets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrxSelfExplore, isMrXTurn, match.mrX.pos, match.mrX.tickets, map]);

  // Whether MY OWN position dot should render right now. Pass-and-play:
  // only during Mr. X's own turn (shared-device secrecy). Multiplayer:
  // Mr. X always sees themselves regardless of turn, since match.mrX.pos
  // is only ever populated for the Mr. X client to begin with (see
  // matchStateAdapter.js) -- a detective client's match.mrX.pos is
  // already null, so there's nothing to accidentally reveal either way.
  const showMrXPos = myRole === null ? isMrXTurn : iAmMrX;

  function handleStationClick(station) {
    // While peeking a teammate's screen, the board is READ-ONLY -- you're
    // looking at THEIR board, not yours, so a click here has no
    // unambiguous meaning (whose piece would it move? whose highlight
    // would it toggle?). Drawing is the one exception (see the pen/eraser
    // handlers, which route around this function entirely via the SVG's
    // own pointer handlers, gated separately on drawMode).
    if (peekedPlayerId) return;
    // --- Route explorer v2: clicking a station where a PIECE currently
    // stands toggles that piece's highlight, independent of whose turn
    // it is -- available any time, exactly like the old explorer. This
    // takes priority over move-commit logic below, since a station
    // occupied by a detective can never legally be another detective's
    // move destination anyway (no real conflict there). The one genuine
    // ambiguity -- Mr.X CAN legally move onto a detective's station to
    // capture them -- is excluded explicitly so an in-progress capture
    // click is never swallowed by this.
    const detOnStation = match.detectives.find((d) => d.pos === station);
    const mrxCaptureClickInProgress = isMrXTurn && isMyTurnToAct && !preThinkActive && (myRole === null || myRole === "mrx");
    if (detOnStation && !mrxCaptureClickInProgress) {
      if (!showDetectiveHighlights) return; // not a detective-perspective viewer (e.g. Mr.X's own client)
      const isOwn = myRole === null || myOwnDetectives.some((d) => d.id === detOnStation.id);
      // Your OWN detectives are always yours to show/hide, no admin gate
      // needed -- it's your own information. Toggling a TEAMMATE's
      // detective is the part the admin's explore toggle controls.
      if (!isOwn && !routeExplorerEnabled) return;
      toggleDetectiveHighlight(detOnStation.id);
      return;
    }
    if (showMrXPos && station === match.mrX.pos) {
      // Mr.X clicking his own token toggles his own self-explore.
      setMrxSelfExplore((prev) => !prev);
      return;
    }
    if (!isMyTurnToAct) return;
    // Pre-think buffer: nobody may COMMIT a move yet, even the seat whose
    // turn it technically now is -- the whole point of the buffer is a
    // shared deliberation window before the act window starts. The
    // route explorer above is untouched by this check.
    if (preThinkActive) return;
    if (isMrXTurn) {
      if (myRole !== null && myRole !== "mrx") return; // multiplayer: not your role
      // FIX: was .find(), which only returns the FIRST matching edge --
      // silently ignoring any other mode also connecting to this same
      // station (e.g. a station reachable by both taxi AND bus). That
      // caused two real bugs: (1) the mode-selection popup only ever
      // offered ONE mode, even when several were genuinely available,
      // and (2) the ticket-availability check below only tested that
      // one mode, so a player with plenty of tickets for a DIFFERENT
      // available mode to the same station would incorrectly be told
      // they had no valid ticket. .filter() collects every parallel
      // edge to this station instead of just the first one found.
      const edges = (map.graph[match.mrX.pos] || []).filter((m) => m.to === station);
      if (edges.length === 0) {
        setMessage("No direct connection there.");
        return;
      }
      // Only offer modes Mr.X can actually pay for right now (own
      // ticket for that mode, OR a black ticket as camouflage/ferry
      // fare) -- mirrors the original single-edge check, just applied
      // across every available mode instead of only the first.
      const usableModes = edges.filter(
        (e) => (e.mode === "ferry" ? match.mrX.tickets.black > 0 : match.mrX.tickets[e.mode] > 0 || match.mrX.tickets.black > 0)
      );
      if (usableModes.length === 0) {
        const hasFerry = edges.some((e) => e.mode === "ferry");
        setMessage(
          hasFerry
            ? `No black tickets left — ${activeMode.ferry.label.toLowerCase()} crossings require one.`
            : "No tickets left for any available route there."
        );
        return;
      }
      setPendingMove({ to: station, availableModes: usableModes.map((e) => e.mode) });
      if (occupiedByDetective(match.detectives, station)) {
        setMessage(`${stationLabel(station)} has a detective on it. Moving there is legal but ends the game — ${mrxName()} would be caught.`);
      } else if (usableModes.length === 1 && usableModes[0].mode === "ferry") {
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
      // Same .find() -> .filter() fix as Mr.X's branch above, for the
      // same reason: a detective could have a valid ticket for a second
      // available mode to this station even when they're out of the
      // first-found mode's tickets.
      const edges = (map.graph[d.pos] || []).filter((m) => m.to === station);
      if (edges.length === 0) {
        setMessage("No direct connection there.");
        return;
      }
      const usableModes = edges.filter((e) => d.tickets[e.mode] > 0);
      if (usableModes.length === 0) {
        setMessage(`No ${edges.map((e) => activeMode[e.mode].label).join("/")} tickets left.`);
        return;
      }
      setPendingMove({ to: station, availableModes: usableModes.map((e) => e.mode) });
      setMessage(
        usableModes.length === 1
          ? `Selected ${stationLabel(station)} via ${activeMode[usableModes[0].mode].label}. Confirm to move.`
          : `Selected ${stationLabel(station)}. Choose which ticket to spend.`
      );
    }
  }

  function commitDetectiveMove(detId, to, mode) {
    setPendingMove(null);
    setMessage("");
    onDetectiveMove(detId, to, mode);
  }

  function commitMrXMove(edgeMode, ticketUsed) {
    if (!pendingMove) return;
    const { to } = pendingMove;
    setPendingMove(null);
    setMessage("");
    onMrXMove(to, edgeMode, ticketUsed);
  }

  const isWesteros = map.id === "westeros";

  return (
    <div style={styles.pagePlaying}>
      <div style={styles.playingLayoutSidebar}>
        <div style={styles.sidebarPermanent}>
          <div style={styles.headerBarSlim}>
            {/* Round, turn label, timer, and this-player's ticket chips
                all moved to the new top-of-map bar (round+turn+timer) and
                "Everyone's tickets" below (ticket chips -- see that
                section for why the standalone chip panel was dropped
                rather than duplicated). Only room code and the mode
                legend stay here, since they're static reference info,
                not per-turn status. */}
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

          {(isMrXTurn && isMyTurnToAct && !pendingMove) || extraHeaderContent ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              {isMrXTurn && isMyTurnToAct && !pendingMove && (
                <button
                  style={{
                    ...styles.doubleBtnCompact,
                    opacity: match.mrX.tickets.double > 0 && !match.mrX.doubleMoveActive ? 1 : 0.4,
                    cursor: match.mrX.tickets.double > 0 && !match.mrX.doubleMoveActive ? "pointer" : "default",
                    flexShrink: 0,
                  }}
                  disabled={match.mrX.tickets.double <= 0 || match.mrX.doubleMoveActive}
                  onClick={onActivateDoubleMove}
                >
                  Play 2x ({match.mrX.tickets.double})
                </button>
              )}
              {/* extraHeaderContent (End Game in pass-and-play; Pause +
                  End Game vote in multiplayer -- deliberately kept SHORT
                  here) shares this same row instead of stacking on its
                  own line below -- for Mr.X specifically, this was
                  pushing these controls far enough down to require
                  scrolling before they were visible; putting them side by
                  side with the 2x button keeps everything reachable
                  without scrolling, matching how the detective view
                  already looked (it never had the 2x button competing for
                  space). justifyContent switched from "space-between" to
                  "flex-end": space-between pushed the 2x button to the far
                  LEFT edge and extraHeaderContent to the far RIGHT edge of
                  the row, which -- combined with flexWrap -- was enough
                  horizontal spread to make the row wrap onto two lines
                  well before it actually ran out of room; flex-end packs
                  everything together on the right, matching how
                  extraHeaderContent's own internal buttons are already
                  right-aligned, and wraps only when genuinely necessary.
                  The div below strips extraHeaderContent's own
                  marginBottom so it doesn't create extra vertical gap now
                  that it's inline rather than stacked. */}
              {extraHeaderContent && <div style={{ marginBottom: 0, display: "flex", gap: 8 }}>{extraHeaderContent}</div>}
            </div>
          ) : null}

          {/* extraHeaderContentBelow: a SECOND, separate row for bulkier
              controls that shouldn't crowd the 2x/Pause/End-Game row above
              -- multiplayer's Takeover Reversal + Redistribute Roles votes
              (and the TakeoverPanel) land here instead of competing for
              space with the first row. */}
          {extraHeaderContentBelow}

          {/* Route explorer v2: no separate mode-picker control anymore --
              your own detectives' reachable stations are shown by default
              (seeded once, then fully toggle-controlled -- clicking any
              detective's token, including your own, turns its highlight
              on/off). This short hint replaces the old control row, so
              the mechanic is still discoverable without cluttering the
              sidebar with buttons. */}
          {iAmDetective && routeExplorerEnabled && match.detectives.some((d) => !myOwnDetectives.some((md) => md.id === d.id)) && (
            <div style={styles.exploreHint}>💡 Click any teammate's piece on the map to see their reachable stations too.</div>
          )}
          {isMrXTurn && iAmMrX && (
            <div style={styles.exploreHint}>
              {mrxSelfExplore ? "Showing your own reachable stations — click your token again to hide." : "💡 Click your own token to preview reachable stations."}
            </div>
          )}

          {/* Peek panel: pick ONE teammate (by player, not by detective --
              a player controlling several seats is one row) to mirror
              their ENTIRE current screen -- their own detectives' default
              highlights plus whatever they've personally toggled on --
              onto yours, live. Select again to stop peeking. Only players
              who currently allow it (myPeekable, opt-out below) are
              listed -- someone who's turned peeking off simply doesn't
              appear here, no "request denied" moment for either side.
              ONLY offered during the shared pre-think buffer -- peeking
              during Mr.X's turn or an individual detective's own act
              window doesn't match the "team is thinking together" moment
              this is meant for, and would otherwise risk a detective
              locking their OWN board (peeking blocks clicks) right as
              their own turn to act starts. See the auto-release effect
              below for the case where the buffer ends WHILE peeking. */}
          {iAmDetective &&
            routeExplorerEnabled &&
            preThinkActive &&
            detectivePlayersRoster.filter((p) => p.playerId !== myPlayerId && presenceState[p.playerId]?.peekable !== false).length > 0 && (
              <div style={styles.huddlePanel}>
                <div style={styles.exploreLabel}>Peek into a teammate's screen:</div>
                {detectivePlayersRoster
                  .filter((p) => p.playerId !== myPlayerId && presenceState[p.playerId]?.peekable !== false)
                  .map((p) => (
                    <button
                      key={p.playerId}
                      style={{
                        ...styles.huddleRow,
                        ...(peekedPlayerId === p.playerId ? styles.huddleRowActive : {}),
                      }}
                      onClick={() => setPeekedPlayerId(peekedPlayerId === p.playerId ? null : p.playerId)}
                    >
                      <span
                        style={{
                          ...styles.huddleDot,
                          background: match.detectives.find((d) => d.id === p.detectiveIds[0])?.color || "#666",
                        }}
                      />
                      {p.displayName}
                      {peekedPlayerId === p.playerId ? " (peeking)" : ""}
                    </button>
                  ))}
              </div>
            )}

          {/* Your OWN privacy preference -- controls whether you show up
              in OTHER players' peek lists above, not whether you can peek
              at others. Kept visible ANYTIME (not buffer-gated), since
              it's a durable preference you'd want to set once, not
              something to fumble with in the few seconds the buffer is
              actually running. */}
          {iAmDetective && routeExplorerEnabled && (
            <label style={styles.peekToggleRow}>
              <input type="checkbox" checked={myPeekable} onChange={(e) => setMyPeekable(e.target.checked)} />
              Let teammates peek into my screen
            </label>
          )}

          {/* Freehand drawing -- pen/eraser/undo only, no color picker (a
              single fixed graphite color for everyone, see styles.strokeColor
              below), never visible to Mr.X. While peeking a teammate's
              screen, these three buttons draw on THEIR board instead of
              yours (see applyStrokeAction) -- the label reflects that. */}
          {iAmDetective && (
            <div style={styles.drawToolbar}>
              <button
                type="button"
                style={{ ...styles.drawToolBtn, ...(drawMode === "pen" ? styles.drawToolBtnActive : {}) }}
                onClick={() => setDrawMode(drawMode === "pen" ? null : "pen")}
              >
                ✏️ Pen
              </button>
              <button
                type="button"
                style={{ ...styles.drawToolBtn, ...(drawMode === "eraser" ? styles.drawToolBtnActive : {}) }}
                onClick={() => setDrawMode(drawMode === "eraser" ? null : "eraser")}
              >
                🧹 Eraser
              </button>
              <button type="button" style={styles.drawToolBtn} onClick={undoLastStroke}>
                ↩️ Undo
              </button>
              {!peekedPlayerId && lastRoundStrokes.length > 0 && (
                <button type="button" style={styles.drawToolBtn} onClick={recallLastRoundStrokes}>
                  🕓 Recall last round
                </button>
              )}
              {peekedPlayerId && drawMode && <span style={styles.exploreHint}>Drawing on their board</span>}
            </div>
          )}

          {/* Pass Turn moved here (previously sat at the very BOTTOM of
              the sidebar, after chat -- the last thing in the whole
              panel) per explicit request: it's a genuinely urgent,
              time-sensitive action (you're stuck and need to act to keep
              the game moving), not something that belongs buried below
              read-only information like the travel log or chat. Grouped
              with the other action controls (2x/Pause/End-Game,
              Takeover, explore-mode) rather than left at the bottom. */}
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

          <div style={styles.allTicketsPanel}>
            <div style={styles.travelLogTitle}>Everyone's tickets</div>
            <div style={styles.detectiveOverviewRow}>
              <div
                style={{
                  ...styles.detectiveOverviewCard,
                  // The standalone "this player's own tickets" chip panel
                  // (previously in the sidebar header) was dropped as
                  // redundant once this list already shows every player's
                  // tickets, including the current mover's -- but that
                  // meant there was no more quick "whose turn, what do
                  // they have" glance without reading every row. This
                  // visually emphasizes whichever row belongs to the
                  // player whose turn it currently is, so that glance is
                  // still just as fast as the old dedicated panel was.
                  ...(isMrXTurn ? styles.detectiveOverviewCardActive : {}),
                }}
              >
                <div style={{ ...styles.detectiveOverviewDot, background: "#1a1a1a" }} />
                <span style={{ fontWeight: 700, marginRight: 4 }}>{mrxName()}</span>
                {sortTicketEntries(match.mrX.tickets).map(([mode, count]) => (
                  // title carries the FULL (possibly renamed) mode label --
                  // the chip itself only has room for the short
                  // abbreviation (e.g. "T"), so on a themed map (e.g.
                  // "Horse" instead of "Taxi") the rename was previously
                  // invisible here even though it correctly showed
                  // elsewhere (legend, explore buttons). This is the fix.
                  <span
                    key={mode}
                    title={mode === "double" ? "Double move" : activeMode[mode]?.label}
                    style={{ ...styles.miniChip, color: activeMode[mode] ? activeMode[mode].color : "#666" }}
                  >
                    {modeChipLetter(mode, activeMode)}
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
                const isActiveMover = !isMrXTurn && activeDetective && activeDetective.id === d.id;
                return (
                  <div
                    key={d.id}
                    style={{
                      ...styles.detectiveOverviewCard,
                      ...(isActiveMover ? styles.detectiveOverviewCardActive : {}),
                    }}
                  >
                    <div style={{ ...styles.detectiveOverviewDot, background: d.color }} />
                    <span style={{ fontWeight: 700, marginRight: 4 }}>{label}</span>
                    {sortTicketEntries(d.tickets).map(([mode, count]) => (
                      <span key={mode} title={activeMode[mode]?.label} style={{ ...styles.miniChip, color: activeMode[mode].color }}>
                        {modeChipLetter(mode, activeMode)}
                        {count}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={styles.travelLogPanel}>
            <div style={styles.travelLogTitle}>
              {mrxName()}'s travel log ({match.maxRounds + 2} moves max — {match.maxRounds} rounds + 2 double-move legs)
            </div>
              {/* "Next reveal in N moves" banner removed -- now redundant
                  with the log grid below, which highlights EVERY reveal
                  move (including upcoming ones, not just past ones) with
                  a red border and an explicit tooltip on hover. Keeping
                  both said the same thing twice and cost real vertical
                  space in the sidebar. */}
              <div style={styles.logBoard}>
                {Array.from({ length: match.maxRounds + 2 }, (_, i) => i + 1).map((moveNum) => {
                  const entry = match.mrX.travelLog.find((e) => e.move === moveNum);
                  // Fixed move-number-based reveal slots -- known in
                  // advance regardless of whether this specific move has
                  // been played yet, unlike the old round-based check
                  // which could only tell you about ALREADY-PLAYED moves
                  // (a future move's eventual ROUND number is genuinely
                  // unknowable in advance, since double-moves shift it --
                  // but its MOVE NUMBER is fixed the whole game, so this
                  // now correctly highlights upcoming reveal slots too,
                  // not just past ones).
                  const belongsToRevealRound = match.revealRounds.includes(moveNum);
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
                          ? `Move ${moveNum} (round ${entry.round}): ${activeMode[entry.mode].label}${belongsToRevealRound ? " — reveal move" : ""}`
                          : `Move ${moveNum}${belongsToRevealRound ? " — reveal move (upcoming)" : ""}: not yet played`
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
                          {modeChipLetter(entry.mode, activeMode)}
                        </div>
                      ) : (
                        <div style={styles.logBoardModeTagEmpty}>·</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {match.mrX.revealedPos && match.mrX.lastRevealMove === match.mrX.travelLog.length && (
                <div style={styles.travelLogReveal}>
                  Last confirmed sighting: {stationLabel(match.mrX.revealedPos)} (round {match.mrX.lastRevealRound})
                </div>
              )}
            </div>

          {belowTicketsContent}

          {message && <div style={styles.messageBar}>{message}</div>}

          {/* "Waiting for X..." note removed here -- it duplicated the
              turn label already shown at the top of the sidebar next to
              the round/timer ("Mr. X's Turn" / "Detective N's Turn"),
              per explicit request. That header is always visible without
              scrolling, so this second copy lower in the panel added
              nothing. */}

        </div>

        <div style={styles.boardColumnFull} ref={boardColumnRef}>
          {/* Computed ONCE and reused by both the top bar and the map
              wrapper below, so they always share the EXACT same width --
              previously the top bar used the raw column width while the
              map used this letterbox-fit width, and those two values
              only coincidentally matched when the column's WIDTH was the
              binding constraint; on a tall/narrow screen where the
              column's HEIGHT binds instead, the map shrinks narrower
              than the full column while the top bar (not knowing that)
              stayed at the full column width, visibly wider than the
              map beneath it. Computing this once up front and using it
              for both elements makes that mismatch structurally
              impossible rather than something that has to stay in sync
              by coincidence. */}
          {(() => {
            const { width: colW, height: colHRaw } = columnSize;
            const colH = Math.max(0, colHRaw - topBarHeight);
            let fittedWidth, fittedHeight;
            if (!colW || !colH) {
              fittedWidth = "100%";
              fittedHeight = "100%";
            } else {
              const trueRatio = baseW / baseH;
              const heightIfFullWidth = colW / trueRatio;
              if (heightIfFullWidth <= colH) {
                // Width is the binding constraint -- the map already
                // fills the column's full width at its TRUE ratio, no
                // stretch needed or possible here.
                fittedWidth = colW;
                fittedHeight = heightIfFullWidth;
              } else {
                // Height is the binding constraint -- at the map's true
                // ratio, filling the column's full height leaves real
                // unused width on both sides (confirmed via direct
                // measurement: 175px per side, ~23% of the column, on a
                // 1920x1080 screen -- not a rounding error, a genuine
                // structural mismatch between the map's own shape
                // (1.17) and typical wide-screen shapes (1.4-1.6)).
                // BOUNDED STRETCH: rather than either full distortion
                // (rejected earlier -- visibly warped the map on wide
                // screens) or zero stretch (leaves that real gap
                // unused), allow the effective ratio to widen up to
                // MAX_STRETCH_RATIO beyond the map's true ratio, using
                // however much of that allowance is needed to fill the
                // column's width -- capped so it can NEVER exceed that
                // ceiling even on extreme ultrawide monitors, where
                // eliminating the gap entirely would need far more
                // stretch than is visually acceptable.
                const MAX_STRETCH_RATIO = 1.10; // effective ratio can widen up to 10% beyond the map's true ratio
                const widthIfFullHeightTrueRatio = colH * trueRatio;
                const stretchNeededToFillWidth = colW / widthIfFullHeightTrueRatio;
                const appliedStretch = Math.min(stretchNeededToFillWidth, MAX_STRETCH_RATIO);
                fittedWidth = widthIfFullHeightTrueRatio * appliedStretch;
                fittedHeight = colH;
              }
            }
            return (
              <>
                {/* Top-of-map bar: round + turn banner (left) and the
                    turn timer (filling the rest), always visible
                    regardless of sidebar scroll -- moved here from the
                    sidebar header per explicit request, since the
                    sidebar can scroll but this column's content above
                    the map cannot. */}
                <div ref={topBarRef} style={{ ...styles.mapTopBar, width: fittedWidth }}>
                  <div style={styles.mapTopBarTurn}>
                    {!isMrXTurn && <span style={{ ...styles.turnColorDot, background: activeDetective.color }} />}
                    <span style={styles.mapTopBarRound}>Round {match.round}/{match.maxRounds}</span>
                    <span style={styles.mapTopBarDivider}>—</span>
                    {preThinkActive ? (
                      // Pre-think buffer: framed as a TEAM moment, not any
                      // one seat's turn -- nobody can move yet, so naming
                      // a single "X's Turn" here would be misleading.
                      <span style={styles.mapTopBarBufferLabel}>
                        🕵️ Detectives are planning their move…
                      </span>
                    ) : (
                      <span>{isMrXTurn ? `${mrxName()}'s Turn` : `${detectiveName(activeDetective.id)}'s Turn`}</span>
                    )}
                  </div>
                  {secondsRemaining != null && (preThinkActive || turnTimerSeconds) && (
                    <div style={styles.mapTopBarTimerWrap}>
                      {(() => {
                        // The bar's denominator changes with the phase --
                        // full turnTimerSeconds only applies to a plain
                        // detective act window; Mr.X's window and the
                        // buffer each have their own (longer) total.
                        const denom = timerPhase === "mrx" ? mrxSecondsForBar : timerPhase === "buffer" ? bufferSecondsForBar : turnTimerSeconds;
                        const frac = denom ? secondsRemaining / denom : 0;
                        return (
                          <>
                            <div style={styles.turnTimerBarTrack}>
                              <div
                                style={{
                                  ...styles.turnTimerBarFill,
                                  width: `${Math.max(0, Math.min(100, frac * 100))}%`,
                                  background: timerBarColor(frac),
                                }}
                              />
                            </div>
                            <div style={styles.turnTimerBarText}>{secondsRemaining}s</div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    ...styles.boardWrap,
                    // Exact JS-computed fit, using the REAL measured
                    // container size from ResizeObserver (columnSize)
                    // above -- see the long-standing comment history in
                    // this file for why CSS-only approaches kept failing
                    // to reliably hold the map's true aspect ratio.
                    // topBarHeight is subtracted from the available
                    // height first (that space is genuinely occupied by
                    // the top bar above), and fittedWidth/fittedHeight
                    // are the SAME values just used for the top bar
                    // above, guaranteeing the two always match exactly.
                    width: fittedWidth,
                    height: fittedHeight,
                    margin: "0 auto",
                  }}
                >
            <svg
              ref={svgRef}
              viewBox={`${pan.x} ${pan.y} ${viewSizeW} ${viewSizeH}`}
              // "none" (stretch to fill exactly) rather than "meet"
              // (preserve ratio, letterbox) -- now safe because the
              // WRAPPER's own width is already capped to never exceed
              // MAX_STRETCH_RATIO (15%) beyond the map's true ratio (see
              // the fittedWidth/fittedHeight calculation above), so this
              // can only ever apply that same small, bounded stretch --
              // not the unbounded distortion "none" would have allowed
              // if the wrapper could be ANY width, which is why an
              // earlier version of this file used "meet" instead.
              preserveAspectRatio="none"
              style={{
                ...styles.board,
                width: "100%",
                height: "100%",
                maxWidth: "none",
                cursor: zoom > 1 ? "grab" : "default",
                touchAction: "none",
              }}
              onWheel={handleWheel}
              onMouseDown={drawMode ? handleDrawPointerDown : handlePointerDown}
              onMouseMove={drawMode ? handleDrawPointerMove : undefined}
              onMouseUp={drawMode ? handleDrawPointerUp : undefined}
              onTouchStart={drawMode ? handleDrawPointerDown : handleTouchStart}
              onTouchMove={drawMode ? handleDrawPointerMove : handleTouchMove}
              onTouchEnd={drawMode ? handleDrawPointerUp : () => (dragState.current = null)}
            >
              <defs>
                <linearGradient id="riverGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#bcdcea" />
                  <stop offset="100%" stopColor="#a7cede" />
                </linearGradient>
                <radialGradient id="lakeGrad" cx="50%" cy="40%" r="65%">
                  <stop offset="0%" stopColor="#7aa8c7" />
                  <stop offset="100%" stopColor="#5f93b8" />
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
              {/* Admin decorations (icons/shapes/text/images) -- always
                  painted directly after the background and before any
                  transit line or station, so they can never visually
                  cover anything gameplay-relevant. See DecorationsLayer.jsx. */}
              <DecorationsLayer decorations={map.decorations} />

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
                // autoParallelOffset (curveGeometry.js) is the single
                // source of truth for this -- it also corrects for the
                // real bug the old inline nx/ny "reference direction"
                // computation here was meant to fix but never actually
                // applied (see that function's comment): parallel edges
                // whose (a,b) order differs between tuples were landing on
                // the SAME side instead of opposite sides and completely
                // hiding one another, confirmed for real for Majestic<->JP
                // Nagar and other pairs.
                const offset = autoParallelOffset(a, b, mode, map.edgeGroups);
                // manualCurveOffsets: an optional per-map lookup for
                // edges that need a deliberate stylistic curve (bowing
                // away from a specific named third-party station, not
                // just separating multiple parallel edges between the
                // SAME two stations, which is what `offset` above
                // already handles automatically). Keyed the same way as
                // edgeGroups ("lowerId-higherId"). When present, this
                // REPLACES the automatic offset for that edge rather
                // than adding to it, since these are single edges (no
                // parallel sibling to separate from) that just want a
                // specific bow shape.
                const manualOffset = map.manualCurveOffsets && map.manualCurveOffsets[key];
                const finalOffset = manualOffset != null ? manualOffset : offset;
                // curvePathD handles both shapes uniformly: a single
                // number (the automatic per-edge offset above is always
                // this shape, and so is every EXISTING manual override in
                // every map file) renders as the exact same single
                // quadratic Bezier this project has always used; an
                // array of 2-3 numbers (a manual override with multiple
                // bend points, set via the admin Map Editor for longer
                // routes that need an S-shape) renders as a smooth
                // multi-point spline instead -- see curveGeometry.js for
                // the full reasoning.
                const pathD = curvePathD(ax, ay, bx, by, finalOffset);
                // Underground/metro gets a small additional weight boost
                // (0.5 vs the earlier 0.45) so it reads clearly even amid
                // a dense taxi mesh, since it's the rarest/most important
                // tier on the map.
                const strokeW = mode === "underground" ? 0.5 : mode === "bus" ? 0.35 : mode === "ferry" ? 0.22 : 0.32;
                // Raised from 0.35 to 0.5 for the zoomed-out case --
                // darkening the taxi line color alone (see MODE_DEFAULT
                // in mapSchema.js) wouldn't meaningfully fix contrast if
                // the line is still faded to a third of its opacity;
                // 0.5 keeps taxi visually secondary to bus/metro (still
                // below their 0.85) while being genuinely legible
                // against the also-darkened background.
                // Raised from 0.5 to 0.85 -- a real, confirmed gap:
                // checking the RENDERED effective color (taxi's color
                // blended over the background AT this opacity, not just
                // the pure swatch color) showed effective contrast was
                // only 1.73:1 at the old 0.5 opacity, well below the
                // pure color's own 3.29:1 -- the fade was silently
                // undoing most of the earlier contrast work. Combined
                // with the lighter background below, effective contrast
                // is now ~2.97:1. Taxi now renders at the same opacity
                // as bus/metro rather than being distinctly faded --
                // acceptable since the color/contrast work already
                // keeps it visually the "quietest" of the three tiers
                // without needing an opacity crutch too.
                const taxiFadeOpacity = 0.85;
                const lineOpacity = mode === "taxi" ? taxiFadeOpacity : mode === "ferry" ? 0.4 : 0.85;
                return (
                  <g key={`${key}-${mode}-${i}`}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={strokeW + 0.35}
                      strokeLinecap="round"
                      opacity={mode === "taxi" ? taxiFadeOpacity * 0.9 : 0.9}
                    />
                    <path
                      d={pathD}
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
                // Fixed to compare MOVE numbers, not round numbers -- see
                // the long comment in gameEngine.js's mrX state (near
                // lastRevealMove) for why: round number doesn't change
                // between the two legs of a double-move, so this was
                // incorrectly staying "currently revealed" through a
                // second leg that did NOT actually reveal.
                const isCurrentReveal = isLastKnown && match.mrX.lastRevealMove === match.mrX.travelLog.length;
                // Every currently-highlighted detective that can reach
                // THIS station (all-modes-at-once, ticket-aware -- see
                // reachableByDetectiveId above), plus Mr.X's own
                // self-explore highlight if he's toggled it on. The
                // active mover's OWN entry is dropped whenever this
                // station is already one of their real legal moves
                // (isLegal, below) -- that ring already shows the exact
                // same information (and more precisely, ticket- and
                // occupancy-checked), so keeping both was pure visual
                // redundancy, not two different facts.
                const reachingDetectives = (reachableByDetectiveId.get(numId) || []).filter(
                  (rd) => !(isLegal && activeDetective && rd.detId === activeDetective.id && isMyTurnToAct && !preThinkActive)
                );
                const isMrxReachable = mrxReachable.has(numId);
                // Whether THIS station is a highlighted detective's
                // CURRENT position (its "origin" for the explore
                // highlight) -- skipped when it's already the active
                // mover's own turn-indicator station, to avoid drawing
                // two rings on top of each other.
                const originDetective =
                  detHere && highlightedDetectiveIds.has(detHere.id) && !(!isMrXTurn && activeDetective && detHere.id === activeDetective.id)
                    ? detHere
                    : null;
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
                    {/* Reachable-destination highlights, all-modes-at-once
                        and ticket-aware -- stacked one ring per
                        currently-highlighted detective that can reach
                        this station, so overlapping sets from different
                        detectives stay distinguishable by color. */}
                    {reachingDetectives.map((rd, i) => (
                      <circle
                        key={rd.detId}
                        cx={x}
                        cy={y}
                        r={nodeR + 1.0 + i * 0.4}
                        fill={i === 0 ? rd.color : "none"}
                        opacity={i === 0 ? 0.22 : 0.85}
                        stroke={rd.color}
                        strokeWidth={0.3}
                        strokeDasharray={i === 0 ? undefined : "0.4,0.4"}
                      />
                    ))}
                    {isMrxReachable && (
                      <circle cx={x} cy={y} r={nodeR + 1.0} fill="#1a1a1a" opacity={0.22} stroke="#1a1a1a" strokeWidth={0.3} />
                    )}
                    {/* Origin ring for any highlighted detective's CURRENT
                        position -- lets you see, at a glance, whose
                        highlight a given cluster of destinations belongs
                        to, without needing the side panel. */}
                    {originDetective && highlightPositionStyle !== "blink" && (
                      <HighlightRing x={x} y={y} radius={nodeR + 1.2} color={originDetective.color} strokeWidth={0.35} dashed style={highlightPositionStyle} />
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
                        const dist = (isMajor ? 2.2 : isTiny ? 1.3 : 1.7) * sizeScale;
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
              {/* Freehand drawing layer -- ALWAYS on top of everything
                  else on the map, since it's an annotation over the
                  board, not part of it. Never rendered for Mr.X (see
                  iAmDetective gate). Shows whichever board is currently
                  "in view": your own strokes normally, or the peeked
                  player's strokes while peeking -- never both, matching
                  the same board you're actually looking at. The
                  in-progress stroke (liveStrokePoints) renders regardless
                  of peek state, since that's immediate feedback for the
                  hand currently drawing. */}
              {iAmDetective && (
                <g style={{ pointerEvents: "none" }}>
                  {strokesToRender.map((s) => (
                    <path key={s.id} d={pointsToPath(s.points)} fill="none" stroke={styles.strokeColor} strokeWidth={0.35} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
                  ))}
                  {liveStrokePoints && liveStrokePoints.length > 1 && (
                    <path d={pointsToPath(liveStrokePoints)} fill="none" stroke={styles.strokeColor} strokeWidth={0.35} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
                  )}
                </g>
              )}
            </svg>
            {isMyTurnToAct && pendingMove && (() => {
              const [sx, sy] = map.stations[pendingMove.to];
              const screenPos = svgPointToScreenPoint(sx, sy);
              if (isMrXTurn) {
                // Build one option per genuinely available mode to this
                // destination (fixes the old single-edge bug: previously
                // pendingMove only ever carried ONE mode, so a station
                // reachable by e.g. both taxi and bus only ever offered
                // one of them here, and black-ticket eligibility was
                // checked against only that one mode too). Ferry always
                // costs a black ticket specifically (no separate "ferry
                // ticket" exists), so it gets its own distinct option
                // rather than being lumped with the generic black-ticket
                // fallback below.
                const options = [];
                const nonFerryModes = pendingMove.availableModes.filter((m) => m !== "ferry");
                const hasFerry = pendingMove.availableModes.includes("ferry");

                for (const mode of nonFerryModes) {
                  if (match.mrX.tickets[mode] > 0) {
                    options.push({
                      key: `mode-${mode}`,
                      label: `${activeMode[mode].label} ticket`,
                      onClick: () => commitMrXMove(mode, mode),
                    });
                  }
                }
                if (hasFerry && match.mrX.tickets.black > 0) {
                  options.push({
                    key: "ferry",
                    label: `${activeMode.ferry.label} (black ticket)`,
                    accent: activeMode.ferry.color,
                    onClick: () => commitMrXMove("ferry", "black"),
                  });
                }
                // Generic black-ticket camouflage option: ONE shared
                // entry (not one per mode) since black substitutes for
                // whichever non-ferry mode the player mentally intends --
                // the actual edge used is whichever non-ferry mode is
                // available; if more than one non-ferry mode exists,
                // default to the first (matches prior behavior of
                // "black" always being offered as a single blanket
                // camouflage option, not mode-specific).
                if (nonFerryModes.length > 0 && match.mrX.tickets.black > 0) {
                  options.push({
                    key: "black",
                    label: "Black ticket (camouflage)",
                    accent: "#2b2b2b",
                    onClick: () => commitMrXMove(nonFerryModes[0], "black"),
                  });
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
                // Same fix for detectives: one option per available mode
                // to this destination, instead of assuming only one mode
                // was ever possible.
                const options = pendingMove.availableModes.map((mode) => ({
                  key: mode,
                  label: `${activeMode[mode].label} ticket`,
                  onClick: () => commitDetectiveMove(activeDetective.id, pendingMove.to, mode),
                }));
                return (
                  <MovePopup
                    x={screenPos.x}
                    y={screenPos.y}
                    fallback={screenPos.fallback}
                    openDirection={screenPos.openDirection}
                    title={
                      pendingMove.availableModes.length === 1
                        ? `Move to ${stationLabel(pendingMove.to)} using ${activeMode[pendingMove.availableModes[0]].label}?`
                        : `Move to ${stationLabel(pendingMove.to)} via:`
                    }
                    options={options}
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
              </>
            );
          })()}

        </div>
      </div>
    </div>
  );
}

export function TicketChip({ mode, count, modeTheme }) {
  const activeMode = modeTheme || MODE_DEFAULT;
  const m = activeMode[mode];
  return (
    <div style={{ ...styles.chip, borderColor: m.color }} title={m.label}>
      <span style={{ ...styles.chipDot, background: m.color }} />
      {modeChipLetter(mode, activeMode)} {count}
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
  // headerBarSlim replaces headerBar's old role in the sidebar -- round
  // label, turn label, timer, and this-player's ticket chips all moved
  // out (to the new map-top bar and "Everyone's tickets"), so this is
  // now just room code + mode legend, stacked simply rather than the old
  // two-column layout (which existed to make room for the ticket chips
  // on the right -- no longer needed).
  headerBarSlim: {
    width: "100%",
    marginBottom: 10,
  },
  // New bar rendered above the map itself (see boardColumnFull) --
  // round + turn banner on the left, timer filling the rest. Always
  // visible regardless of sidebar scroll, which was the whole point of
  // moving it out of the sidebar.
  mapTopBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#fff",
    borderRadius: 10,
    padding: "8px 14px",
    marginBottom: 8,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    boxSizing: "border-box",
  },
  mapTopBarTurn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 15,
    fontWeight: 700,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  mapTopBarRound: { color: "#888", fontWeight: 600, fontSize: 13 },
  mapTopBarDivider: { color: "#ccc", fontWeight: 400 },
  mapTopBarBufferLabel: { color: "#5b4636", fontWeight: 700 },
  timerSchedulePreview: {
    marginTop: -4,
    padding: "10px 12px",
    background: "#f7f5f0",
    border: "1px solid #e7e2d6",
    borderRadius: 8,
    fontSize: 12.5,
    color: "#5a5648",
    lineHeight: 1.6,
  },
  timerSchedulePreviewTitle: { fontWeight: 700, color: "#3d3a30", marginBottom: 2 },
  mapTopBarTimerWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 60,
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
    boxSizing: "border-box",
    background: "#fff",
    borderRadius: 12,
    padding: "8px 14px",
    marginBottom: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  detectiveOverviewPanel: {
    width: "100%",
    maxWidth: 760,
    background: "#fff",
    borderRadius: 12,
    padding: "8px 14px",
    marginBottom: 10,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  detectiveOverviewRow: { display: "flex", flexDirection: "column", gap: 4 },
  detectiveOverviewCard: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    flexWrap: "wrap",
  },
  // Highlights whichever row belongs to the player whose turn it
  // currently is -- see the comment at its usage for why this exists
  // (replaces the old standalone this-player ticket-chip panel).
  detectiveOverviewCardActive: {
    background: "#fdf6e8",
    borderRadius: 6,
    padding: "3px 6px",
    margin: "-3px -6px",
    boxShadow: "0 0 0 1px #eecf8a",
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
    padding: "1px 1px",
    textAlign: "center",
    background: "#fbf9f2",
    minHeight: 24,
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
    boxSizing: "border-box",
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
    // Neutral default look (matches the other buttons that share this
    // row -- Pause, End Game, exploreBtn elsewhere -- all plain white/
    // light-grey by default), per explicit request: the old solid
    // purple border + tinted background made this button look already
    // "selected" or "active" even in its normal, not-yet-clicked state,
    // which was genuinely misleading. The purple accent is kept only in
    // the TEXT color, just enough to signal "this is a special power"
    // without implying it's currently toggled on.
    border: "1.5px solid #ddd",
    color: "#6b4fa0",
    background: "#fff",
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
  drawToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    padding: "4px 2px",
  },
  drawToolBtn: {
    padding: "5px 10px",
    borderRadius: 8,
    border: "1.5px solid #ddd",
    background: "#fff",
    fontSize: 12.5,
    cursor: "pointer",
  },
  drawToolBtnActive: { borderColor: "#4a4a45", background: "#f4f2ec", fontWeight: 700 },
  strokeColor: "#4a4a45", // fixed graphite grey -- same for every player, see drawing-feature design comment above
  peekToggleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "#8a8375",
    padding: "4px 2px",
  },
  exploreHint: {
    fontSize: 12.5,
    color: "#8a8375",
    padding: "6px 2px",
  },
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
