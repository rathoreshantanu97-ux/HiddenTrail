import React, { useState, useMemo, useEffect } from "react";
import MapBackground, { MapFrameAndCompass } from "./MapBackground.jsx";
import { useHighlightStyles } from "../lib/useHighlightStyles.js";
import HighlightRing from "./HighlightRing.jsx";
import MovePopup from "./MovePopup.jsx";
import { useMoveAnimation } from "../lib/useMoveAnimation.js";
import { useFeatureEnabled } from "../lib/useFeatureEnabled.js";
import { MODE_DEFAULT, modeChipLetter } from "../maps/mapSchema.js";
// bonusForTally -- the client-side mirror of the server's
// stay_tally_bonuses() rule, kept in matchStateAdapter.js so exactly one
// copy of it exists on this side of the wire (v3.28).
import { bonusForTally } from "../lib/matchStateAdapter.js";
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
// STAY_TICKET_ORDER (v3.25) -- the order a forfeited ticket is taken in
// when a piece stays put: cheapest fare first. Deliberately identical to
// the ordering the server uses for BOTH ticket penalties (Mr.X's
// stay/timeout in mrx_stay_internal and the detectives' acting-phase
// timeout in force_end_acting_phase), so what the confirm popup promises
// is exactly what the server will take. black/double are excluded on
// purpose -- they're special powers, not fare.
const STAY_TICKET_ORDER = ["taxi", "bus", "underground"];

