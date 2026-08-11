import React, { useState, useEffect } from "react";
import { MAPS } from "./maps/index.js";
import { detectiveLabel } from "./maps/mapSchema.js";
import { applyMapOverride } from "./lib/useMapWithOverrides.js";
import { useLocalGameStore } from "./lib/localGameStore.js";
import { useSupabaseGameStore } from "./lib/supabaseGameStore.js";
import * as api from "./lib/supabaseApi.js";
import * as auth from "./lib/accessControlApi.js";
import LandingScreen from "./components/LandingScreen.jsx";
import LobbyScreen from "./components/LobbyScreen.jsx";
import SetupScreen from "./components/SetupScreen.jsx";
import HandoffScreen from "./components/HandoffScreen.jsx";
import GameBoard from "./components/GameBoard.jsx";
import EndedScreen from "./components/EndedScreen.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import EndGameVote from "./components/EndGameVote.jsx";
import EndGameEarlyButton from "./components/EndGameEarlyButton.jsx";
import PauseVote from "./components/PauseVote.jsx";
import TakeoverReversalVote from "./components/TakeoverReversalVote.jsx";
import RedistributeRolesVote from "./components/RedistributeRolesVote.jsx";
import PausedScreen from "./components/PausedScreen.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import TakeoverPanel from "./components/TakeoverPanel.jsx";
import SpectatorScreen from "./components/SpectatorScreen.jsx";
import RulebookView from "./components/RulebookView.jsx";
import RulebookButton from "./components/RulebookButton.jsx";
import { useRoomStatus } from "./lib/useRoomStatus.js";
import { usePresence } from "./lib/usePresence.js";
import { useDelayedEndedTransition } from "./lib/useDelayedEndedTransition.js";
import { useTurnTimer } from "./lib/useTurnTimer.js";
import { currentActor } from "./lib/gameEngine.js";

// ---------------------------------------------------------------------------
// APP — top-level router. Two independent flows share almost all the same
// screens (SetupScreen/HandoffScreen are pass-and-play only; GameBoard and
// EndedScreen are shared by both; LandingScreen/LobbyScreen are
// multiplayer only):
//
//   PASS-AND-PLAY:  landing -> setup -> [handoff -> playing]* -> ended
//   MULTIPLAYER:    landing -> lobby -> playing -> ended
//
// `appMode` tracks which flow we're in. `useLocalGameStore` and
// `useSupabaseGameStore` both implement the same interface (see
// gameStoreInterface.js), so GameBoard/EndedScreen render identically
// regardless of which one is driving them.
//
// `account` (passed down from AuthGate/main.jsx) is either:
//   - { accountId, displayName }         a real logged-in account
//   - { isGuest: true, displayName }     a guest session (public mode only)
//   - null                                Supabase not configured (dev mode)
// An admin-panel entry point is shown only when a real account has
// is_admin -- checked server-side by the panel's own RPCs regardless, but
// we also avoid rendering the link at all for non-admins.
// ---------------------------------------------------------------------------

const LOCAL_ROOM_KEY = "scotlandyard_room";

// Shows a normal "loading" message briefly, then -- if the game state
// still hasn't arrived after a few seconds -- switches to a clear "this
// room no longer exists" message with a way back to the landing screen.
// This replaces what used to be an infinite spinner if a room's rows had
// been deleted (manually, or by a future cleanup job) while a stale
// localStorage session still pointed at it.
function LoadingOrDeadRoom({ onGiveUp, immediate }) {
  const [timedOut, setTimedOut] = useState(Boolean(immediate));

  useEffect(() => {
    if (immediate) return; // already known to be gone -- no need to wait
    const id = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(id);
  }, [immediate]);

  if (!timedOut) {
    return <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>Loading game state...</div>;
  }

  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>
      <p style={{ color: "#a33", fontWeight: 600 }}>This room no longer exists.</p>
      <p style={{ color: "#777", fontSize: 13 }}>
        It may have ended, been closed, or the link may be out of date.
      </p>
      <button
        style={{
          marginTop: 12,
          background: "#111",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "10px 20px",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
        onClick={onGiveUp}
      >
        Back to start
      </button>
    </div>
  );
}

export default function App({ account, onLogout }) {
  const [appMode, setAppMode] = useState("landing"); // "landing" | "passandplay" | "multiplayer" | "adminPanel"
  const [isAdmin, setIsAdmin] = useState(false);
  // Rulebook overlay: one shared piece of state for the whole app (rather
  // than each screen owning its own copy), since it's opened from several
  // different screens (Landing/Setup/Lobby/GameBoard) but should always
  // behave identically -- same content, same close behavior -- regardless
  // of where it was opened from.
  const [showRulebook, setShowRulebook] = useState(false);

  useEffect(() => {
    if (account?.accountId) {
      // list_accounts_for_admin itself enforces the is_admin check --
      // calling it here is a cheap way to find out if THIS account is an
      // admin (fails harmlessly for non-admins, we just don't show the link).
      auth
        .listAccountsForAdmin(account.accountId)
        .then(() => setIsAdmin(true))
        .catch(() => setIsAdmin(false));
    }
  }, [account]);

  // Admin-set per-map overrides (ticket counts, detective density ratio,
  // round scaling), fetched once here at the App level -- this is the
  // actual fix for a real bug: overrides were correctly saved and
  // correctly PREVIEWED in Landing/Setup screens (via useMapWithOverrides
  // there), but every game-start code path below reads MAPS[id] directly,
  // which is the raw un-overridden map from the static registry, so the
  // override never reached real gameplay. getEffectiveMap(id) is what
  // every gameplay-relevant MAPS[id] read gets replaced with.
  const [mapOverrides, setMapOverrides] = useState({});
  useEffect(() => {
    auth
      .getMapOverrides()
      .then(setMapOverrides)
      .catch((e) => console.error("Failed to fetch map overrides:", e));
  }, []);
  function getEffectiveMap(mapId) {
    const raw = MAPS[mapId];
    if (!raw) return raw;
    return applyMapOverride(raw, mapOverrides[mapId]) || raw;
  }

  // ---- Pass-and-play specific state ----
  const localStore = useLocalGameStore();
  const { showEndedScreen: ppShowEndedScreen } = useDelayedEndedTransition(localStore.match);

  // If a pass-and-play match was restored from localStorage on mount
  // (see localGameStore.js), switch appMode to reflect it -- otherwise
  // the restored match sits in the store but the app still shows the
  // landing screen, since nothing else would ever flip appMode on its
  // own just because match data happens to exist.
  useEffect(() => {
    if (localStore.match && appMode === "landing") {
      // BUG FIX: passAndPlayMapId is component state, NOT persisted to
      // localStorage the way localStore.match is -- so on a fresh page
      // load that restores an in-progress pass-and-play match,
      // passAndPlayMapId starts back at null while appMode flips straight
      // to "passandplay" below. getEffectiveMap(null) then resolves to
      // undefined, which crashed GameBoard/EndedScreen the moment they
      // tried to read map.modeTheme. match.mapId is the actual source of
      // truth for which map a restored match belongs to, so restore it
      // here instead of leaving passAndPlayMapId stuck at its initial value.
      if (localStore.match.mapId) setPassAndPlayMapId(localStore.match.mapId);
      setAppMode("passandplay");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // IMPORTANT: must never default to a hardcoded map id like "city" here
  // -- if that specific map is ever removed/deactivated, MAPS[id] would
  // resolve to undefined and break map lookups downstream (this was the
  // exact bug already found and fixed once in SetupScreen.jsx; applying
  // the same fix here). Starts null; SetupScreen/LandingScreen's own
  // "snap to first active map" logic fills in a real id once MAP_LIST
  // loads.
  const [passAndPlayMapId, setPassAndPlayMapId] = useState(null);
  const [handoffFor, setHandoffFor] = useState(null);

  // ---- Multiplayer specific state ----
  const [mpRoomId, setMpRoomId] = useState(null);
  const [mpRoomCode, setMpRoomCode] = useState(null);
  const [mpPlayerId, setMpPlayerId] = useState(null);
  const [mpRole, setMpRole] = useState(null);
  const [mpIsHost, setMpIsHost] = useState(false);
  const [mpNumDetectives, setMpNumDetectives] = useState(3);
  const [mpTotalPlayers, setMpTotalPlayers] = useState(2);
  const [mpMapId, setMpMapId] = useState(null); // same reasoning as passAndPlayMapId above -- never hardcode a specific map id as the default
  const [mpDisplayName, setMpDisplayName] = useState("");
  // mpStage used to be local-only state that only the HOST's own click
  // ever updated -- meaning a detective's browser had no way to learn the
  // game had started. It's now derived from the room's actual `status`
  // column via a live Supabase subscription (see useRoomStatus.js), so
  // every client -- host or not -- sees the same "has this game started"
  // truth, kept in sync automatically.
  const { status: roomStatus, room: liveRoom, roomNotFound: mpRoomNotFound } = useRoomStatus(
    appMode === "multiplayer" ? mpRoomId : null
  );
  const mpStage = roomStatus === "playing" || roomStatus === "ended" ? "playing" : "lobby";
  // Real bug fix: host reassignment (reassign_host) and settings edits
  // (update_room_settings) both correctly updated the server, but every
  // client EXCEPT the one that made the call kept showing stale local
  // state indefinitely (mpIsHost/mpMapId/etc were only ever set once, at
  // join/create time). Deriving these live from the room row (kept
  // current via Realtime in useRoomStatus) means every client's view
  // updates the moment ANYONE changes them, not just the caller.
  const liveIsHost = liveRoom ? liveRoom.host_player_id === mpPlayerId : mpIsHost;
  const liveMapId = liveRoom?.map_id ?? mpMapId;
  const liveNumDetectives = liveRoom?.num_detectives ?? mpNumDetectives;
  const liveTotalPlayers = liveRoom?.total_players ?? mpTotalPlayers;

  const supabaseStore = useSupabaseGameStore({
    roomId: appMode === "multiplayer" ? mpRoomId : null,
    myPlayerId: mpPlayerId,
    myRole: mpRole,
  });
  const { showEndedScreen: mpShowEndedScreen } = useDelayedEndedTransition(supabaseStore.match);
  const { secondsRemaining: mpSecondsRemaining, turnTimerSeconds: mpTurnTimerSeconds } = useTurnTimer({
    roomId: appMode === "multiplayer" ? mpRoomId : null,
    map: getEffectiveMap(liveMapId),
    match: supabaseStore.match,
    onDetectiveMove: (detId, to, mode) => supabaseStore.submitDetectiveMove(getEffectiveMap(liveMapId), detId, to, mode),
    onMrXMove: (to, edgeMode, ticketUsed) => supabaseStore.submitMrXMove(getEffectiveMap(liveMapId), to, edgeMode, ticketUsed),
    // BUG FIX: without this, a player whose timer expired with genuinely
    // zero legal moves left the game stalled forever (see useTurnTimer.js
    // for the full reasoning) -- wired to the same passTurn the manual
    // "Pass Turn" button already uses.
    onPassTurn: (actor) => supabaseStore.passTurn(actor),
  });

  const [mpExploreMode, setMpExploreMode] = useState(null); // this client's own current route-explorer selection, reported up from GameBoard so it can be broadcast via Presence

  const { onlinePlayerIds, isInactive, presenceState } = usePresence({
    roomId: appMode === "multiplayer" ? mpRoomId : null,
    myPlayerId: mpPlayerId,
    myDisplayName: mpDisplayName,
    myRole: mpRole,
    gracePeriodSeconds: 25, // TODO: read from admin config once wired through App-level state
    myExploreMode: mpExploreMode,
  });

  const [mpPlayersList, setMpPlayersList] = useState([]);
  useEffect(() => {
    if (appMode !== "multiplayer" || mpStage !== "playing" || !mpRoomId) return;
    let cancelled = false;
    async function poll() {
      try {
        const rows = await api.fetchPlayers(mpRoomId);
        if (!cancelled) setMpPlayersList(rows);
      } catch (e) {
        console.error("Failed to fetch players for presence check:", e);
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [appMode, mpStage, mpRoomId]);

  // Auto-flag / auto-heal: for each seat currently in the game, checks
  // whether its controlling player is confirmed inactive (per Presence +
  // grace period) and, if so, flags it for a takeover decision -- unless
  // one is already active for that seat (flag_inactive_player is
  // idempotent, so calling it repeatedly is harmless either way). Any
  // connected client does this, not just the host, so inactivity gets
  // noticed promptly by whoever's still around.
  useEffect(() => {
    if (appMode !== "multiplayer" || mpStage !== "playing" || !mpRoomId || mpPlayersList.length === 0) return;
    for (const p of mpPlayersList) {
      if (isInactive(p.id)) {
        api.flagInactivePlayer({ roomId: mpRoomId, targetRole: p.role }).catch(() => {});
      }
    }
  }, [appMode, mpStage, mpRoomId, mpPlayersList, isInactive]);

  // Auto-heal: if a takeover event is currently open (host deciding,
  // nominating, or voting -- NOT yet 'completed') and the original
  // target player's presence has resumed, cancel the event so play
  // continues under them uninterrupted. Checked by any connected client;
  // cancel_takeover_event is a no-op if the event's already resolved.
  const [mpActiveTakeoverEvent, setMpActiveTakeoverEvent] = useState(null);

  // Spectator check: periodically verify our own stored player_id still
  // corresponds to a real seat -- if not, we've been replaced by a
  // completed takeover while disconnected. Checked on entering the
  // playing phase and every 5s thereafter (cheap: one RPC call).
  const [mpSpectatorInfo, setMpSpectatorInfo] = useState(null); // null (not checked / still in room) | { replacedRole }
  useEffect(() => {
    if (appMode !== "multiplayer" || mpStage !== "playing" || !mpRoomId || !mpPlayerId) return;
    let cancelled = false;
    async function poll() {
      try {
        const result = await api.checkPlayerStillInRoom({ roomId: mpRoomId, playerId: mpPlayerId });
        if (!cancelled) {
          setMpSpectatorInfo(
            result.stillInRoom
              ? null
              : { replacedRole: result.replacedRole, takeoverEventId: result.takeoverEventId }
          );
        }
      } catch (e) {
        console.error("Failed to check player-still-in-room status:", e);
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [appMode, mpStage, mpRoomId, mpPlayerId]);

  useEffect(() => {
    if (appMode !== "multiplayer" || mpStage !== "playing" || !mpRoomId) return;
    let cancelled = false;
    async function poll() {
      try {
        const e = await api.getActiveTakeoverEvent(mpRoomId);
        if (!cancelled) setMpActiveTakeoverEvent(e);
      } catch (err) {
        console.error("Failed to poll takeover event for auto-heal check:", err);
      }
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [appMode, mpStage, mpRoomId]);

  useEffect(() => {
    if (!mpActiveTakeoverEvent || !mpRoomId) return;
    if (["completed", "cancelled", "expired"].includes(mpActiveTakeoverEvent.status)) return;
    const targetPlayer = mpPlayersList.find((p) => p.role === mpActiveTakeoverEvent.targetRole);
    if (targetPlayer && onlinePlayerIds.has(targetPlayer.id)) {
      api.cancelTakeoverEvent({ roomId: mpRoomId, eventId: mpActiveTakeoverEvent.eventId }).catch(() => {});
    }
  }, [mpActiveTakeoverEvent, mpPlayersList, onlinePlayerIds, mpRoomId]);

  // Restore a multiplayer session on refresh (room/player id persisted to
  // localStorage), so accidentally reloading the page mid-game doesn't
  // boot the player out of their seat. Note: we deliberately do NOT
  // persist/restore "stage" (lobby vs playing) here anymore -- that's now
  // always derived live from the room's actual status (see useRoomStatus
  // above), so a stale cached stage value can never disagree with reality.
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_ROOM_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.roomId && parsed.playerId && parsed.role) {
          setMpRoomId(parsed.roomId);
          setMpRoomCode(parsed.roomCode);
          setMpPlayerId(parsed.playerId);
          setMpRole(parsed.role);
          setMpIsHost(parsed.isHost);
          setMpNumDetectives(parsed.numDetectives);
          setMpTotalPlayers(parsed.totalPlayers || 2);
          setMpMapId(parsed.mapId);
          setMpDisplayName(parsed.displayName);
          setAppMode("multiplayer");
        }
      } catch {
        localStorage.removeItem(LOCAL_ROOM_KEY);
      }
    }
  }, []);

  function persistMpSession(extra = {}) {
    const payload = {
      roomId: mpRoomId,
      roomCode: mpRoomCode,
      playerId: mpPlayerId,
      role: mpRole,
      isHost: mpIsHost,
      numDetectives: mpNumDetectives,
      totalPlayers: mpTotalPlayers,
      mapId: mpMapId,
      displayName: mpDisplayName,
      ...extra,
    };
    localStorage.setItem(LOCAL_ROOM_KEY, JSON.stringify(payload));
  }

  // ---- Landing screen handlers ----
  function handleChoosePassAndPlay() {
    setAppMode("passandplay");
  }

  async function handleCreateRoom({ displayName, mapId, numDetectives, totalPlayers, hostRole, mapStationCount, turnTimerSeconds, featureOverrides, isPublic, roomName }) {
    const { roomId, roomCode, hostPlayerId } = await api.createRoom({
      mapId,
      numDetectives,
      totalPlayers,
      hostDisplayName: displayName,
      hostRole,
      mapStationCount,
      turnTimerSeconds,
      featureOverrides,
      isPublic,
      roomName,
    });
    setMpRoomId(roomId);
    setMpRoomCode(roomCode);
    setMpPlayerId(hostPlayerId);
    setMpRole(hostRole);
    setMpIsHost(true);
    setMpNumDetectives(numDetectives);
    setMpTotalPlayers(totalPlayers);
    setMpMapId(mapId);
    setMpDisplayName(displayName);
    setAppMode("multiplayer");
    localStorage.setItem(
      LOCAL_ROOM_KEY,
      JSON.stringify({
        roomId,
        roomCode,
        playerId: hostPlayerId,
        role: hostRole,
        isHost: true,
        numDetectives,
        totalPlayers,
        mapId,
        displayName,
        stage: "lobby",
      })
    );
  }

  async function handleLookupRoom(roomCode) {
    return api.lookupRoom(roomCode);
  }

  async function handleConfirmJoin({ displayName, roomCode, role }) {
    const { roomId, playerId } = await api.joinRoom({ roomCode, role, displayName });
    const info = await api.lookupRoom(roomCode); // to get mapId/numDetectives/totalPlayers for the lobby screen
    setMpRoomId(roomId);
    setMpRoomCode(roomCode);
    setMpPlayerId(playerId);
    setMpRole(role);
    setMpIsHost(false);
    setMpNumDetectives(info.numDetectives);
    setMpTotalPlayers(info.totalPlayers);
    setMpMapId(info.mapId);
    setMpDisplayName(displayName);
    setAppMode("multiplayer");
    localStorage.setItem(
      LOCAL_ROOM_KEY,
      JSON.stringify({
        roomId,
        roomCode,
        playerId,
        role,
        isHost: false,
        numDetectives: info.numDetectives,
        totalPlayers: info.totalPlayers,
        mapId: info.mapId,
        displayName,
        stage: "lobby",
      })
    );
  }

  // Rejoining an EXISTING seat mid-game (a disconnected/refreshed
  // player getting back into their own seat, NOT a fresh join --
  // join_room explicitly refuses a started game, which is exactly what
  // this path is for). Mirrors handleConfirmJoin's final "settle into
  // this session" steps, but starting from a known player_id/role
  // (chosen from get_reconnectable_seats) rather than a fresh join
  // response.
  async function handleRejoin({ playerId, roomId, role, roomCode, displayName }) {
    const room = await api.fetchRoom(roomId); // for mapId/numDetectives/totalPlayers/host_player_id
    const isHost = room.host_player_id === playerId;
    setMpRoomId(roomId);
    setMpRoomCode(roomCode);
    setMpPlayerId(playerId);
    setMpRole(role);
    setMpIsHost(isHost);
    setMpNumDetectives(room.num_detectives);
    setMpTotalPlayers(room.total_players);
    setMpMapId(room.map_id);
    setMpDisplayName(displayName);
    setAppMode("multiplayer");
    localStorage.setItem(
      LOCAL_ROOM_KEY,
      JSON.stringify({
        roomId,
        roomCode,
        playerId,
        role,
        isHost,
        numDetectives: room.num_detectives,
        totalPlayers: room.total_players,
        mapId: room.map_id,
        displayName,
      })
    );
  }

  // Rejoining a LOBBY seat (game hasn't started yet) -- the disconnected
  // player's own seat, reclaimed directly via rejoin_lobby_seat rather
  // than a fresh join_room call (which would otherwise fail with "seat
  // already taken", since their original row was never removed). Lands
  // them back in the lobby exactly as if they'd never left.
  async function handleLobbyRejoin({ playerId, roomCode, displayName }) {
    const { roomId, role } = await api.rejoinLobbySeat({ playerId, displayName });
    const room = await api.fetchRoom(roomId);
    const isHost = room.host_player_id === playerId;
    setMpRoomId(roomId);
    setMpRoomCode(roomCode);
    setMpPlayerId(playerId);
    setMpRole(role);
    setMpIsHost(isHost);
    setMpNumDetectives(room.num_detectives);
    setMpTotalPlayers(room.total_players);
    setMpMapId(room.map_id);
    setMpDisplayName(displayName || room.display_name);
    setAppMode("multiplayer");
    localStorage.setItem(
      LOCAL_ROOM_KEY,
      JSON.stringify({
        roomId,
        roomCode,
        playerId,
        role,
        isHost,
        numDetectives: room.num_detectives,
        totalPlayers: room.total_players,
        mapId: room.map_id,
        displayName,
        stage: "lobby",
      })
    );
  }

  async function handleStartMultiplayerGame() {
    const map = getEffectiveMap(liveMapId);
    await supabaseStore.startGame(map);
    // no need to persist a "stage" here anymore -- the next load of this
    // room will correctly show "playing" because useRoomStatus reads it
    // live from the room's actual status column, not from anything we
    // wrote to localStorage
  }

  function handleLeaveMultiplayer() {
    // Tell the server this is a DELIBERATE departure (not just a
    // disconnect) -- if this was the last player remaining, the room's
    // data is deleted immediately rather than sitting around for the
    // scheduled cleanup job's 1-hour grace period. Fire-and-forget: this
    // is a courtesy cleanup, not something the player needs to wait on,
    // and the scheduled job remains the fallback safety net if this call
    // fails for any reason (network issue, etc).
    if (mpRoomId && mpPlayerId) {
      api.leaveRoomPermanently({ roomId: mpRoomId, playerId: mpPlayerId }).catch((e) => {
        console.error("Failed to notify server of room departure (non-fatal, scheduled cleanup will catch it eventually):", e);
      });
    }
    localStorage.removeItem(LOCAL_ROOM_KEY);
    setMpRoomId(null);
    setMpRoomCode(null);
    setMpPlayerId(null);
    setMpRole(null);
    setMpIsHost(false);
    setAppMode("landing");
  }

  // ---- Pass-and-play game flow ----
  function handleStartPassAndPlay({ mapId, numDetectives, roundScalingRatio }) {
    setPassAndPlayMapId(mapId);
    const map = getEffectiveMap(mapId);
    localStore.startGame(map, { mapId, numDetectives, roundScalingRatio });
  }

  useEffect(() => {
    if (appMode !== "passandplay" || !localStore.match) return;
    if (localStore.match.phase === "handoff") {
      const map = getEffectiveMap(passAndPlayMapId);
      const actor = currentActor(localStore.match);
      const label =
        actor === "mrx"
          ? map.mrxName || "Mr. X"
          : (map.characterNames && map.characterNames[parseInt(actor.slice(1))]) ||
            detectiveLabel(map, parseInt(actor.slice(1)) + 1);
      setHandoffFor(label);
    }
  }, [appMode, localStore.match, passAndPlayMapId]);

  function handleReadyForTurn() {
    localStore.beginTurnScreen();
  }

  function handleResetPassAndPlay() {
    localStore.resetToSetup();
    setAppMode("landing");
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  // withRulebook — wraps a screen's JSX with the RulebookView overlay,
  // rendered as a sibling (so it always sits on top, regardless of which
  // screen is currently active) rather than inside any single screen
  // component. This app renders each mode via an early `return`, so this
  // wrapper is called individually at each return site rather than once
  // around the whole component -- but it's a single, consistent source of
  // truth for HOW the overlay is attached, not copy-pasted logic. mrxNameFn/
  // detectiveNameFn are optional -- screens without a map loaded yet
  // (LandingScreen, admin panel) just get the overlay's own generic
  // "Mr. X" / "Detective N" defaults.
  function withRulebook(el, mrxNameFn, detectiveNameFn, modeTheme) {
    return (
      <>
        {el}
        {showRulebook && (
          <RulebookView onClose={() => setShowRulebook(false)} mrxName={mrxNameFn} detectiveName={detectiveNameFn} modeTheme={modeTheme} />
        )}
      </>
    );
  }

  if (appMode === "adminPanel") {
    return <AdminPanel accountId={account.accountId} onBack={() => setAppMode("landing")} />;
  }

  if (appMode === "landing") {
    return withRulebook(
      <LandingScreen
        onChoosePassAndPlay={handleChoosePassAndPlay}
        onChooseCreateRoom={handleCreateRoom}
        onChooseJoinRoom={{ lookup: handleLookupRoom, confirm: handleConfirmJoin, rejoin: handleRejoin, lobbyRejoin: handleLobbyRejoin }}
        showAdminPanelLink={isAdmin}
        onOpenAdminPanel={() => setAppMode("adminPanel")}
        accountDisplayName={account?.displayName || ""}
        onLogout={account ? onLogout : null}
        onOpenRulebook={() => setShowRulebook(true)}
      />
    );
  }

  if (appMode === "passandplay") {
    const match = localStore.match;
    // Defensive fallback: passAndPlayMapId is component state and can in
    // principle be stale/null (e.g. a restored match before the
    // restore-effect above has run) while match.mapId -- the actual
    // persisted source of truth for a match's map -- is already correct.
    // Preferring match.mapId here means a stale passAndPlayMapId can no
    // longer produce an undefined map and crash the board.
    const map = getEffectiveMap(match?.mapId ?? passAndPlayMapId);

    if (!match) {
      return withRulebook(
        <SetupScreen onStart={handleStartPassAndPlay} onBack={() => setAppMode("landing")} onOpenRulebook={() => setShowRulebook(true)} />
      );
    }

    if (!map) {
      // Should be unreachable now, but if a match somehow references a
      // map id that no longer exists (e.g. a map was removed from
      // MAP_LIST), fail into a recoverable screen instead of crashing.
      return withRulebook(
        <SetupScreen onStart={handleStartPassAndPlay} onBack={handleResetPassAndPlay} onOpenRulebook={() => setShowRulebook(true)} />
      );
    }

    const mrxName = () => map.mrxName || "Mr. X";
    const detectiveName = (id) => (map.characterNames && map.characterNames[id]) || detectiveLabel(map, id + 1);
    if (match.phase === "handoff") {
      return withRulebook(
        <HandoffScreen handoffFor={handoffFor} round={match.round} maxRounds={match.maxRounds} onReady={handleReadyForTurn} />
      );
    }
    if (match.phase === "ended") {
      if (!ppShowEndedScreen) {
        // Deliberate pause: keep showing the board (with its collision
        // effect) for a moment after a capture, rather than jumping
        // straight to results -- see useDelayedEndedTransition.
        return withRulebook(
          <GameBoard
            map={map}
            match={match}
            myRole={null}
            mrxName={mrxName}
            detectiveName={detectiveName}
            onDetectiveMove={() => {}}
            onMrXMove={() => {}}
            onActivateDoubleMove={() => {}}
          />,
          mrxName,
          detectiveName,
          map.modeTheme
        );
      }
      return withRulebook(
        <EndedScreen
          map={map}
          match={match}
          mrxName={mrxName}
          detectiveName={detectiveName}
          onNewGame={handleResetPassAndPlay}
        />,
        mrxName,
        detectiveName,
        map.modeTheme
      );
    }
    // phase === "playing"
    return withRulebook(
      <GameBoard
        map={map}
        match={match}
        myRole={null}
        mrxName={mrxName}
        detectiveName={detectiveName}
        onDetectiveMove={(detId, to, mode) => localStore.submitDetectiveMove(map, detId, to, mode)}
        onMrXMove={(to, edgeMode, ticketUsed) => localStore.submitMrXMove(map, to, edgeMode, ticketUsed)}
        onActivateDoubleMove={() => localStore.activateDoubleMove()}
        onPassTurn={(actor) => localStore.passTurn(actor)}
        extraHeaderContent={
          <>
            <RulebookButton compact onClick={() => setShowRulebook(true)} />
            <EndGameEarlyButton onEndGame={() => localStore.endGameEarly()} />
          </>
        }
      />,
      mrxName,
      detectiveName,
      map.modeTheme
    );
  }

  if (appMode === "multiplayer") {
    const map = getEffectiveMap(mpMapId);
    const mrxName = () => map.mrxName || "Mr. X";

    // Maps each detective ID -> the display name of the player
    // controlling it, for the ticket counter's "Priya — D1" labeling AND
    // (see detectiveName below) for turn banners on maps with no themed
    // character roster. A multi-detective seat's role is comma-joined
    // (e.g. "d0,d1"), so every individual detective ID in that list maps
    // to the same player. MOVED HERE (to the top of this branch, before
    // every early-return) -- a real, serious bug: this used to be
    // declared much further down, but was already being REFERENCED
    // earlier (in the "ended" phase branch above where it's used), which
    // is a temporal-dead-zone violation in JS (referencing a `const`
    // before its declaration throws ReferenceError, even if the
    // declaration is later in the SAME function scope) -- an uncaught
    // exception here crashes the entire React render tree, producing
    // exactly a blank/black screen. Confirmed via a direct Node.js test
    // before fixing.
    const detectivePlayerNames = {};
    for (const p of mpPlayersList) {
      // Defensive: p.role should always be a real string ("mrx" or a
      // comma-joined detective-seat list like "d0,d1"), but this loop
      // runs on EVERY render of the whole multiplayer screen, using
      // live-fetched data from Supabase -- if role is ever null/
      // undefined for any reason (a transient fetch state, a malformed
      // row), .split() on it would throw and crash the ENTIRE render
      // tree, not just this one label. Skipping a malformed row here is
      // far safer than letting one bad row black-screen every player.
      if (!p.role || p.role === "mrx") continue;
      for (const seat of p.role.split(",")) {
        const detId = parseInt(seat.slice(1), 10);
        if (!Number.isNaN(detId)) detectivePlayerNames[detId] = p.display_name;
      }
    }

    // detectiveName precedence, per explicit decision: on maps with a
    // themed character roster (e.g. Westeros -- Jon Snow, Arya Stark),
    // ALWAYS show the character name, even when a real player display
    // name is also known -- the character roster is a deliberate
    // role-play feature for those maps, not just a fallback label. On
    // maps with no themed roster, use the real player's entered display
    // name when known (this is the actual fix for the request: turn
    // banners and other detectiveName() call sites previously only ever
    // showed "Detective N", never the name a player actually typed in),
    // falling back to "Detective N" only if neither is available (e.g.
    // player data hasn't loaded yet).
    const detectiveName = (id) =>
      (map.characterNames && map.characterNames[id]) || detectivePlayerNames[id] || detectiveLabel(map, id + 1);

    if (mpRoomNotFound) {
      return (
        <LoadingOrDeadRoom
          immediate
          onGiveUp={() => {
            localStorage.removeItem(LOCAL_ROOM_KEY);
            setMpRoomId(null);
            setMpRoomCode(null);
            setMpPlayerId(null);
            setMpRole(null);
            setMpIsHost(false);
            setAppMode("landing");
          }}
        />
      );
    }

    if (mpStage === "lobby") {
      return withRulebook(
        <LobbyScreen
          roomId={mpRoomId}
          roomCode={mpRoomCode}
          myPlayerId={mpPlayerId}
          myRole={mpRole}
          onRoleChanged={setMpRole}
          isHost={liveIsHost}
          onHostChanged={setMpIsHost}
          numDetectives={liveNumDetectives}
          totalPlayers={liveTotalPlayers}
          mapId={liveMapId}
          onStart={handleStartMultiplayerGame}
          onLeave={handleLeaveMultiplayer}
          onOpenRulebook={() => setShowRulebook(true)}
        />
      );
    }

    const match = supabaseStore.match;
    if (!match) {
      return (
        <LoadingOrDeadRoom
          onGiveUp={() => {
            // The room's data is gone (deleted rows, or it never
            // properly started) -- clear the stale local session so a
            // future reload doesn't repeat this same hang, and send the
            // player back to the landing screen with a clear reason
            // instead of a silent infinite spinner.
            localStorage.removeItem(LOCAL_ROOM_KEY);
            setMpRoomId(null);
            setMpRoomCode(null);
            setMpPlayerId(null);
            setMpRole(null);
            setMpIsHost(false);
            setAppMode("landing");
          }}
        />
      );
    }

    if (match.phase === "ended") {
      if (!mpShowEndedScreen) {
        return withRulebook(
          <GameBoard
            map={map}
            match={match}
            myRole={mpSpectatorInfo ? "__spectator__" : mpRole}
            roomId={mpRoomId}
            mrxName={mrxName}
            detectiveName={detectiveName}
            detectivePlayerNames={detectivePlayerNames}
            onDetectiveMove={() => {}}
            onMrXMove={() => {}}
            onActivateDoubleMove={() => {}}
          />,
          mrxName,
          detectiveName,
          map.modeTheme
        );
      }
      return withRulebook(
        <EndedScreen
          map={map}
          match={match}
          mrxName={mrxName}
          detectiveName={detectiveName}
          onNewGame={handleLeaveMultiplayer}
        />,
        mrxName,
        detectiveName,
        map.modeTheme
      );
    }

    if (match.phase === "paused") {
      return withRulebook(<PausedScreen roomId={mpRoomId} myPlayerId={mpPlayerId} onResumed={() => {}} />);
    }

    // Derive the huddle-panel data from Presence: every OTHER detective
    // player currently broadcasting a non-null exploreMode. Looked up
    // against mpPlayersList (role -> player) and match.detectives (seat
    // -> color/position), so the panel shows real names/colors already
    // used elsewhere on this exact board, not a separate palette.
    const teammatesExploring = [];
    let anyDetectiveExploring = false;
    for (const p of mpPlayersList) {
      if (!p.role || p.role === "mrx" || p.id === mpPlayerId) continue; // skip malformed rows, Mr.X's own seat, and myself
      const payload = presenceState[p.id];
      if (!payload || !payload.exploreMode) continue;
      // a multi-detective seat's role is comma-joined (e.g. "d0,d1") --
      // use the FIRST detective in their seat for color/position, since
      // that's simplest and still gives a meaningful visual anchor
      const firstSeat = p.role.split(",")[0];
      const theirDetective = match.detectives.find((d) => `d${d.id}` === firstSeat);
      if (!theirDetective) continue;
      anyDetectiveExploring = true;
      teammatesExploring.push({
        playerId: p.id,
        displayName: p.display_name,
        color: theirDetective.color,
        exploreMode: payload.exploreMode,
        detectiveSeat: firstSeat,
      });
    }

    // phase === "playing" -- multiplayer never shows a handoff screen;
    // each player has their own device and just waits for their turn
    // (GameBoard's "Waiting for X..." note covers that).
    const gameBoardEl = (
      <GameBoard
        map={map}
        match={match}
        myRole={mpSpectatorInfo ? "__spectator__" : mpRole}
        roomId={mpRoomId}
        mrxName={mrxName}
        detectiveName={detectiveName}
        detectivePlayerNames={detectivePlayerNames}
        roomCode={mpRoomCode}
        secondsRemaining={mpSecondsRemaining}
        turnTimerSeconds={mpTurnTimerSeconds}
        onExploreModeChange={setMpExploreMode}
        teammatesExploring={teammatesExploring}
        anyDetectiveExploring={anyDetectiveExploring}
        onDetectiveMove={(detId, to, mode) => supabaseStore.submitDetectiveMove(map, detId, to, mode)}
        onMrXMove={(to, edgeMode, ticketUsed) => supabaseStore.submitMrXMove(map, to, edgeMode, ticketUsed)}
        onActivateDoubleMove={() => supabaseStore.activateDoubleMove()}
        onPassTurn={(actor) => supabaseStore.passTurn(actor)}
        extraHeaderContent={
          <>
            <RulebookButton compact onClick={() => setShowRulebook(true)} />
            <PauseVote roomId={mpRoomId} myPlayerId={mpPlayerId} />
            <EndGameVote roomId={mpRoomId} myPlayerId={mpPlayerId} />
          </>
        }
        extraHeaderContentBelow={
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {/* Single instance handles both roles: shows a "request my
                  seat back" button when completedTakeoverEventId is
                  known (only true for the replaced player themself, via
                  mpSpectatorInfo), and renders the vote MODAL for
                  everyone once a proposal actually exists, regardless of
                  whether this specific client has an event id. */}
              <TakeoverReversalVote
                roomId={mpRoomId}
                myPlayerId={mpPlayerId}
                completedTakeoverEventId={mpSpectatorInfo?.takeoverEventId || null}
              />
              <RedistributeRolesVote
                roomId={mpRoomId}
                myPlayerId={mpPlayerId}
                isHost={liveIsHost}
                numDetectives={liveNumDetectives}
                totalPlayers={liveTotalPlayers}
              />
            </div>
            <TakeoverPanel roomId={mpRoomId} myPlayerId={mpPlayerId} isHost={liveIsHost} />
          </div>
        }
        belowTicketsContent={
          <ChatPanel roomId={mpRoomId} myPlayerId={mpPlayerId} myRole={mpRole} myDisplayName={mpDisplayName} detectiveTeamName={map.detectiveTeamName} />
        }
      />
    );

    if (mpSpectatorInfo) {
      return withRulebook(
        <SpectatorScreen replacedRole={mpSpectatorInfo.replacedRole} mrxName={mrxName} detectiveTeamName={map.detectiveTeamName} onLeave={handleLeaveMultiplayer}>
          {gameBoardEl}
        </SpectatorScreen>,
        mrxName,
        detectiveName,
        map.modeTheme
      );
    }

    return withRulebook(gameBoardEl, mrxName, detectiveName, map.modeTheme);
  }

  return null;
}