// cheapestHeldTicket -- which ticket type a stay-put action would
// actually cost right now, or null if the piece holds none of the
// chargeable types (in which case staying is free, matching the
// server's "nothing left to deduct" branch).
export function cheapestHeldTicket(tickets) {
  if (!tickets) return null;
  return STAY_TICKET_ORDER.find((m) => (tickets[m] || 0) > 0) || null;
}

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
  onPassTurn, // (actor) => void -- PASS-AND-PLAY ONLY (single shared device, still fully sequential turnIdx-walking). Multiplayer uses onPassMrxTurn/onPassDetectiveTurn instead (see the 3-phase acting model below).
  onPassMrxTurn, // () => void -- multiplayer only: Mr.X genuinely has zero legal moves
  onMrxStayHere, // () => void -- multiplayer only (v3.25): Mr.X deliberately stays on his current station. Costs one ticket of his cheapest held type and is logged openly as a non-move round. Never passed in pass-and-play.
  onPassDetectiveTurn, // (detId) => void -- multiplayer only: a specific detective genuinely has zero legal moves (or chooses not to move) during the acting phase
  onBeginActingPhase, // () => void -- multiplayer only: ends the shared planning window early. Now only the TIMEOUT path uses this (see useTurnTimer.js); the in-game control is the unanimous ready vote below.
  onSetPlanningReady, // (ready: boolean) => void -- multiplayer only: tick/un-tick MY "ready to act" vote. The SERVER decides when the vote is unanimous and flips the phase.
  connectedDetectivePlayerIds = [], // playerIds of detective-controlling players currently online (multiplayer only) -- the denominator for "Ready (X of Y)"
  extraHeaderContent, // room-level vote/admin controls (Pause + End Game vote in multiplayer, End Game in pass-and-play, Rulebook). v3.30: these render in the always-visible "utility cluster" at the BOTTOM of the side panel (the v3.29 menu is gone). Each control is still individually feature-flag-gated inside its own component.
  extraHeaderContentBelow, // bulkier room-level controls (Takeover Reversal / Redistribute Roles votes, TakeoverPanel). v3.30: also in the bottom utility cluster, directly under extraHeaderContent.
  belowTicketsContent, // e.g. chat in multiplayer. v3.29: this is now the body of the "Chat" TAB in the side panel's tabbed lower section -- passing it is what makes that tab exist at all, so pass-and-play (which passes nothing) simply has no chat tab.
  onExploreModeChange, // (detectiveIds: number[]) => void -- reports this client's own EXTRA toggled-on detective ids (beyond their own, which are always shown by default) upward, so App.jsx can broadcast them via Presence
  onPeekableChange, // (peekable: boolean) => void -- reports this client's own "let teammates peek at my screen" preference upward, for the same Presence broadcast
  onStrokesChange, // (strokes: Stroke[]) => void -- reports this client's own drawing strokes upward, so App.jsx can answer a peer's strokes_request with the current set
  onRegisterPeerEventHandlers, // ({onStrokesSync, onRevealSync, onPeekOff}) => void -- called once on mount so App.jsx can wire the broadcast events that drive peek rendering (see usePresence.js) into this component's state
  onBroadcastStrokes, // (strokes) => void -- push MY current strokes to the room so active peekers re-render live. Replaces the old Presence-payload delivery, which silently dropped oversized/coalesced updates.
  onBroadcastReveal, // (revealedDetectiveIds) => void -- push MY current destination-reveal set to the room so active peekers mirror it live (v3.24). Same contract as onBroadcastStrokes.
  onRequestPeerStrokes, // (targetPlayerId) => void -- ask a player for their current strokes the moment I start peeking them, so I don't wait for their next edit
  onBroadcastPeekOff, // () => void -- tell the room I've revoked peek permission, releasing active peekers immediately
  detectivePlayersRoster = [], // [{playerId, displayName, detectiveIds: number[]}] -- every detective-seat player (not Mr.X), multiplayer only, used for the "peek into a player's screen" panel and for showing a peeked player's OWN highlights (which aren't separately broadcast, since they're deterministic from this same roster)
  presenceState = {}, // playerId -> {displayName, role, toggledDetectiveIds, strokes} -- live Presence payloads (multiplayer only), used to read a peeked player's EXTRA toggles and strokes
  myPlayerId = null, // this client's own player id (multiplayer only) -- used to exclude yourself from the peek list
  detectivePlayerNames = {}, // detectiveId -> player display name (multiplayer only) -- for the ticket counter's "Priya — D1" labeling
  secondsRemaining = null, // null (no timer set for this room) | number of seconds left in the current turn/phase -- shown to EVERYONE regardless of whose turn it is
  turnTimerSeconds = null, // the room's configured timer length (the detective act window), for showing "12 / 60s" style displays
  timerPhase = null, // null | "mrx" | "planning" | "acting" -- which segment of the turn schedule is currently counting down (see useTurnTimer.js)
  preThinkActive = false, // true during the shared detective pre-think buffer -- no one may COMMIT a move, though everyone may still preview reachable stations via the explore/huddle system
  actingActive = false, // true during the shared simultaneous acting phase -- any of your not-yet-acted detectives may be selected and moved
  mrxSecondsForBar = null, // Mr. X's full turn window (schedule.mrxSeconds) -- the denominator for the timer bar while timerPhase === "mrx"
  bufferSecondsForBar = null, // the shared pre-think buffer's full length (schedule.bufferSeconds) -- the denominator while timerPhase === "planning"
  actSecondsForBar = null, // v3.27: THIS player's OWN acting-pool length -- the denominator while timerPhase === "acting" (Mr.X/spectators get the safety cap here instead, since they have no pool of their own)
  safetyCapRemaining = null, // v3.27: seconds left on the round's OUTER SAFETY CAP (sized off the busiest player). Displayed as a muted backstop line only -- it drives nobody's ticket forfeits.
  // (v3.24: detectiveCapSeconds is gone. The acting phase has exactly one
  // clock again -- the pooled per-round window -- and a player's spotlight
  // only advances when they actually move or pass. See the acting-phase
  // block further down.)
  roomCode = null, // multiplayer only -- shown persistently so a disconnected player can be told the code to rejoin
  // v3.28 -- {x, y}: the room's two INDEPENDENT stay-reward thresholds,
  // already resolved (defaults applied) by resolveStayThresholds in
  // matchStateAdapter.js. Multiplayer only; null in pass-and-play, which
  // has no stay-reward mechanic at all and is left completely untouched.
  // Nothing below assumes any relationship between x and y.
  stayThresholds = null,
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
  // NOTE (v3.21): selectedActingDetId and the whole tap-to-arm model it
  // supported are GONE. During the acting phase, a player no longer picks
  // which of their detectives to move -- they get automatic, sequential
  // sub-turns over their own detectives in ascending seat order (see
  // myCurrentActingDetId below). Nothing needs selecting, so there is
  // nothing to hold in state.
  //
  // toggledIds: the set of detectives whose REACHABLE DESTINATIONS are
  // currently revealed on this client's board, toggled by clicking a
  // piece (see handleStationClick). Deliberately NOT seeded in
  // multiplayer anymore: during planning, every detective's ORIGIN is
  // shown by default through a separate path (planningOriginIds below),
  // and destinations are strictly opt-in per click, so a seeded set would
  // just dump every teammate's full destination fan onto the board at
  // once. Pass-and-play keeps its original seeding (one device, one
  // player, no "teammate" concept to declutter for).
  const [toggledIds, setToggledIds] = useState(() => new Set());
  // v3.28 -- PLANNING-PHASE VIEW FILTER. Purely a PERSONAL, client-side
  // preference: it narrows which detectives get a default origin
  // indicator on MY board during the planning phase, and nothing else.
  // It is never broadcast, never sent to the server, and has no effect on
  // anyone else's board or on what is legal. Default is deliberately
  // "all" -- the whole point of the planning phase is seeing the team's
  // full position, so narrowing it is an opt-in decluttering choice, not
  // the starting state.
  const [planningOriginScope, setPlanningOriginScope] = useState("all"); // "all" | "mine"
  // v3.29 layout reorganization -- which of the three read-mostly
  // surfaces (travel log / chat / peek) the tabbed lower section is
  // showing, and whether the room/admin menu is open. Both are purely
  // local view state: nothing here is shared, persisted or sent anywhere.
  // (v3.30: sidebarTab and menuOpen are gone -- there is no tabbed
  // section and no room menu any more. Every surface they used to hide
  // is rendered simultaneously; see the ordering note at the top of the
  // sidebar's JSX.)
  const seededOwnRef = React.useRef(false);
  const [peekedPlayerId, setPeekedPlayerId] = useState(null); // playerId whose ENTIRE screen (their own detectives + their own extra toggles) we're currently mirroring, via the side panel
  const [myPeekable, setMyPeekable] = useState(true); // whether I allow TEAMMATES to peek into my screen -- off by choice, broadcast via Presence, purely a privacy preference
  // peekedStrokes -- the drawing of whoever I'm currently peeking, fed
  // ONLY by explicit "strokes_sync" broadcasts (see usePresence.js), no
  // longer read out of their Presence payload. peekedStrokesOwnerId
  // guards against a stale set from a previously-peeked player briefly
  // rendering over the newly-peeked one before their first sync lands.
  const [peekedStrokes, setPeekedStrokes] = useState([]);
  const [peekedStrokesOwnerId, setPeekedStrokesOwnerId] = useState(null);
  // v3.23: every strokes_sync we ever see is cached by sender, whether
  // or not we're peeking that player at the time. Starting a peek then
  // renders the last known snapshot INSTANTLY out of this cache, with
  // the request/reply round trip demoted to a refresh rather than being
  // the only way to ever get a first frame.
  const strokesSyncCacheRef = React.useRef(new Map());
  // REVEAL SYNC (v3.24) -- the peeked player's own "which detectives'
  // destinations have I clicked open" set, delivered over the same
  // broadcast channel as strokes and cached the same way. Previously a
  // peeker could only see this through the peeked player's PRESENCE
  // payload (toggledDetectiveIds), which is coalescing and lossy -- so a
  // click could easily never reach the peeker at all, or arrive seconds
  // late. Presence is still read as the cold-start fallback (see
  // highlightedDetectiveIds below); broadcast is now the live path.
  const [peekedRevealIds, setPeekedRevealIds] = useState(null); // null = no broadcast snapshot for the current target yet
  const [peekedRevealOwnerId, setPeekedRevealOwnerId] = useState(null);
  const revealSyncCacheRef = React.useRef(new Map());
  // (v3.27: appliedStrokeActionIdsRef and the peek-draw delivery ledger
  // pendingPeekDrawsRef / confirmPeekDrawsRef lived here. All three
  // existed solely to make peek-and-draw deliver reliably, and all three
  // are gone with it. The remaining sync surface -- a player publishing
  // their own strokes and reveal set -- is made of FULL, IDEMPOTENT,
  // single-writer snapshots, so there is nothing left to de-duplicate,
  // acknowledge or retry: a missed message is simply corrected by the
  // next one.)
  //
  // The broadcast handlers below are installed once, so they must read
  // the CURRENT peek target through a ref rather than a stale closure.
  const peekedPlayerIdRef = React.useRef(peekedPlayerId);
  peekedPlayerIdRef.current = peekedPlayerId;

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

  // v3.27: starting a peek drops any armed pen/eraser. Peeking is
  // view-only, so leaving a tool selected would just be a dead cursor
  // (the pointer handlers refuse to draw) with a lit-up button
  // suggesting otherwise.
  useEffect(() => {
    if (peekedPlayerId) {
      setDrawMode(null);
      setLiveStrokePoints(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peekedPlayerId]);

  // BELT-AND-BRACES BACKUP ONLY (v3.21). Releasing a peek when the
  // peeked player opts out is now driven PRIMARILY by an explicit
  // "peek_off" broadcast (see the handler registration below) -- this
  // Presence-state-diffing effect proved unreliable in practice, because
  // it depends on a Presence sync actually landing and on the changed
  // `peekable` field surviving payload coalescing. It's kept because it
  // costs nothing and covers the case where a peeker joins/reloads while
  // the other player is ALREADY opted out (no broadcast in flight to
  // catch), but it is no longer the mechanism being relied on.
  useEffect(() => {
    if (peekedPlayerId && presenceState[peekedPlayerId]?.peekable === false) setPeekedPlayerId(null);
  }, [peekedPlayerId, presenceState]);

  // Whenever the peek TARGET changes: drop any previous target's drawing
  // immediately, then ask the new target to push theirs. Without this
  // request, a peeker starting mid-round would see a blank board until
  // the peeked player happened to draw something new.
  //
  // v3.23 FIX (peek-join snapshot). The old version fired exactly ONE
  // strokes_request and then simply waited. A single unacknowledged
  // request is fragile in both directions -- it can go out before the
  // target has anything to answer with, the reply can cross a
  // reconnect, or either leg can just be dropped -- and when it failed
  // the peeker sat on a blank board until the peeked player happened to
  // draw again, which is exactly the reported bug. Three changes:
  //   1. Paint the cached last-known snapshot immediately (usually there
  //      already IS one, from an earlier strokes_sync we merely ignored).
  //   2. Re-send the request on a short backoff instead of once. The
  //      reply is a full idempotent snapshot, so extra replies are free.
  //   3. See the heartbeat effect further below -- a player holding
  //      strokes re-announces them periodically, so convergence no
  //      longer depends on the request/reply pair succeeding at all.
  useEffect(() => {
    if (!peekedPlayerId) {
      setPeekedStrokes([]);
      setPeekedStrokesOwnerId(null);
      setPeekedRevealIds(null);
      setPeekedRevealOwnerId(null);
      return undefined;
    }
    // Same cached-snapshot-first treatment for the reveal set (v3.24).
    const cachedReveal = revealSyncCacheRef.current.get(peekedPlayerId);
    if (cachedReveal) {
      setPeekedRevealIds(cachedReveal);
      setPeekedRevealOwnerId(peekedPlayerId);
    } else {
      setPeekedRevealIds(null);
      setPeekedRevealOwnerId(null);
    }
    const cached = strokesSyncCacheRef.current.get(peekedPlayerId);
    if (cached && cached.length > 0) {
      setPeekedStrokes(cached);
      setPeekedStrokesOwnerId(peekedPlayerId);
    } else {
      setPeekedStrokes([]);
      setPeekedStrokesOwnerId(null);
    }
    if (!onRequestPeerStrokes) return undefined;
    let cancelled = false;
    const timers = [];
    const fire = () => {
      if (cancelled || peekedPlayerIdRef.current !== peekedPlayerId) return;
      onRequestPeerStrokes(peekedPlayerId);
    };
    fire();
    for (const delay of [400, 1200, 2500, 5000]) timers.push(setTimeout(fire, delay));
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peekedPlayerId]);

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
    setRecalledStrokes([]); // v3.24: the recall layer is per-round too
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
    setRecalledStrokes([]); // v3.24: the recall layer is per-round too
  }, [match?.round]);

  // RECALL, v3.24 -- the recalled drawing is now its OWN layer, painted
  // UNDERNEATH whatever has already been drawn this round, instead of
  // being merged into myStrokes. Merging meant last round's lines
  // interleaved with (and could sit on top of and obscure) the current
  // round's work, which defeats the point: recall is context you glance
  // back at, not something that should compete with what you're drawing
  // now. Being a separate layer also means it's local-only and never
  // broadcast -- it isn't part of your current drawing, so a peeker sees
  // your CURRENT strokes exactly as before, unpolluted by your recall.
  // Rendered first in the SVG (earlier paint order = lower) and dimmer.
  const [recalledStrokes, setRecalledStrokes] = useState([]);
  function recallLastRoundStrokes() {
    if (lastRoundStrokes.length === 0) return;
    // Toggle: pressing again puts it away, which is what everyone tries
    // first anyway.
    setRecalledStrokes((prev) => (prev.length > 0 ? [] : lastRoundStrokes));
  }

  function pointFromEvent(e) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return screenPointToSvgPoint(clientX, clientY);
  }

  // applyStrokeAction -- v3.27: a draw action ALWAYS lands on your own
  // board, full stop. Peeking no longer redirects it to the peeked
  // player (peek-and-draw is gone), and while a peek is active the
  // drawing tools are hidden and the pointer handlers below refuse to
  // start a stroke at all, so this can't even be reached mid-peek.
  //
  // What this deletes, and why it's the right call: the old version
  // stamped every action with an actionId, pushed it into a delivery
  // ledger, echoed it optimistically onto a local copy of someone
  // ELSE's board, and relied on that other client's next snapshot to
  // confirm or correct it -- four interacting mechanisms, three rounds
  // of fixes (v3.22/v3.23/v3.24), and still unreliable in live play.
  // With one writer per board there is nothing to reconcile.
  //
  // NOTE: this is only about drawing on someone else's board. Ordinary
  // drawing on your own board (draw_enabled) is untouched.
  function applyStrokeAction(action) {
    setMyStrokes((prev) => applyActionToStrokes(prev, action));
  }

  useEffect(() => {
    // The broadcast-driven peek events. All read the live peek
    // target through peekedPlayerIdRef, since these handlers are
    // installed exactly once and would otherwise capture the target
    // value from mount time (i.e. null, forever).
    onRegisterPeerEventHandlers &&
      onRegisterPeerEventHandlers({
        // A player pushed their current drawing. Apply it only if
        // they're the player I'm actually looking at right now.
        // ALWAYS cached (v3.23), even for a player I'm not peeking --
        // that cache is what lets a peek START show their drawing on the
        // very first frame instead of waiting on a request/reply.
        onStrokesSync: (payload) => {
          if (!payload?.senderPlayerId) return;
          const strokes = payload.strokes || [];
          strokesSyncCacheRef.current.set(payload.senderPlayerId, strokes);
          if (payload.senderPlayerId === peekedPlayerIdRef.current) {
            setPeekedStrokes(strokes);
            setPeekedStrokesOwnerId(payload.senderPlayerId);
          }
        },
        // A player pushed their current "revealed destinations" set
        // (v3.24). Cached for everyone, applied only for whoever I'm
        // actually peeking -- exactly the strokes_sync contract.
        onRevealSync: (payload) => {
          if (!payload?.senderPlayerId) return;
          const ids = Array.isArray(payload.revealedDetectiveIds) ? payload.revealedDetectiveIds : [];
          revealSyncCacheRef.current.set(payload.senderPlayerId, ids);
          if (payload.senderPlayerId === peekedPlayerIdRef.current) {
            setPeekedRevealIds(ids);
            setPeekedRevealOwnerId(payload.senderPlayerId);
          }
        },
        // A player revoked peek permission. If that's who I'm peeking,
        // drop out immediately -- this is the PRIMARY release path (the
        // Presence-diff effect above is only a backup).
        onPeekOff: (payload) => {
          if (payload?.senderPlayerId && payload.senderPlayerId === peekedPlayerIdRef.current) {
            setPeekedPlayerId(null);
          }
        },
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ERASE_RADIUS = 2.5; // map-space units, shared by local + remote erase

  // applyActionToStrokes -- what a draw action means. Since v3.27 there
  // is exactly ONE caller (your own drawing on your own board), which is
  // rather the point: this used to be shared by three paths writing to
  // two different boards. Pure: takes a list, returns a new list.
  function applyActionToStrokes(list, action) {
    const prev = list || [];
    if (action.kind === "add") {
      if (!action.stroke) return prev;
      if (prev.some((s) => s.id === action.stroke.id)) return prev;
      return [...prev, action.stroke];
    }
    if (action.kind === "undo") return prev.slice(0, -1);
    if (action.kind === "erase") {
      return prev.filter((s) => !s.points.some((pt) => Math.hypot(pt.x - action.point.x, pt.y - action.point.y) < ERASE_RADIUS));
    }
    return prev;
  }

  // v3.27: while peeking you are looking at SOMEONE ELSE'S board, so the
  // pen must do nothing at all -- not draw on theirs (that feature is
  // gone) and not silently accumulate on your own invisible board
  // either, which would be worse than useless. The toolbar is hidden
  // during a peek too; this is the enforcement behind that.
  const drawingBlocked = !!peekedPlayerId;

  function handleDrawPointerDown(e) {
    if (!drawMode || drawingBlocked) return;
    const p = pointFromEvent(e);
    if (!p) return;
    if (drawMode === "pen") {
      setLiveStrokePoints([p]);
    } else if (drawMode === "eraser") {
      applyStrokeAction({ kind: "erase", point: p });
    }
  }

  // MIN_POINT_SPACING: real bug fix -- a raw pointermove stream records a
  // new point every few pixels, so even a short doodle easily produced
  // 150-300+ {x,y} points in one stroke. That full array gets broadcast
  // over Supabase Realtime Presence (see usePresence.js's track() call)
  // on every stroke completion -- and Presence has a hard per-client
  // payload size limit, well under what a handful of undecimated strokes
  // adds up to. Past that limit the track() call is silently rejected by
  // Supabase, so the stroke never reaches teammates at all -- exactly the
  // reported "my drawing wasn't visible to whoever was peeking me" bug.
  // Only keeping points that are genuinely at least this far apart (in
  // MAP-SPACE units, so it scales with zoom consistently) cuts a typical
  // stroke down to a few dozen points with no visible loss of shape,
  // while staying well inside the payload limit.
  const MIN_POINT_SPACING = 0.6;

  function handleDrawPointerMove(e) {
    if (!drawMode || drawingBlocked) return;
    const p = pointFromEvent(e);
    if (!p) return;
    if (drawMode === "pen" && liveStrokePoints) {
      setLiveStrokePoints((prev) => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_SPACING) return prev;
        return [...prev, p];
      });
    } else if (drawMode === "eraser" && e.buttons === 1) {
      applyStrokeAction({ kind: "erase", point: p });
    }
  }

  function handleDrawPointerUp() {
    if (drawingBlocked) {
      setLiveStrokePoints(null);
      return;
    }
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

  // Report our own strokes upward (so App.jsx can answer a peer's
  // strokes_request with the current set) AND push them to the room as
  // an explicit broadcast, which is what any active peeker actually
  // renders from now. Fires on stroke COMPLETION / undo / erase / clear
  // -- i.e. every myStrokes change -- but never per in-progress point,
  // keeping traffic to a handful of messages per round.
  useEffect(() => {
    onStrokesChange && onStrokesChange(myStrokes);
    onBroadcastStrokes && onBroadcastStrokes(myStrokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myStrokes]);

  // HEARTBEAT (v3.23) -- re-announce my current drawing every few
  // seconds while I actually have one. This is the safety net under the
  // peek-join fix: even if a peeker's strokes_request and all its
  // retries were lost, or they joined during a reconnect, their view
  // converges within one heartbeat instead of hanging blank until my
  // next pen stroke. Silent when there's nothing to send (the common
  // case), and each message is one already-decimated snapshot, so the
  // traffic cost is negligible.
  const onBroadcastStrokesRef = React.useRef(onBroadcastStrokes);
  onBroadcastStrokesRef.current = onBroadcastStrokes;
  useEffect(() => {
    const id = setInterval(() => {
      const current = myStrokesRef.current;
      if (current && current.length > 0 && onBroadcastStrokesRef.current) onBroadcastStrokesRef.current(current);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // (v3.27: the peek-draw retry loop lived here -- 1.5s re-sends of any
  // unconfirmed peek-draw, giving up after 8 attempts. Removed with the
  // feature. The two heartbeats above are what remain, and they are a
  // different, much weaker kind of thing: periodic re-announcements of a
  // full snapshot, not per-action delivery tracking.)

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
    // AND push it as an explicit broadcast (v3.24), which is what a
    // peeker actually renders from. Presence still carries the same set
    // for cold starts, but it is no longer the live path -- see the
    // reveal-sync comment up top.
    onBroadcastRevealRef.current && onBroadcastRevealRef.current(Array.from(toggledIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggledIds]);

  // Reveal-set heartbeat, mirroring the strokes heartbeat: re-announce
  // periodically while I actually have something revealed, so a peeker
  // who joined during a blip converges without needing me to click
  // again. Silent (and free) when nothing is revealed.
  const onBroadcastRevealRef = React.useRef(onBroadcastReveal);
  onBroadcastRevealRef.current = onBroadcastReveal;
  const toggledIdsRef = React.useRef(toggledIds);
  toggledIdsRef.current = toggledIds;
  useEffect(() => {
    const id = setInterval(() => {
      const current = toggledIdsRef.current;
      if (current && current.size > 0 && onBroadcastRevealRef.current) onBroadcastRevealRef.current(Array.from(current));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Report our own peek-privacy preference upward the same way -- default
  // ON (matches the old always-visible behavior), but a player can turn
  // it off at any time, which immediately removes them from every
  // teammate's peek list, live.
  useEffect(() => {
    onPeekableChange && onPeekableChange(myPeekable);
    // PRIMARY opt-out mechanism: turning peeking OFF fires an explicit
    // broadcast so anyone currently peeking me is released on the spot,
    // rather than waiting on a Presence state diff to reach them.
    // Turning it back ON needs no broadcast -- nobody is peeking me at
    // that moment by definition, and the Presence payload (which still
    // carries `peekable`) is what re-adds me to everyone's peek list.
    if (!myPeekable && onBroadcastPeekOff) onBroadcastPeekOff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPeekable]);
  const routeExplorerEnabled = useFeatureEnabled("route_explorer_enabled", roomId);
  const drawEnabled = useFeatureEnabled("draw_enabled", roomId);
  const peekEnabled = useFeatureEnabled("peek_enabled", roomId);
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

  // In pass-and-play, myRole is null, so "it's my turn to act" collapses
  // to "it's this device's turn" (== whoever the current actor is, since
  // the device controls everyone). In multiplayer, only the player whose
  // role CONTAINS the relevant seat can act -- myRole can be a
  // comma-joined list for a multi-detective seat (e.g. "d0,d1,d2"), so
  // this must be a membership check, not exact string equality. A third
  // case, isSpectator, means "no role at all, and no permission to act
  // as anyone" -- unlike pass-and-play's myRole===null (which means
  // "this device controls everyone"), a spectator controls nobody.
  const isSpectator = myRole === "__spectator__";
  const myRoleSeats = !isSpectator && myRole ? myRole.split(",") : [];
  const controlsSeat = (seat) => myRole === null || myRoleSeats.includes(seat);
  const iAmMrX = !isSpectator && myRole === "mrx";
  const iAmDetective = !isSpectator && myRole && myRole !== "mrx";
  // myOwnDetectives: EVERY detective this player controls, regardless of
  // the current phase -- used by the route explorer (available anytime
  // during the buffer, per project design) AND by the acting-phase
  // detective-selection logic below. Pass-and-play (myRole===null) has
  // no real "own detective" concept here since the device controls
  // everyone.
  const myOwnDetectives =
    iAmDetective && myRoleSeats.length > 0
      ? match.detectives.filter((d) => myRoleSeats.includes(`d${d.id}`))
      : [];

  // ---------------------------------------------------------------------
  // TURN MODEL -- pass-and-play (single shared device) stays fully
  // sequential, walking match.turnOrder/turnIdx exactly as it always has
  // (see gameEngine.js/localGameStore.js, UNCHANGED -- simultaneous
  // action makes no sense on one shared device anyway). Multiplayer now
  // runs the 3-phase model instead (mrx -> planning -> acting), read off
  // match.roundPhase (see matchStateAdapter.js).
  //
  // ACTING PHASE, v3.21 -- SEQUENTIAL PER-PLAYER SUB-TURNS. The phase
  // itself is still simultaneous ACROSS players: everyone's sequence
  // runs concurrently, nobody waits on anybody else. But WITHIN one
  // player, their own detectives now act one at a time, in fixed
  // ascending seat order. This replaces the old tap-a-piece-to-arm-it
  // model entirely: there is exactly one "current" detective for me at
  // any moment -- the lowest-id own detective not yet in
  // match.detectivesActed -- and it advances automatically the instant
  // that one moves or passes. No extra server state is needed for this;
  // detectives_acted already carries everything required.
  // ---------------------------------------------------------------------
  const isPassAndPlay = myRole === null;
  const roundPhaseMp = !isPassAndPlay ? match.roundPhase : null;
  const detectivesActedSet = new Set((match.detectivesActed || []).map(Number));
  // myUnactedDetectiveIds -- my own detectives still to act this round,
  // ascending. The FIRST of these is whose sub-turn it currently is.
  const myUnactedDetectiveIds =
    !isPassAndPlay && iAmDetective && roundPhaseMp === "acting"
      ? myOwnDetectives
          .map((d) => d.id)
          .filter((id) => !detectivesActedSet.has(id))
          .sort((a, b) => a - b)
      : [];
  const myCurrentActingDetId = myUnactedDetectiveIds.length > 0 ? myUnactedDetectiveIds[0] : null;
  // Sub-turn progress, for the "detective X of Y" readout near the timer.
  // Y counts every detective I control; X is however many I've finished
  // plus the one in progress (capped at Y once I'm completely done).
  const myTotalDetectiveCount = myOwnDetectives.length;
  const myActedDetectiveCount = myOwnDetectives.filter((d) => detectivesActedSet.has(d.id)).length;
  const mySubTurnIndex = Math.min(myActedDetectiveCount + (myCurrentActingDetId != null ? 1 : 0), myTotalDetectiveCount);

  const actor = isPassAndPlay ? currentActor(match) : roundPhaseMp === "mrx" ? "mrx" : null;
  const isMrXTurn = isPassAndPlay ? actor === "mrx" : roundPhaseMp === "mrx";
  // activeDetective: pass-and-play keeps its old meaning (whoever's turn
  // it literally is, per turnOrder). Multiplayer now resolves to MY OWN
  // current sub-turn detective -- no selection step, it just IS the next
  // one in my sequence. Every downstream consumer (legalTargets, the
  // turn-indicator ring, the origin/destination rings, the Pass button)
  // keeps working completely unmodified, because both cases still mean
  // exactly "the one piece that's currently valid to click and move" --
  // which is precisely why the automatic origin + full-destination
  // display asked for here needs no new rendering code at all: it's the
  // same isLegal/isCurrentTurnStation path pass-and-play has always used,
  // just pointed at a different detective.
  const activeDetective = isPassAndPlay
    ? actor && actor !== "mrx"
      ? match.detectives[parseInt(actor.slice(1), 10)]
      : null
    : myCurrentActingDetId != null
      ? match.detectives.find((d) => d.id === myCurrentActingDetId)
      : null;

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
  }, [actor, activeDetective?.id, match.round]);

  // (The old "clear stale acting selection on phase change" effect is
  // gone with selectedActingDetId itself -- the current sub-turn is
  // derived fresh from match.detectivesActed every render, so there is no
  // stored selection that could ever go stale.)

  // Destination toggles are per-round exploration, not a durable
  // preference: clear them when the round changes so last round's fan of
  // revealed destinations doesn't linger over a board where every piece
  // has since moved. Pass-and-play is excluded -- its toggles are seeded
  // to "all detectives" by design and are meant to stay that way.
  useEffect(() => {
    if (isPassAndPlay) return;
    setToggledIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.round, isPassAndPlay]);

  const isMyTurnToAct = isPassAndPlay ? !isSpectator && controlsSeat(actor) : isMrXTurn ? iAmMrX : !!activeDetective;
  // myDetective is "whichever of my detectives is currently the relevant
  // one to act with" -- pass-and-play: whoever's turn it literally is;
  // multiplayer: whichever own detective I've selected (see activeDetective
  // above -- already guaranteed to be mine by construction in both cases).
  const myDetective = iAmDetective && activeDetective ? activeDetective : null;

  // ---------------------------------------------------------------------
  // ACTING-PHASE TIMING, v3.24 -- ONE POOL, NO SUB-CLOCK.
  //
  // What was here before (v3.22/v3.23) was a second, per-DETECTIVE hard
  // cap: each of your detectives got its own countdown inside the pooled
  // window, and when that countdown hit zero the detective auto-passed on
  // the spot. It has been removed entirely, by explicit decision. The
  // acting phase now works like this:
  //
  //   - Each player has ONE budget: the shared pooled acting window
  //     (still sized off the busiest player's detective count via
  //     extra_detective_seconds -- see actingWindowSeconds; that sizing
  //     logic is deliberately unchanged).
  //   - The spotlighted detective advances ONLY when the player actually
  //     moves it or explicitly passes it. Nothing advances on a timer.
  //     A player is free to spend the whole pool on one detective if
  //     that's the call they want to make.
  //   - If the pool runs out with detectives still unmoved, those
  //     detectives do NOT move, get relocated, or act randomly. They
  //     stay exactly where they are and each forfeits ONE ticket, taken
  //     from the cheapest type they still hold (taxi -> bus ->
  //     underground). A detective with none of any type simply pays
  //     nothing. That penalty is applied SERVER-SIDE inside
  //     force_end_acting_phase, so it is authoritative and identical for
  //     every client regardless of who's timer fired first.
  //
  // The one automatic advance that DOES remain is a different thing
  // entirely and is not time-based: a detective with literally zero
  // legal moves auto-passes the instant it's spotlighted (see the
  // no-legal-moves effect below), because sitting there waiting for a
  // click that cannot accomplish anything is just a stall.
  // ---------------------------------------------------------------------
  const onPassDetectiveTurnRef = React.useRef(onPassDetectiveTurn);
  onPassDetectiveTurnRef.current = onPassDetectiveTurn;

  // PENDING PLAYERS (v3.24) -- who still has detectives left to move in
  // the acting phase, as "<name> (<acted>/<total>)". Built live from
  // match.detectivesActed and the room's detective roster, so it updates
  // the moment anyone acts. Only players with at least one UNACTED
  // detective appear. Detective-perspective only (Mr.X and spectators
  // never see it -- they keep the neutral team-level label).
  const pendingActingPlayers =
    !isPassAndPlay && roundPhaseMp === "acting"
      ? detectivePlayersRoster
          .map((p) => {
            const total = (p.detectiveIds || []).length;
            const acted = (p.detectiveIds || []).filter((id) => detectivesActedSet.has(id)).length;
            return { playerId: p.playerId, name: p.playerDisplayName || p.displayName || "Player", acted, total };
          })
          .filter((p) => p.total > 0 && p.acted < p.total)
      : [];

  // "Priya (2/3) and Arjun (1/2) are yet to move" -- Oxford-comma-free
  // natural list, since it's read as a sentence, not scanned as data.
  const pendingActingLabel = (() => {
    if (pendingActingPlayers.length === 0) return null;
    const parts = pendingActingPlayers.map((p) => `${p.name} (${p.acted}/${p.total})`);
    const joined =
      parts.length === 1
        ? parts[0]
        : parts.length === 2
          ? `${parts[0]} and ${parts[1]}`
          : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `${joined} ${parts.length === 1 ? "is" : "are"} yet to move`;
  })();

  // PASS-AND-PLAY ONLY seeding (v3.21). This used to also seed a
  // multiplayer player's own detectives into toggledIds, which is what
  // made "shown by default" work back when toggledIds drove BOTH origins
  // and destinations. It no longer does: during planning, every
  // detective's origin renders unconditionally (planningOriginIds below,
  // not gated on any toggle or on the route_explorer flag), and
  // toggledIds now means only "whose destinations have I explicitly
  // asked to see." Seeding it in multiplayer would therefore dump my own
  // detectives' full destination fans onto the board before I asked for
  // them, which is exactly the seeding behavior this rework removes.
  // Pass-and-play is untouched and still seeds every detective.
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.detectives.length, myRole]);

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
      // v3.22: a station a detective is standing on is NOT a legal Mr.X
      // destination anymore (it used to be legal and instantly lost the
      // game -- one misclick could throw a whole match). Enforced
      // authoritatively in the make_mrx_move RPC; filtered here so an
      // occupied station never even renders as reachable. Multiplayer
      // only -- pass-and-play (myRole === null) keeps its original rules
      // completely untouched, per the standing constraint on that mode.
      const mrxMoves = validMovesFor(map, match.mrX.pos, match.mrX.tickets, true);
      return new Set(
        (isPassAndPlay ? mrxMoves : mrxMoves.filter((m) => !occupiedByDetective(match.detectives, m.to))).map((m) => m.to)
      );
    }
    if (activeDetective) {
      // No controlsSeat(actor) check needed here anymore -- activeDetective
      // is already guaranteed to be MINE by construction in both modes
      // (pass-and-play: whoever's turn it is on the one shared device;
      // multiplayer: only ever set to one of my own selected, not-yet-
      // acted detectives -- see its definition above).
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
  }, [isMyTurnToAct, isMrXTurn, activeDetective, match, map, myRole]);

  // ---------------------------------------------------------------------
  // AUTO-PASS A DETECTIVE WITH NO LEGAL MOVES (v3.24)
  //
  // The moment one of my detectives becomes the spotlighted one, if it
  // has literally nowhere legal to go -- out of every ticket type it
  // would need, or every reachable station already occupied -- there is
  // no click that can accomplish anything. Waiting for the player to
  // find and press "Skip" just burns their pooled time for no decision.
  // So it passes itself, through the SAME pass_detective_turn RPC the
  // manual button calls, and the spotlight advances to their next
  // unacted detective (or their sequence ends).
  //
  // NOTE this is emphatically NOT the timeout case. A timeout leaves the
  // detective in place and costs it a ticket (server-side, see
  // force_end_acting_phase). A no-legal-moves auto-pass costs nothing --
  // it's an ordinary pass that the player simply didn't have to click.
  //
  // Multiplayer + detective-perspective + acting phase only. Pass-and-
  // play is untouched (it keeps its manual "no legal moves" button).
  // The server can't independently verify "no legal moves" -- it has no
  // knowledge of the map graph at all (see useTurnTimer's architectural
  // note) -- but it doesn't need to: a pass is unconditionally legal for
  // a detective that hasn't acted yet, so nothing here can produce a
  // state the server would refuse, and a client can never get stuck.
  //
  // v3.28 -- ZERO TICKETS OF EVERY TYPE. A piece holding literally no
  // chargeable ticket can neither move (every edge costs a fare) nor pay
  // to stay, so there is no action of any kind available to it. This is
  // NOT a second, competing auto-pass mechanism: for a DETECTIVE it is
  // already a strict subset of "no legal moves" (validMovesFor is
  // ticket-aware, so zero tickets always yields an empty legalTargets),
  // and it therefore flows through the exact same autoPassKey and the
  // same fired-once ref below -- there is nothing that can double-fire.
  // It is spelled out separately only because it also has to cover the
  // one case the detective path never did: MR.X, who up to now was shown
  // a manual "Pass Turn" button instead. His free-pass button is
  // deliberately LEFT IN PLACE for the different case of "boxed in but
  // still holding tickets" -- that is a real decision he may want a
  // moment over, and auto-firing it would be a behavior regression.
  // Nothing is deducted on either path: there is nothing to deduct.
  const hasNoChargeableTicket = (tickets) => !tickets || STAY_TICKET_ORDER.every((m) => (tickets[m] || 0) <= 0);
  const noMoveAutoPassedRef = React.useRef(null);
  const autoPassKey =
    !isPassAndPlay && iAmDetective && actingActive && activeDetective && legalTargets.size === 0
      ? `${match.round}|${activeDetective.id}`
      : null;
  useEffect(() => {
    if (!autoPassKey) return;
    if (noMoveAutoPassedRef.current === autoPassKey) return;
    noMoveAutoPassedRef.current = autoPassKey; // mark BEFORE calling, so a re-render can't double-fire
    const detId = parseInt(autoPassKey.split("|")[1], 10);
    if (onPassDetectiveTurnRef.current) onPassDetectiveTurnRef.current(detId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPassKey]);

  // Mr.X's own zero-tickets auto-pass. Separate ref and key from the
  // detective one above because the two can never be true for the same
  // client at the same time (a client is one role), so they can never
  // race each other; keeping them apart just makes each one's "fire
  // exactly once per round" bookkeeping independent and obvious.
  const mrxAutoPassedRef = React.useRef(null);
  const mrxZeroTicketAutoPassKey =
    !isPassAndPlay && iAmMrX && isMrXTurn && isMyTurnToAct && !pendingMove && hasNoChargeableTicket(match.mrX?.tickets)
      ? `mrx|${match.round}|${match.mrX?.travelLog?.length ?? 0}`
      : null;
  useEffect(() => {
    if (!mrxZeroTicketAutoPassKey) return;
    if (mrxAutoPassedRef.current === mrxZeroTicketAutoPassKey) return;
    mrxAutoPassedRef.current = mrxZeroTicketAutoPassKey;
    if (onPassMrxTurn) onPassMrxTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mrxZeroTicketAutoPassKey]);

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
  // for THIS client to see at all. Real design fix, per explicit request:
  // the multi-detective explorer (own detectives shown by default, click
  // any piece to toggle any other detective's highlight too) is now ONLY
  // available during the shared pre-think buffer -- the "team is thinking
  // together" moment it was actually built for. Once an individual act
  // window starts (preThinkActive false, some specific detective's own
  // turn to actually move), this reverts to the ORIGINAL, simpler
  // behavior: only the ACTIVE detective's own legal-move ring and turn
  // indicator show (isLegal / isCurrentTurnStation, both computed
  // independently of this flag, further down) -- no exploring any other
  // detective's origin/destination while someone's actually mid-move.
  // Pass-and-play has no buffer phase at all (preThinkActive is never
  // wired for it), so this correctly keeps the explorer off there too,
  // falling back to the same plain active-detective ring it always had.
  const showDetectiveHighlights = preThinkActive && (iAmDetective || isSpectator || myRole === null);

  // If the peeked player turns their privacy toggle off WHILE being
  // peeked, this immediately stops surfacing their data (presenceState
  // updates live) -- no separate "kick out the peeker" step needed.
  const peekedPlayerIsPeekable = presenceState[peekedPlayerId]?.peekable !== false;

  // strokesToRender: whichever board is actually "in view" right now --
  // your own strokes normally, or the peeked player's live strokes while
  // peeking (never both, since you're looking at one board at a time).
  // The peeked set comes from broadcast-delivered state (peekedStrokes),
  // NOT from their Presence payload as it used to -- see usePresence.js.
  // peekedStrokesOwnerId must match, so a set that arrived for a
  // previously-peeked player can't leak onto the new one.
  const strokesToRender = peekedPlayerId
    ? peekedPlayerIsPeekable && peekedStrokesOwnerId === peekedPlayerId
      ? peekedStrokes
      : []
    : myStrokes;

  // ---------------------------------------------------------------------
  // v3.30 -- PLANNING VIEW FILTER, ACTUALLY EFFECTIVE.
  //
  // planningScopeActive is the single source of truth for "the personal
  // 'My detectives' filter is switched on AND currently applicable". It is
  // used in three places now, where v3.28 used it in only one:
  //   1. planningOriginIds (default origin indicators) -- as before;
  //   2. highlightedDetectiveIds -- NEW. Previously, any teammate whose
  //      destinations you had explicitly clicked open stayed fully
  //      highlighted after switching to "My detectives", because that set
  //      was never filtered. Switching to "My detectives" while looking at
  //      a cluttered board therefore did visibly nothing, which is the
  //      reported symptom;
  //   3. the token dimming below -- NEW. Under a room configured with
  //      position_highlight_style = "blink" (which is this project's
  //      default, and what the live rooms are actually set to), the ONLY
  //      rendered difference between an in-scope and an out-of-scope
  //      detective was whether its node blinked -- no ring is drawn at all
  //      in that style (see the `highlightPositionStyle !== "blink"`
  //      guards in the station render). Filtering therefore produced a
  //      change that was essentially invisible. Out-of-scope detectives are
  //      now also visibly de-emphasised, so the filter reads the same way
  //      in every configured highlight style.
  // Still purely personal and purely client-side: nothing here is
  // broadcast, persisted, or allowed to affect what is legal.
  // ---------------------------------------------------------------------
  const planningScopeActive =
    !isPassAndPlay && iAmDetective && !peekedPlayerId && roundPhaseMp === "planning" && planningOriginScope === "mine";
  const isOutOfPlanningScope = (detId) => planningScopeActive && !myOwnDetectives.some((d) => d.id === detId);

  // The set of detectives currently highlighted on THIS client's board:
  // your own full toggled set normally, or -- while peeking -- EXACTLY
  // the peeked player's toggled set, REPLACING yours rather than merging
  // with it. This is "look at their screen," not "look at both at once"
  // -- merging was the source of the reported visual clutter (your own
  // highlights stacking on top of theirs with no way to tell them apart).
  const highlightedDetectiveIds = !showDetectiveHighlights
    ? new Set()
    : peekedPlayerId
      ? // v3.24: prefer the BROADCAST reveal snapshot for this exact
        // player when we have one -- that's the live path, arriving
        // within a frame or two of their click. The Presence payload
        // (toggledDetectiveIds) is the next fallback, for a peek that
        // starts before any broadcast has been seen.
        //
        // v3.27 -- THE "PEEK SHOWS NOTHING" FIX. Both of those sources
        // are NETWORK-DELIVERED, and when neither had arrived yet this
        // fell through to an empty set: a peeker who started a peek got
        // a completely bare board -- no rings, no destinations, nothing
        // -- and had no way to tell "they genuinely have nothing
        // revealed" apart from "their state hasn't reached me." That is
        // exactly the reported "peeking doesn't even show their board."
        //
        // Now the final fallback is DERIVED, not delivered: the peeked
        // player's OWN detectives, straight out of the roster this
        // client already has. That is precisely what their board shows
        // by default (their own detectives are seeded on, see
        // seededOwnRef), so a cold peek renders their real default view
        // on the first frame with zero network dependency, and the
        // broadcast snapshot simply refines it the moment it lands.
        new Set(
          !peekedPlayerIsPeekable
            ? []
            : peekedRevealOwnerId === peekedPlayerId && peekedRevealIds
              ? peekedRevealIds
              : presenceState[peekedPlayerId]?.toggledDetectiveIds?.length
                ? presenceState[peekedPlayerId].toggledDetectiveIds
                : detectivePlayersRoster.find((p) => p.playerId === peekedPlayerId)?.detectiveIds || []
        )
      : // v3.30 -- the planning-phase view filter now applies HERE too, not
        // only to the default origins below. See planningScopeActive.
        planningScopeActive
        ? new Set([...toggledIds].filter((id) => myOwnDetectives.some((d) => d.id === id)))
        : toggledIds;

  // ---------------------------------------------------------------------
  // PLANNING-PHASE DEFAULT ORIGINS (v3.21). During the shared planning
  // window, EVERY detective's current position gets a position-style
  // indicator, unconditionally -- not just your own, and not dependent on
  // anything having been toggled on. Detective positions are fully public
  // information in this game, so there is nothing to gate here; the point
  // is simply that the team can see the whole board's state while
  // planning together without anyone having to click anything.
  //
  // Deliberately NOT gated on routeExplorerEnabled: that admin toggle
  // governs seeing OTHER players' derived information (their reachable
  // destinations), not positions that are already visible as tokens.
  // Clicking a piece to reveal its DESTINATIONS is what the toggle gates,
  // and that check lives in handleStationClick, unchanged.
  //
  // Multiplayer only, and only for a detective-perspective viewer.
  // Pass-and-play never enters this branch (isPassAndPlay short-circuits),
  // so its behavior is completely untouched.
  //
  // v3.28: narrowed by the personal planningOriginScope filter above.
  // "mine" restricts it to the detectives THIS client actually controls
  // -- which for a spectator is nobody, so the filter is offered only to
  // an actual detective player and a spectator always sees "all".
  const planningOriginIds =
    !isPassAndPlay && roundPhaseMp === "planning" && (iAmDetective || isSpectator)
      ? new Set((planningScopeActive ? myOwnDetectives : match.detectives).map((d) => d.id))
      : new Set();

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
    // -----------------------------------------------------------------
    // STAY HERE (v3.25) -- clicking the station YOU ARE ALREADY STANDING
    // ON, during your own turn, opens the SAME move-confirmation popup a
    // real destination does, offering "Stay Here" instead of a travel
    // option. This replaces the old standalone skip/pass button for the
    // voluntary case: staying put is a move-shaped decision, so it's
    // made with the same gesture (tap a station -> confirm/cancel) as
    // every other move, in the same place on screen.
    //
    // MULTIPLAYER ONLY, and checked BEFORE the route-explorer branch
    // below, since your own spotlighted piece's station would otherwise
    // be swallowed by the highlight toggle. Pass-and-play (myRole ===
    // null) is deliberately excluded entirely and keeps its own existing
    // controls, per the standing constraint on that mode.
    // -----------------------------------------------------------------
    if (!isPassAndPlay && isMyTurnToAct && !preThinkActive) {
      const myStation = isMrXTurn ? match.mrX.pos : activeDetective ? activeDetective.pos : null;
      if (myStation != null && station === myStation) {
        setPendingMove({ to: station, stay: true, availableModes: [] });
        setMessage("");
        return;
      }
    }
    // (v3.21: the tap-to-arm branch that used to sit here is gone. During
    // the acting phase there is nothing to select -- your current
    // sub-turn detective is determined automatically, and its origin and
    // full legal-destination set are already displayed. Clicking your own
    // piece is now a no-op rather than a selection toggle.)
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
    if (!isMyTurnToAct) return;
    // Pre-think buffer: nobody may COMMIT a move yet, even the seat whose
    // turn it technically now is -- the whole point of the buffer is a
    // shared deliberation window before the act window starts. The
    // route explorer above is untouched by this check.
    if (preThinkActive) return;
    if (isMrXTurn) {
      if (myRole !== null && myRole !== "mrx") return; // multiplayer: not your role
      // v3.22: hard stop before anything else -- Mr.X cannot move onto a
      // detective-occupied station at all now. Rejected here so the
      // player gets a clear reason rather than a silent no-op, and again
      // server-side in make_mrx_move (the authority). Pass-and-play keeps
      // its original "legal but loses the game" behavior, untouched.
      if (!isPassAndPlay && occupiedByDetective(match.detectives, station)) {
        setPendingMove(null);
        setMessage(`${stationLabel(station)} is occupied by a detective — ${mrxName()} can't move there.`);
        return;
      }
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
      // No controlsSeat(actor) check needed here anymore -- activeDetective
      // (== d below) is already guaranteed to be mine by construction (see
      // its definition above), in both pass-and-play and multiplayer.
      if (!activeDetective) return;
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
    // No selection to clear anymore -- once the server records this
    // detective in detectives_acted, myCurrentActingDetId automatically
    // advances to my next unacted detective (or null if I'm done).
    onDetectiveMove(detId, to, mode);
  }

  // commitStay (v3.25; symmetric + ticket choice in v3.26) -- confirming
  // the "Stay Here" popup. Two server actions behind one identical
  // gesture, and as of v3.26 they cost the same thing:
  //   Mr.X      -> mrx_stay_here
  //   detective -> pass_detective_turn
  // Both keep the piece where it is and forfeit exactly one ticket. Since
  // this is a DELIBERATE stay, the player names which chargeable type
  // (taxi/bus/underground) to give up -- ticketMode -- picked from the
  // same popup that picks a ticket for an ordinary multi-mode move. A
  // timeout instead passes nothing and the server takes the cheapest held
  // type; a piece holding none of those types pays nothing either way.
  function commitStay(ticketMode) {
    setPendingMove(null);
    setMessage("");
    if (isMrXTurn) {
      if (onMrxStayHere) onMrxStayHere(ticketMode ?? null);
    } else if (activeDetective) {
      if (onPassDetectiveTurn) onPassDetectiveTurn(activeDetective.id, ticketMode ?? null);
    }
  }

  function commitMrXMove(edgeMode, ticketUsed) {
    if (!pendingMove) return;
    const { to } = pendingMove;
    setPendingMove(null);
    setMessage("");
    onMrXMove(to, edgeMode, ticketUsed);
  }

  const isWesteros = map.id === "westeros";

  // ---------------------------------------------------------------------
  // STAY-TALLY WIDGET + BONUS FLASH (v3.28, items 3 and 4)
  //
  // Both are shown to EVERY multiplayer viewer -- detectives, Mr.X and
  // spectators alike. This is deliberate and is NOT the same class of
  // information as the detective-only ready-vote / sub-turn / pending-
  // players UI: those reveal what a specific detective player is doing
  // right now, whereas this is a public game-mechanic counter and a
  // public game-mechanic event. Mr.X obviously has to know what he
  // earned, and the detectives have to be able to see the cost of
  // standing still -- that visible pressure IS the mechanic.
  //
  // Everything is derived from the room's configured X/Y rather than
  // assumed, so a room set to X=2, Y=7 shows "2 stays to a Black
  // ticket", then at 12 correctly shows "2 stays to a 2x card" (14 being
  // the first tally that is a multiple of both). No ratio is implied
  // anywhere.
  const stayTally = !isPassAndPlay ? (match.detectiveStayTally ?? 0) : 0;
  const stayNextBonus = (() => {
    if (isPassAndPlay || !stayThresholds) return null;
    const { x, y } = stayThresholds;
    if (!(x >= 1)) return null;
    for (let t = stayTally + 1; t <= stayTally + 2 * x * y + x; t++) {
      const type = bonusForTally(t, x, y);
      if (type) return { at: t, type, staysAway: t - stayTally };
    }
    return null;
  })();

  // The flash itself. lastStayBonus.seq is the tally value at the moment
  // of the grant, which only ever increases, so comparing it against the
  // last one we showed is enough to tell a genuinely NEW award from the
  // same one re-rendering. Auto-clears after a few seconds ("brief").
  //
  // v3.30 -- THE "FLASH NEVER APPEARS" FIX, and the root cause was this
  // component's own staleness guard, not the server.
  //
  // What was here before ALSO required `lastStayBonus.round === match.round`
  // -- the idea being "don't replay an old celebration to someone who just
  // refreshed". The problem is that a stay which crosses a threshold very
  // often IS the last action of the round: pass_detective_turn writes
  // last_stay_bonus (stamped with the CURRENT round) and then, in the SAME
  // transaction, calls begin_next_round_mrx_internal, which increments
  // `round`. force_end_acting_phase (the timeout path) does the same thing
  // unconditionally. So by the time the single realtime update reaches any
  // client, last_stay_bonus.round is already round-1 and the guard threw
  // the flash away every time. Verified directly against the live database:
  // a room sitting at round 4 with
  // last_stay_bonus = {type: black, tally: 10, round: 3} -- a bonus that
  // no client was ever shown.
  //
  // The replacement does the staleness job properly and without depending
  // on round numbers at all: the FIRST value we ever observe is recorded
  // as a baseline and deliberately NOT flashed (that is the refresh /
  // late-join case), and every change after that is a genuinely new award
  // that happened while we were watching. Same protection, no false
  // negatives.
  const lastStayBonus = !isPassAndPlay ? match.lastStayBonus : null;
  const [flashedBonusSeq, setFlashedBonusSeq] = useState(null);
  const [bonusFlash, setBonusFlash] = useState(null);
  const bonusBaselineRef = React.useRef(false);
  useEffect(() => {
    if (isPassAndPlay) return;
    const seq = lastStayBonus?.seq ?? null;
    // Baseline pass: whatever the state already was when this board
    // mounted is "history", never a celebration. Runs on the first
    // render regardless of whether a bonus exists yet, so a game with
    // no bonus so far still flashes correctly on its very first one.
    if (!bonusBaselineRef.current) {
      bonusBaselineRef.current = true;
      setFlashedBonusSeq(seq);
      return;
    }
    if (seq == null) return;
    if (flashedBonusSeq === seq) return;
    setFlashedBonusSeq(seq);
    setBonusFlash(lastStayBonus);
    const t = setTimeout(() => setBonusFlash(null), 9000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastStayBonus?.seq, isPassAndPlay]);

  const bonusTypeLabel = (t) => (t === "double" ? "2x (double move) card" : "Black ticket");

  return (
    <div style={styles.pagePlaying}>
      <div style={styles.playingLayoutSidebar}>
        <div style={styles.sidebarPermanent}>
          {/* ---------------------------------------------------------
              v3.30 -- NO MENU, NO TABS: EVERYTHING ALWAYS VISIBLE.
              v3.29 put the room code, legend, vote/admin controls,
              rulebook and peek-privacy tick behind a "Room & settings"
              dropdown, and the travel log / chat / peek behind tabs.
              Both are gone by explicit instruction: every one of those
              surfaces is now rendered simultaneously in this panel.

              To keep that from becoming an undifferentiated wall, the
              panel is ordered by how often you need each thing (CSS
              `order` on a flex column, so each block keeps its natural,
              heavily-commented position in source):

                order 0  bonus flash banner      (transient, must be seen)
                order 1  stay tally              (read constantly)
                order 2  everyone's tickets      (read constantly)
                order 3  phase controls: 2x / pass / view filter
                order 5  travel log              (read often)
                order 6  chat                    (read often)
                order 7  peek panel              (occasional, phase-gated)
                order 9  error/message bar       (existing)
                order 10 utility cluster         (rare: room code, legend,
                                                  votes, rulebook, privacy)

              The utility cluster is rendered LAST rather than first: it
              is the only group nothing in a normal round ever needs.
              --------------------------------------------------------- */}
          <div style={styles.utilityCluster}>
            {/* Room code + legend share ONE compact row -- both are
                static reference material, neither justifies its own
                block. */}
            <div style={styles.utilityTopRow}>
              {roomCode && <span style={styles.roomCodeInline}>Code: {roomCode}</span>}
              <div style={styles.legendCompact}>
                {Object.entries(activeMode).map(([key, m]) => (
                  <span key={key} style={styles.legendCompactItem}>
                    <span style={{ ...styles.legendDot, background: m.color }} />
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
            {/* The vote/admin controls injected by App.jsx, clustered as
                one group. Each individual control is still gated by its
                OWN feature flag inside its own component (PauseVote,
                EndGameVote, TakeoverReversalVote, RedistributeRolesVote
                each call useFeatureEnabled) -- this container never
                overrides that, it only decides where they sit. */}
            {(extraHeaderContent || extraHeaderContentBelow) && (
              <div style={styles.utilityVotes}>
                {extraHeaderContent && <div style={styles.roomMenuRow}>{extraHeaderContent}</div>}
                {extraHeaderContentBelow}
              </div>
            )}
            {/* Peek privacy preference -- a durable, set-once setting,
                but now always visible rather than buried in a menu. */}
            {iAmDetective && peekEnabled && (
              <label style={styles.peekToggleRow}>
                <input type="checkbox" checked={myPeekable} onChange={(e) => setMyPeekable(e.target.checked)} />
                Let teammates peek into my screen
              </label>
            )}
          </div>

          {/* Keyframes for the bonus flash. Declared here, next to its
              only consumer, rather than in a global stylesheet -- this is
              the only animated HTML element in the whole board (every
              other animation on screen is SVG, handled inside
              HighlightRing), so a global rule would be one more
              action-at-a-distance for no benefit. */}
          <style>{`
            @keyframes htStayBonusFlash {
              0%, 100% { background: #fff5d6; border-color: #e0b436; }
              50%      { background: #ffe9a8; border-color: #b8860b; }
            }
          `}</style>

          {/* BONUS FLASH (v3.28 item 4). Visible to detectives, Mr.X and
              spectators -- see the long note above the state that drives
              it for why this is deliberately NOT gated the way the
              detective-only ready-vote UI is. */}
          {bonusFlash && (
            <div style={styles.stayBonusFlash} role="status">
              🎟️ {mrxName()} gained a {bonusTypeLabel(bonusFlash.type)} from the team's stays
              {typeof bonusFlash.tally === "number" ? ` (stay #${bonusFlash.tally})` : ""}.
            </div>
          )}

          {/* STAY-TALLY WIDGET (v3.28 item 3). Compact, and slotted into
              the EXISTING sidebar structure on purpose -- the full
              layout reorganization is explicitly a separate piece of
              work, so this does not move anything that was already
              here. Same audience as the flash above. */}
          {!isPassAndPlay && stayThresholds && (
            <div style={styles.stayTallyPanel}>
              <div style={styles.stayTallyHead}>
                <span style={styles.stayTallyLabel}>Team stays</span>
                <span style={styles.stayTallyCount}>{stayTally}</span>
              </div>
              {stayNextBonus ? (
                <>
                  <div style={styles.stayTallyNext}>
                    {stayNextBonus.staysAway} more {stayNextBonus.staysAway === 1 ? "stay" : "stays"} → {mrxName()} gets a{" "}
                    <strong>{bonusTypeLabel(stayNextBonus.type)}</strong>
                  </div>
                  {/* Progress toward the NEXT award specifically, not
                      toward some fixed X -- with independent X and Y the
                      gap between consecutive awards is not constant, so
                      the bar is measured against this award's own gap. */}
                  <div style={styles.stayTallyBarOuter}>
                    <div
                      style={{
                        ...styles.stayTallyBarInner,
                        width: `${Math.max(4, Math.round(((stayThresholds.x - stayNextBonus.staysAway) / stayThresholds.x) * 100))}%`,
                        background: stayNextBonus.type === "double" ? "#8e44ad" : "#1a1a1a",
                      }}
                    />
                  </div>
                </>
              ) : (
                <div style={styles.stayTallyNext}>No further rewards configured.</div>
              )}
            </div>
          )}

          {/* THE 2x BUTTON stays out here, NOT in the room menu. It is a
              move-shaped decision Mr.X takes on his own turn, in the few
              seconds he has to take it -- exactly the kind of thing the
              reorganization is meant to keep immediately reachable. It
              also now appears alone on its row (the vote/admin buttons
              that used to share it have moved into the menu), so the
              wrapping problem that row used to have is gone with them. */}
          {isMrXTurn && isMyTurnToAct && !pendingMove ? (
            <div style={{ order: 3, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
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
            </div>
          ) : null}

          {/* (v3.29: extraHeaderContent and extraHeaderContentBelow --
              the pause / end-game / takeover-reversal / redistribute
              votes and the rulebook button -- are no longer rendered
              here. They are room-level administrative controls, needed
              rarely and never urgently, and they now live inside the
              always-visible utility cluster at the bottom of this
              panel.) */}

          {/* Route explorer v2: no separate mode-picker control anymore --
              your own detectives' reachable stations are shown by default
              (seeded once, then fully toggle-controlled -- clicking any
              detective's token, including your own, turns its highlight
              on/off). This short hint replaces the old control row, so
              the mechanic is still discoverable without cluttering the
              sidebar with buttons. */}
          {/* PLANNING-PHASE VIEW FILTER (v3.28 item 5). Sits directly
              with the other highlight controls, since that is exactly
              what it is. Purely personal and purely client-side -- see
              planningOriginScope's declaration. Offered only to a
              detective player, only during the planning phase (the only
              time default origins are drawn at all), and only when there
              IS someone else to filter out; a solo-seat player would just
              get a control with no observable effect. */}
          {!isPassAndPlay &&
            iAmDetective &&
            roundPhaseMp === "planning" &&
            match.detectives.some((d) => !myOwnDetectives.some((md) => md.id === d.id)) && (
              <div style={styles.viewFilterRow}>
                <span style={styles.viewFilterLabel}>Show positions for:</span>
                {[
                  { key: "all", label: "All detectives" },
                  { key: "mine", label: "My detectives" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    style={{
                      ...styles.viewFilterBtn,
                      ...(planningOriginScope === opt.key ? styles.viewFilterBtnActive : {}),
                    }}
                    onClick={() => setPlanningOriginScope(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

          {iAmDetective && preThinkActive && routeExplorerEnabled && match.detectives.some((d) => !myOwnDetectives.some((md) => md.id === d.id)) && (
            <div style={styles.exploreHint}>💡 Click any teammate's piece on the map to see their reachable stations too.</div>
          )}

          {/* (v3.29: the peek LIST, the peek privacy toggle, the drawing
              toolbar and the view-only peek hint no longer live here.
              Each was a permanent sidebar entry that only mattered
              during one specific phase or mode:
                - the peek list is a per-round activity and is now the
                  "Peek" tab of the tabbed section below;
                - the privacy toggle is a set-once preference and is now
                  in the utility cluster at the bottom of the panel;
                - the drawing toolbar and the peek hint are anchored over
                  the map itself, appearing only while drawing is
                  actually available -- the thing they act on IS the map,
                  so putting them next to it removes the eye-travel the
                  sidebar placement forced on every stroke.) */}

          {/* NO-LEGAL-MOVES PASS. v3.25 narrowed this to the only two
              cases that still need a button:
                - pass-and-play, which is untouched by the new click-your-
                  own-station "Stay Here" flow entirely (that flow is
                  multiplayer-only, by standing constraint), and
                - multiplayer Mr.X with genuinely zero legal moves, which
                  is a materially DIFFERENT action from staying put: this
                  pass is free, whereas Stay Here forfeits a ticket. He
                  shouldn't be charged for a position he can't move out
                  of, so the free escape hatch stays.
              Multiplayer DETECTIVES no longer see it at all: a detective
              with no legal moves is already auto-passed (see the
              auto-pass effect above), and a detective who simply doesn't
              want to move now clicks their own station instead -- which
              is what removed the standalone skip button below.

              Original note, still true: this sat at the very BOTTOM of
              the sidebar, after chat -- the last thing in the whole
              panel) per explicit request: it's a genuinely urgent,
              time-sensitive action (you're stuck and need to act to keep
              the game moving), not something that belongs buried below
              read-only information like the travel log or chat. Grouped
              with the other action controls (2x/Pause/End-Game,
              Takeover, explore-mode) rather than left at the bottom. */}
          {isMyTurnToAct && !pendingMove && legalTargets.size === 0 && (isPassAndPlay || isMrXTurn) && (
            <div style={{ ...styles.rowCenter, order: 4 }}>
              <div style={styles.passTurnNote}>
                No legal moves available from your current station with your remaining tickets.
                {autoPassKey ? " Passing automatically…" : ""}
              </div>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  if (isPassAndPlay) {
                    if (onPassTurn) onPassTurn(actor);
                  } else if (isMrXTurn) {
                    if (onPassMrxTurn) onPassMrxTurn();
                  } else if (activeDetective) {
                    if (onPassDetectiveTurn) onPassDetectiveTurn(activeDetective.id);
                  }
                }}
              >
                Pass Turn
              </button>
            </div>
          )}

          {/* (v3.29: the ready-to-act tick has moved out of the sidebar
              and is anchored over the map instead -- see the contextual
              toolbar there. It only exists during the planning phase, so
              a permanent slot in a panel that is on screen for the whole
              game was the wrong home for it; it now appears exactly when
              it is actionable, next to the board the decision is being
              made about. It is still detective-only and still purely a
              tally the SERVER decides on -- neither of those changed.) */}

          {/* (v3.25) The standalone "Skip <detective>'s move" button that
              used to live here is GONE. Voluntarily staying put is now
              expressed the same way every other move is: tap the station
              the piece is standing on and confirm in the move popup (see
              the STAY HERE branch in handleStationClick). Same underlying
              pass_detective_turn RPC, same effect -- just no longer a
              separate control detached from the board. */}

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

          {/* -----------------------------------------------------------
              v3.29 TABBED LOWER SECTION.
              The travel log, chat and peek list are three READ-mostly
              surfaces that used to be stacked one after another, so the
              panel's total height was the sum of all three whether or not
              you were looking at any of them -- which is what pushed the
              things you actually act on below the fold. They are mutually
              exclusive in practice (you are reading one at a time), so
              they are tabs now.

              Tab availability is derived, not assumed: chat only exists
              when App.jsx passes it (multiplayer), and peek only exists
              for a detective, with peeking enabled, during the planning
              window, with at least one willing teammate. The travel log
              is always there, which is why it is the default.
              ----------------------------------------------------------- */}
          {(() => {
            const peekablePeers = detectivePlayersRoster.filter(
              (p) => p.playerId !== myPlayerId && presenceState[p.playerId]?.peekable !== false
            );
            // v3.30: no tabs. All three surfaces render at once, each
            // with its own flex `order`, in frequency sequence: travel
            // log (5), chat (6), peek (7). The peek panel keeps exactly
            // the same availability rule it had as a tab -- detective,
            // peeking enabled, planning window, at least one willing
            // teammate -- so nothing about who may peek changed.
            const peekAvailable = iAmDetective && peekEnabled && preThinkActive && peekablePeers.length > 0;
            return (
              <>
                {/* Wrapped so it can carry a flex `order` --
                    belowTicketsContent is an opaque node from App.jsx
                    with its own styling, so we cannot set one on it
                    directly. */}
                {belowTicketsContent && <div style={{ order: 6, width: "100%" }}>{belowTicketsContent}</div>}
                {peekAvailable && (
                  <div style={styles.huddlePanel}>
                    <div style={styles.exploreLabel}>Peek into a teammate's screen:</div>
                    {peekablePeers.map((p) => (
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
                    <div style={styles.exploreHint}>
                      👁️ View-only: you watch their board live, you can't draw on it. Whether teammates may peek at YOUR board is the tick at the
                      bottom of this panel.
                    </div>
                  </div>
                )}
                {(
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
                  // v3.25: a round Mr.X spent standing still is recorded
                  // with mode "stay" and is shown as such ON PURPOSE --
                  // never dressed up as an ordinary ticket move. It gets
                  // a muted, dashed, greyed cell with a "—" instead of a
                  // colored ticket letter, so a glance at the log tells
                  // you which rounds he actually travelled.
                  //
                  // v3.26: what the log must NOT say is WHY he stood
                  // still. A deliberate stay and a timed-out one look
                  // identical here -- same cell, same wording -- even
                  // though entry.byTimeout still exists in the data. An
                  // observer of a trail can't tell stillness from
                  // hesitation, and neither can this log.
                  const isStay = !!entry && (entry.mode === "stay" || entry.stayed);
                  return (
                    <div
                      key={moveNum}
                      style={{
                        ...styles.logBoardCell,
                        ...(belongsToRevealRound ? styles.logBoardCellReveal : {}),
                        ...(isFuture ? styles.logBoardCellFuture : {}),
                        ...(isStay ? styles.logBoardCellStay : {}),
                      }}
                      title={
                        entry
                          ? isStay
                            ? `Move ${moveNum} (round ${entry.round}): did not move this round${
                                entry.ticket ? ` — forfeited a ${activeMode[entry.ticket]?.label || entry.ticket} ticket` : ""
                              }${belongsToRevealRound ? " — reveal move" : ""}`
                            : `Move ${moveNum} (round ${entry.round}): ${activeMode[entry.mode]?.label || entry.mode}${belongsToRevealRound ? " — reveal move" : ""}`
                          : `Move ${moveNum}${belongsToRevealRound ? " — reveal move (upcoming)" : ""}: not yet played`
                      }
                    >
                      <div style={styles.logBoardRoundNum}>
                        {moveNum}
                        {entry ? ` · R${entry.round}` : ""}
                      </div>
                      {entry && isStay ? (
                        <div style={styles.logBoardStayTag}>—</div>
                      ) : entry ? (
                        <div
                          style={{
                            ...styles.logBoardModeTag,
                            background: activeMode[entry.mode]?.color || "#ccc",
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
                )}
              </>
            );
          })()}

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
                  {/* -------------------------------------------------
                      v3.30 TOP-BAR HIERARCHY.
                      Four stacked tiers, in strict order of importance,
                      instead of one horizontal row where a round label,
                      a phase label, a pending-players list, a safety-cap
                      line and the timer all competed at the same weight:

                        1. ONE merged primary line: round + phase
                           ("Round 3/4 — Detectives planning"). These are
                           both "where are we right now", so they are one
                           sentence, not two competing labels.
                        2. Personal sub-turn progress ("Your detective
                           1 of 2 — Name"). Detective-perspective only,
                           acting phase only, and REMOVED FROM THE DOM
                           entirely when not applicable rather than
                           rendered empty or faded. Mr.X and spectators
                           never see it -- unchanged gating.
                        3. The timer bar, deliberately the largest and
                           highest-contrast element in the bar.
                        4. The muted trailing line: who is yet to move
                           (detective-only, as before) and the safety-cap
                           backstop, smallest text on the bar.
                      ------------------------------------------------- */}
                  <div style={styles.mapTopBarPrimary}>
                    {!isMrXTurn && activeDetective && <span style={{ ...styles.turnColorDot, background: activeDetective.color }} />}
                    <span style={styles.mapTopBarRound}>Round {match.round}/{match.maxRounds}</span>
                    <span style={styles.mapTopBarDivider}>—</span>
                    <span style={styles.mapTopBarPhase}>
                      {preThinkActive
                        ? "Detectives planning"
                        : !isPassAndPlay && actingActive
                          ? "Detectives moving"
                          : isMrXTurn
                            ? `${mrxName()}'s turn`
                            : activeDetective
                              ? `${detectiveName(activeDetective.id)}'s turn`
                              : "Waiting…"}
                    </span>
                  </div>
                  {!isPassAndPlay && actingActive && iAmDetective && myTotalDetectiveCount > 0 && (
                    <div style={styles.mapTopBarSubTurn}>
                      {activeDetective
                        ? `Your detective ${mySubTurnIndex} of ${myTotalDetectiveCount} — ${detectiveName(activeDetective.id)}`
                        : `All ${myTotalDetectiveCount} of your detectives have acted`}
                    </div>
                  )}
                  {/* Muted trailing line -- smallest, least prominent
                      text on the bar. Detective-perspective only for the
                      pending-players part (Mr.X and spectators must never
                      learn how far along any detective player is --
                      gating unchanged from v3.24); the safety-cap
                      backstop is shown to everyone. */}
                  {((iAmDetective && pendingActingLabel) || safetyCapRemaining != null) && (
                    <div style={styles.mapTopBarFootnote}>
                      {iAmDetective && pendingActingLabel ? <span>{pendingActingLabel}</span> : null}
                      {safetyCapRemaining != null ? <span>Round ends in {safetyCapRemaining}s at the latest</span> : null}
                    </div>
                  )}
                  {/* THE timer (v3.24). With the per-detective cap gone
                      there is exactly one countdown in every phase, so
                      this single branch now serves Mr.X's turn, the
                      planning window AND the acting window identically --
                      same markup, same styles, same flex sizing. That
                      also fixes the acting phase's odd layout: its bar
                      used to be a fixed 90px pill wedged next to the
                      detective name with the rest of the row left empty,
                      which is why it looked so different from the other
                      two. It now fills the row like they do. */}
                  {secondsRemaining != null && (preThinkActive || actingActive || turnTimerSeconds) ? (
                    <div style={styles.mapTopBarTimerWrap}>
                      {(() => {
                        // The bar's denominator changes with the phase --
                        // Mr.X's window, the shared planning window, and
                        // the shared acting window each have their own
                        // (independently configured) total.
                        const denom =
                          timerPhase === "mrx" ? mrxSecondsForBar : timerPhase === "planning" ? bufferSecondsForBar : actSecondsForBar ?? turnTimerSeconds;
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
                  ) : null}
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
                // reachableByDetectiveId above). The active mover's OWN
                // entry is dropped whenever this station is already one
                // of their real legal moves (isLegal, below) -- that ring
                // already shows the exact same information (and more
                // precisely, ticket- and occupancy-checked), so keeping
                // both was pure visual redundancy, not two different
                // facts. NOTE: legalTargets (and therefore isLegal) is
                // NOT itself gated by preThinkActive -- it already
                // previews the upcoming act-window's legal moves during
                // the shared buffer, for whichever seat happens to be
                // acting next. Real bug fix: this dedup used to ALSO
                // require `!preThinkActive`, so during that buffer window
                // the ring rendered (via isLegal) but the overlay wasn't
                // dropped, showing both at once for exactly that first
                // seat to act -- confirmed via direct testing with a
                // 3-detective seat, where only the seat about to act
                // showed the double-highlight (the other two never get a
                // ring at all, since legalTargets only ever reflects
                // whichever single actor's turn it currently is).
                const reachingDetectives = (reachableByDetectiveId.get(numId) || []).filter(
                  (rd) => !(isLegal && activeDetective && rd.detId === activeDetective.id && isMyTurnToAct)
                );
                // Whether THIS station is a highlighted detective's
                // CURRENT position (its "origin" for the explore
                // highlight) -- skipped when it's already the active
                // mover's own turn-indicator station, to avoid drawing
                // two rings on top of each other.
                // Union of two sources: a detective whose destinations
                // I've explicitly toggled on, AND (during planning) every
                // detective by default -- see planningOriginIds. Still
                // skipped when this is already the active mover's own
                // turn-indicator station, to avoid stacking two rings.
                const originDetective =
                  detHere &&
                  (highlightedDetectiveIds.has(detHere.id) || planningOriginIds.has(detHere.id)) &&
                  !(!isMrXTurn && activeDetective && detHere.id === activeDetective.id)
                    ? detHere
                    : null;
                // Acted-this-round detectives are dimmed and inert during
                // the acting phase -- a clear "this one is done" signal
                // that also keeps the board readable once several pieces
                // have moved. Public info (detectives_acted is public), so
                // this is shown to every viewer, not just the controller.
                const isActedThisRound = !isPassAndPlay && roundPhaseMp === "acting" && detHere && detectivesActedSet.has(detHere.id);
                // v3.30: de-emphasise (but never hide, and never make
                // un-clickable) a teammate filtered out by the personal
                // "My detectives" planning view. Positions are public
                // information and this is a decluttering preference, not
                // a rule -- so the piece stays on the board and stays
                // clickable, it just stops competing for attention.
                const isFilteredOutDetective = !!detHere && isOutOfPlanningScope(detHere.id);
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
                  <g
                    key={id}
                    onClick={() => handleStationClick(numId)}
                    style={{
                      cursor: isLegal ? "pointer" : "default",
                      // Dim + fully non-interactive for a detective that
                      // has already acted this round.
                      ...(isActedThisRound ? { opacity: 0.45, pointerEvents: "none" } : {}),
                      ...(isFilteredOutDetective && !isActedThisRound ? { opacity: 0.4 } : {}),
                    }}
                  >
                    <circle cx={x} cy={y} r={2.6 * sizeScale} fill="transparent" />
                    {isLegal && (
                      <HighlightRing x={x} y={y} radius={nodeR + 0.7} color="#1a1a1a" strokeWidth={0.25} dashed style={highlightDestinationStyle} />
                    )}
                    {/* Reachable-destination highlights, all-modes-at-once
                        and ticket-aware -- stacked one ring per
                        currently-highlighted detective that can reach
                        this station, so overlapping sets from different
                        detectives stay distinguishable by color. Per
                        explicit design decision, this now reuses the SAME
                        game-level highlight ring system as every other
                        highlight on the board (highlightDestinationStyle
                        -- ring/rotating/blink/static/none, whatever the
                        room's admin-configured setting is) rather than a
                        separate bespoke filled-circle style -- one
                        consistent highlighting language for the whole
                        board, not two. Each ring is colored to match its
                        own detective (rd.color) instead of a flat black,
                        so overlapping highlights from different
                        detectives stay distinguishable by color, same
                        color-coding already used for origin rings below. */}
                    {reachingDetectives.map((rd, i) => (
                      <HighlightRing key={rd.detId} x={x} y={y} radius={nodeR + 0.7 + i * 0.4} color={rd.color} strokeWidth={0.3} dashed={i > 0} style={highlightDestinationStyle} />
                    ))}
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
                    {/* v3.28 -- THE ORIGIN STATION IS ITSELF A DESTINATION.
                        Since v3.25, clicking the station your own active
                        piece is standing on is a real, ticket-costing
                        action ("Stay Here"), which makes that station a
                        legitimate target of this turn -- but it is not
                        in legalTargets (validMovesFor only ever returns
                        stations you TRAVEL to), so it never got the
                        destination treatment and read as "not a place
                        you can choose."

                        It now renders BOTH indicators, STACKED, not one
                        instead of the other: the position/origin ring
                        below still says "this is where the piece is,"
                        and this destination ring says "and it is one of
                        the things you may pick." Drawn at a different
                        radius from the position ring so the two remain
                        individually legible whatever styles the room has
                        configured, and skipped entirely when the
                        destination style is "none" (an explicit admin
                        choice to have no destination indicator at all,
                        which this must not quietly override).

                        Multiplayer only -- pass-and-play never enters the
                        click-your-own-station stay flow at all, so
                        advertising it there would be a lie. */}
                    {!isPassAndPlay &&
                      isMyTurnToAct &&
                      (isCurrentTurnStation || isMrXOwnTurnIndicator) &&
                      highlightDestinationStyle !== "none" && (
                        <HighlightRing
                          x={x}
                          y={y}
                          radius={nodeR + 0.7}
                          color={isMrXOwnTurnIndicator ? "#1a1a1a" : activeDetective.color}
                          strokeWidth={0.25}
                          dashed
                          style={highlightDestinationStyle}
                        />
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
                      {highlightPositionStyle === "blink" && (isCurrentTurnStation || isMrXOwnTurnIndicator || originDetective) && (
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
              {iAmDetective && drawEnabled && (
                <g style={{ pointerEvents: "none" }}>
                  {/* RECALLED LAST-ROUND LAYER (v3.24) -- painted FIRST,
                      so it sits underneath everything drawn this round,
                      and dimmer/thinner so it reads as background
                      context rather than as part of the live sketch.
                      Only ever your own board: while peeking you're
                      looking at someone else's drawing, and layering
                      your old marks under theirs would be nonsense. */}
                  {!peekedPlayerId &&
                    recalledStrokes.map((s) => (
                      <path
                        key={`recall-${s.id}`}
                        d={pointsToPath(s.points)}
                        fill="none"
                        stroke={styles.strokeColor}
                        strokeWidth={0.28}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.3}
                        strokeDasharray="1.2 0.9"
                      />
                    ))}
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
              // STAY HERE (v3.25; ticket choice v3.26) -- same popup
              // component, same position, same confirm/cancel gesture as
              // a real move. Staying costs one ticket for BOTH roles now,
              // and because this is a deliberate stay the player picks
              // WHICH chargeable type to give up -- one option per type
              // they actually hold, exactly like the ticket picker for an
              // ordinary move that several modes could pay for. If they
              // hold none of taxi/bus/underground there's nothing to take
              // and a single free "Stay Here" option is offered instead,
              // matching the server's "nothing left to deduct" branch.
              if (pendingMove.stay) {
                const stayer = isMrXTurn ? match.mrX : activeDetective;
                if (!stayer) return null;
                // v3.27 -- CONNECTION-RESTRICTED TICKET CHOICE. The
                // options offered are the types the player HOLDS
                // intersected with the types that genuinely have an
                // outgoing connection from the station they're standing
                // on (map.stationModes, a Set built from the map's own
                // edge list in mapSchema.js). Holding a metro ticket at a
                // station no metro line touches is no longer a valid
                // thing to give up.
                //
                // Why this rule exists: with forfeited tickets now going
                // to Mr.X (v3.27), an unrestricted choice let a
                // coordinated team decide exactly which types Mr.X would
                // and wouldn't be fed, independently of anything on the
                // board. The map now constrains that.
                //
                // The server enforces the identical rule in
                // pass_detective_turn / mrx_stay_here and rejects a
                // request that violates it, so this is the honest UI for
                // a rule that holds regardless -- not the rule itself.
                //
                // FALLBACK: a station whose only connections are ferry
                // (westeros #62 is a real example) yields no chargeable
                // type at all. There, rather than offering nothing, we
                // fall back to every held type -- which is exactly what
                // the server's pick_stay_ticket does in the same case.
                const stayStationModes = map.stationModes?.[pendingMove.to];
                const connectedModes = STAY_TICKET_ORDER.filter((m) => stayStationModes?.has(m));
                const heldModes = STAY_TICKET_ORDER.filter((m) => (stayer.tickets?.[m] || 0) > 0);
                const connectedHeld = connectedModes.length > 0 ? heldModes.filter((m) => connectedModes.includes(m)) : heldModes;
                // Second fallback, matching pick_stay_ticket's last
                // resort exactly: they hold tickets, but none of a type
                // that connects here. Something still has to be
                // forfeited (the stay always costs one), so offer what
                // they do hold rather than showing a misleading "nothing
                // to forfeit" and having the server silently charge them
                // a type the UI never mentioned.
                const payableModes = connectedHeld.length > 0 ? connectedHeld : heldModes;
                const who = isMrXTurn ? mrxName() : detectiveName(activeDetective.id);
                // v3.28 -- BLACK TICKET AS STAY FARE, MR.X ONLY.
                //
                // Black is a WILDCARD, so unlike taxi/bus/underground it
                // is deliberately NOT filtered by which modes actually
                // connect to this station. That restriction exists
                // because a fare you could not have travelled on is not a
                // fare -- and a black ticket is not a mode-specific fare
                // at all, which is exactly what makes it a wildcard
                // everywhere else in the game too.
                //
                // Offered ONLY here, on the VOLUNTARY stay path. A
                // timeout stay never names a ticket type, and the
                // server's cheapest-connected-normal fallback never picks
                // black, so a timeout can never silently burn one -- see
                // mrx_stay_internal. Detectives never see this option
                // because they never hold black tickets in the first
                // place; the isMrXTurn guard makes that explicit rather
                // than relying on the ticket count happening to be zero.
                const canPayWithBlack = isMrXTurn && (stayer.tickets?.black || 0) > 0;
                const stayOptions = [
                  ...payableModes.map((mode) => ({
                    key: `stay-${mode}`,
                    label: `Stay — forfeit a ${activeMode[mode].label} ticket`,
                    accent: "#5a5a5a",
                    onClick: () => commitStay(mode),
                  })),
                  ...(canPayWithBlack
                    ? [
                        {
                          key: "stay-black",
                          label: `Stay — forfeit a Black ticket (${stayer.tickets.black})`,
                          accent: "#1a1a1a",
                          onClick: () => commitStay("black"),
                        },
                      ]
                    : []),
                ];
                const stayOptionsFinal =
                  stayOptions.length > 0
                    ? stayOptions
                    : [{ key: "stay", label: "Stay Here", accent: "#5a5a5a", onClick: () => commitStay(null) }];
                return (
                  <MovePopup
                    x={screenPos.x}
                    y={screenPos.y}
                    fallback={screenPos.fallback}
                    openDirection={screenPos.openDirection}
                    title={
                      stayOptions.length > 0
                        ? `${who} stays at ${stationLabel(pendingMove.to)} — choose a ticket to forfeit:`
                        : `${who} stays at ${stationLabel(pendingMove.to)} — no tickets left to forfeit.`
                    }
                    options={stayOptionsFinal}
                    onClose={() => setPendingMove(null)}
                  />
                );
              }
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
            {/* ---------------------------------------------------------
                v3.29 CONTEXTUAL MAP TOOLBAR.
                Anchored over the map, bottom-left, and rendered ONLY when
                one of its members is actually relevant right now. Both
                members act on the map itself -- the ready tick ends the
                planning window you are looking at the map to use, and the
                pen draws on that same map -- so a sidebar home for either
                meant looking in one place and acting in another, every
                round, for the whole game.

                The detective-only gating is UNCHANGED and deliberate:
                Mr.X and spectators never see the ready tick, exactly as
                before. Moving a control does not change who may see it.
                --------------------------------------------------------- */}
            {(() => {
              const showReady = !isPassAndPlay && iAmDetective && preThinkActive;
              const showDraw = iAmDetective && drawEnabled && !peekedPlayerId;
              const showPeekHint = iAmDetective && !!peekedPlayerId;
              if (!showReady && !showDraw && !showPeekHint) return null;
              const readyIds = (match.planningReadyPlayers || []).map(String);
              const iAmReady = myPlayerId != null && readyIds.includes(String(myPlayerId));
              // Denominator: detective-controlling players currently
              // online. A dropped player is excluded for the same reason
              // the server excludes them -- they must not be able to
              // block the vote indefinitely. Falls back to 1 (just me)
              // before roster/presence data has loaded.
              const totalVoters = Math.max(connectedDetectivePlayerIds.length, 1);
              const readyVoters = readyIds.filter((pid) => connectedDetectivePlayerIds.map(String).includes(pid)).length;
              return (
                <div style={styles.mapContextToolbar}>
                  {showReady && (
                    <label style={{ ...styles.mapContextReady, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={iAmReady}
                        onChange={(e) => onSetPlanningReady && onSetPlanningReady(e.target.checked)}
                      />
                      Ready to act ({readyVoters} of {totalVoters})
                    </label>
                  )}
                  {showDraw && (
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
                      {/* "Recall last round" only makes sense as part of
                          the shared thinking moment (bringing back what
                          the team was sketching), not mid-move. Gated to
                          preThinkActive, unchanged from v3.24. */}
                      {preThinkActive && lastRoundStrokes.length > 0 && (
                        <button
                          type="button"
                          style={{ ...styles.drawToolBtn, ...(recalledStrokes.length > 0 ? styles.drawToolBtnActive : {}) }}
                          onClick={recallLastRoundStrokes}
                        >
                          🕓 {recalledStrokes.length > 0 ? "Hide last round" : "Recall last round"}
                        </button>
                      )}
                    </div>
                  )}
                  {showPeekHint && <div style={styles.mapContextHint}>👁️ View-only: watching their board live.</div>}
                </div>
              );
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
    // v3.29: a flex COLUMN, purely so the persistent top strip (ticket
    // counts + stay tally) can be pulled above the phase-gated controls
    // that sit between them in source order, without physically moving
    // three large, heavily-commented JSX blocks around and risking a
    // silent behavioral change in one of them. Only the handful of
    // children that need a specific slot carry an `order`; everything
    // else keeps its natural DOM position.
    display: "flex",
    flexDirection: "column",
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
  // v3.30: a vertical stack rather than a single horizontal row, so the
  // four tiers (round+phase / personal sub-turn / timer / footnote) can
  // carry genuinely different visual weight instead of all being
  // equal-weight text competing side by side. `order` is used so the
  // footnote can sit AFTER the timer while staying next to the label it
  // belongs with in source.
  mapTopBar: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 3,
    background: "#fff",
    borderRadius: 10,
    padding: "7px 14px 8px",
    marginBottom: 8,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    boxSizing: "border-box",
  },
  mapTopBarPrimary: {
    order: 1,
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  mapTopBarPhase: { fontSize: 15.5, fontWeight: 800, color: "#1a1a1a", letterSpacing: -0.2 },
  mapTopBarSubTurn: {
    order: 2,
    fontSize: 12.5,
    fontWeight: 700,
    color: "#5b4636",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  mapTopBarFootnote: {
    order: 4,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 10.5,
    color: "#9a958a",
    lineHeight: 1.3,
  },
  mapTopBarTurn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 15,
    fontWeight: 700,
    whiteSpace: "nowrap",
    // v3.24: allowed to shrink now (it used to be flexShrink: 0). The
    // acting phase can append a long "who's yet to move" list here, and
    // a non-shrinking group would push the timer bar clean off the row
    // in a big game. Shrinking + minWidth:0 lets the label ellipsize
    // instead, which is the right thing to lose.
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  mapTopBarRound: { color: "#888", fontWeight: 600, fontSize: 13 },
  mapTopBarDivider: { color: "#ccc", fontWeight: 400 },
  mapTopBarBufferLabel: { color: "#5b4636", fontWeight: 700 },
  // (v3.24: subTurnCapBar* and mapTopBarRoundPoolNote are gone along with
  // the per-detective cap they styled. Every phase now uses the single
  // shared turnTimerBar* trio, which is what makes the acting-phase bar
  // fill the row the same way the Mr.X and planning bars always did.)
  //
  // "Priya (2/3) and Arjun (1/2) are yet to move" -- secondary, quiet,
  // sits after the turn label and before the timer bar. Allowed to
  // shrink and ellipsize rather than push the timer off the row, since
  // in a big room this string can get long.
  pendingPlayersLabel: {
    marginLeft: 10,
    color: "#8a8375",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  },
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
    // v3.30: tier 3 of the stacked top bar, and deliberately the
    // dominant element -- full width of the bar, a taller track and a
    // larger countdown number than anything else on it.
    order: 3,
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minWidth: 60,
    marginTop: 2,
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
    height: 12, // v3.30: taller -- this is the bar the whole top strip is built around

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
    fontSize: 16,
    fontWeight: 800,
    color: "#3a3a36",
    minWidth: 40,
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
  // v3.29 -- layout reorganization: room menu, tab bar, map-anchored
  // contextual toolbar.
  roomCodeInline: { fontSize: 11.5, color: "#8a8375", fontWeight: 600, letterSpacing: 0.4 },
  roomMenuRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 0 },
  // (v3.30: sidebarTabBar / sidebarTab / sidebarTabActive are unused now
  // that the tabbed section is gone. Kept only as dead style entries
  // would be noise, so they are removed outright.)
  utilityCluster: {
    // The rarely-needed group, rendered LAST in the panel by `order`.
    order: 10,
    marginTop: 14,
    paddingTop: 10,
    borderTop: "1px solid #e2ddcf",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  utilityTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  utilityVotes: { display: "flex", flexDirection: "column", gap: 6 },
  mapContextToolbar: {
    // v3.30: TOP-left of the map, not bottom-left (v3.29). Same
    // floating/contextual behaviour -- it still only exists while one of
    // its members is actually relevant -- just anchored to the corner
    // the eye starts from.
    position: "absolute",
    left: 10,
    top: 10,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-start",
    zIndex: 5,
  },
  mapContextReady: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.94)",
    border: "1px solid #d7d2c4",
    borderRadius: 8,
    padding: "5px 9px",
    fontSize: 12,
    fontWeight: 600,
    color: "#333",
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
  },
  mapContextHint: {
    background: "rgba(255,255,255,0.94)",
    border: "1px solid #d7d2c4",
    borderRadius: 8,
    padding: "5px 9px",
    fontSize: 11.5,
    color: "#555",
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
  },
  // v3.28 -- stay tally + bonus flash + planning view filter.
  stayBonusFlash: {
    order: 0,
    border: "1px solid #e0b436",
    background: "#fff5d6",
    borderRadius: 10,
    padding: "8px 10px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#5a4300",
    marginBottom: 8,
    animation: "htStayBonusFlash 0.9s ease-in-out 6",
  },
  stayTallyPanel: {
    order: 1,
    border: "1px solid #e2ddcf",
    background: "#fbfaf6",
    borderRadius: 10,
    padding: "7px 10px",
    marginBottom: 8,
  },
  stayTallyHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  stayTallyLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#8a8375" },
  stayTallyCount: { fontSize: 17, fontWeight: 800, color: "#1a1a1a", lineHeight: 1 },
  stayTallyNext: { fontSize: 11.5, color: "#666", marginTop: 3 },
  stayTallyBarOuter: { height: 4, borderRadius: 3, background: "#e6e2d6", marginTop: 5, overflow: "hidden" },
  stayTallyBarInner: { height: "100%", borderRadius: 3, transition: "width 0.3s ease" },
  viewFilterRow: { order: 3, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginBottom: 8 },
  viewFilterLabel: { fontSize: 11.5, color: "#777" },
  viewFilterBtn: {
    border: "1px solid #d7d2c4",
    background: "#fff",
    color: "#555",
    borderRadius: 999,
    padding: "3px 9px",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
  },
  viewFilterBtnActive: { background: "#1a1a1a", color: "#fff", borderColor: "#1a1a1a" },
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
    // Part of the v3.29 persistent top strip -- see sidebarPermanent.
    // Ticket counts are read every single round by both roles, so they
    // sit above everything phase-specific and never scroll out from
    // under the phase controls.
    order: 2,
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
  // STAY CELL (v3.25) -- a round Mr.X did not move. Reads as a
  // deliberate gap in the trail rather than as a travelled leg: no
  // ticket color at all, a dashed grey border and a flat grey fill, so
  // it's distinguishable from both a played move and an unplayed future
  // slot at a glance, without needing the tooltip.
  logBoardCellStay: {
    border: "1.5px dashed #b3b3b3",
    background: "#efefef",
  },
  logBoardStayTag: {
    fontSize: 11,
    fontWeight: 800,
    borderRadius: 4,
    marginTop: 2,
    padding: "1px 0",
    color: "#6b6b6b",
    background: "#e2e2e2",
    letterSpacing: 1,
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
    order: 5, // v3.30: read-often, directly under the always-on tickets strip
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
    order: 3,
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
    order: 7,
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
    order: 9,
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
