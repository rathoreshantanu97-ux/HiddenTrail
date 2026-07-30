import React, { useState, useEffect } from "react";
import { MAPS } from "./maps/index.js";
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
import PausedScreen from "./components/PausedScreen.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import TakeoverPanel from "./components/TakeoverPanel.jsx";
import SpectatorScreen from "./components/SpectatorScreen.jsx";
import { useRoomStatus } from "./lib/useRoomStatus.js";
import { usePresence } from "./lib/usePresence.js";
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

  // ---- Pass-and-play specific state ----
  const localStore = useLocalGameStore();
  const [passAndPlayMapId, setPassAndPlayMapId] = useState("city");
  const [handoffFor, setHandoffFor] = useState(null);

  // ---- Multiplayer specific state ----
  const [mpRoomId, setMpRoomId] = useState(null);
  const [mpRoomCode, setMpRoomCode] = useState(null);
  const [mpPlayerId, setMpPlayerId] = useState(null);
  const [mpRole, setMpRole] = useState(null);
  const [mpIsHost, setMpIsHost] = useState(false);
  const [mpNumDetectives, setMpNumDetectives] = useState(3);
  const [mpTotalPlayers, setMpTotalPlayers] = useState(2);
  const [mpMapId, setMpMapId] = useState("city");
  const [mpDisplayName, setMpDisplayName] = useState("");
  // mpStage used to be local-only state that only the HOST's own click
  // ever updated -- meaning a detective's browser had no way to learn the
  // game had started. It's now derived from the room's actual `status`
  // column via a live Supabase subscription (see useRoomStatus.js), so
  // every client -- host or not -- sees the same "has this game started"
  // truth, kept in sync automatically.
  const { status: roomStatus, roomNotFound: mpRoomNotFound } = useRoomStatus(
    appMode === "multiplayer" ? mpRoomId : null
  );
  const mpStage = roomStatus === "playing" || roomStatus === "ended" ? "playing" : "lobby";

  const supabaseStore = useSupabaseGameStore({
    roomId: appMode === "multiplayer" ? mpRoomId : null,
    myPlayerId: mpPlayerId,
    myRole: mpRole,
  });

  const { onlinePlayerIds, isInactive } = usePresence({
    roomId: appMode === "multiplayer" ? mpRoomId : null,
    myPlayerId: mpPlayerId,
    myDisplayName: mpDisplayName,
    myRole: mpRole,
    gracePeriodSeconds: 25, // TODO: read from admin config once wired through App-level state
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
          setMpSpectatorInfo(result.stillInRoom ? null : { replacedRole: result.replacedRole });
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

  async function handleCreateRoom({ displayName, mapId, numDetectives, totalPlayers, hostRole }) {
    const { roomId, roomCode, hostPlayerId } = await api.createRoom({
      mapId,
      numDetectives,
      totalPlayers,
      hostDisplayName: displayName,
      hostRole,
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

  async function handleStartMultiplayerGame() {
    const map = MAPS[mpMapId];
    await supabaseStore.startGame(map);
    // no need to persist a "stage" here anymore -- the next load of this
    // room will correctly show "playing" because useRoomStatus reads it
    // live from the room's actual status column, not from anything we
    // wrote to localStorage
  }

  function handleLeaveMultiplayer() {
    localStorage.removeItem(LOCAL_ROOM_KEY);
    setMpRoomId(null);
    setMpRoomCode(null);
    setMpPlayerId(null);
    setMpRole(null);
    setMpIsHost(false);
    setAppMode("landing");
  }

  // ---- Pass-and-play game flow ----
  function handleStartPassAndPlay({ mapId, numDetectives }) {
    setPassAndPlayMapId(mapId);
    const map = MAPS[mapId];
    localStore.startGame(map, { mapId, numDetectives });
  }

  useEffect(() => {
    if (appMode !== "passandplay" || !localStore.match) return;
    if (localStore.match.phase === "handoff") {
      const map = MAPS[passAndPlayMapId];
      const actor = currentActor(localStore.match);
      const label =
        actor === "mrx"
          ? map.mrxName || "Mr. X"
          : (map.characterNames && map.characterNames[parseInt(actor.slice(1))]) ||
            `Detective ${parseInt(actor.slice(1)) + 1}`;
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

  if (appMode === "adminPanel") {
    return <AdminPanel accountId={account.accountId} onBack={() => setAppMode("landing")} />;
  }

  if (appMode === "landing") {
    return (
      <LandingScreen
        onChoosePassAndPlay={handleChoosePassAndPlay}
        onChooseCreateRoom={handleCreateRoom}
        onChooseJoinRoom={{ lookup: handleLookupRoom, confirm: handleConfirmJoin }}
        showAdminPanelLink={isAdmin}
        onOpenAdminPanel={() => setAppMode("adminPanel")}
        accountDisplayName={account?.displayName || ""}
        onLogout={account ? onLogout : null}
      />
    );
  }

  if (appMode === "passandplay") {
    const match = localStore.match;
    const map = MAPS[passAndPlayMapId];
    const mrxName = () => map.mrxName || "Mr. X";
    const detectiveName = (id) => (map.characterNames && map.characterNames[id]) || `Detective ${id + 1}`;

    if (!match) {
      return <SetupScreen onStart={handleStartPassAndPlay} onBack={() => setAppMode("landing")} />;
    }
    if (match.phase === "handoff") {
      return <HandoffScreen handoffFor={handoffFor} round={match.round} onReady={handleReadyForTurn} />;
    }
    if (match.phase === "ended") {
      return (
        <EndedScreen
          map={map}
          match={match}
          mrxName={mrxName}
          detectiveName={detectiveName}
          onNewGame={handleResetPassAndPlay}
        />
      );
    }
    // phase === "playing"
    return (
      <GameBoard
        map={map}
        match={match}
        myRole={null}
        mrxName={mrxName}
        detectiveName={detectiveName}
        onDetectiveMove={(detId, to, mode) => localStore.submitDetectiveMove(map, detId, to, mode)}
        onMrXMove={(to, edgeMode, ticketUsed) => localStore.submitMrXMove(map, to, edgeMode, ticketUsed)}
        onActivateDoubleMove={() => localStore.activateDoubleMove()}
        extraHeaderContent={
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "flex-end" }}>
            <EndGameEarlyButton onEndGame={() => localStore.endGameEarly()} />
          </div>
        }
      />
    );
  }

  if (appMode === "multiplayer") {
    const map = MAPS[mpMapId];
    const mrxName = () => map.mrxName || "Mr. X";
    const detectiveName = (id) => (map.characterNames && map.characterNames[id]) || `Detective ${id + 1}`;

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
      return (
        <LobbyScreen
          roomId={mpRoomId}
          roomCode={mpRoomCode}
          myPlayerId={mpPlayerId}
          myRole={mpRole}
          onRoleChanged={setMpRole}
          isHost={mpIsHost}
          onHostChanged={setMpIsHost}
          numDetectives={mpNumDetectives}
          totalPlayers={mpTotalPlayers}
          mapId={mpMapId}
          onStart={handleStartMultiplayerGame}
          onLeave={handleLeaveMultiplayer}
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
      return (
        <EndedScreen
          map={map}
          match={match}
          mrxName={mrxName}
          detectiveName={detectiveName}
          onNewGame={handleLeaveMultiplayer}
        />
      );
    }

    if (match.phase === "paused") {
      return <PausedScreen roomId={mpRoomId} myPlayerId={mpPlayerId} onResumed={() => {}} />;
    }

    // phase === "playing" -- multiplayer never shows a handoff screen;
    // each player has their own device and just waits for their turn
    // (GameBoard's "Waiting for X..." note covers that).
    const gameBoardEl = (
      <GameBoard
        map={map}
        match={match}
        myRole={mpSpectatorInfo ? "__spectator__" : mpRole}
        mrxName={mrxName}
        detectiveName={detectiveName}
        onDetectiveMove={(detId, to, mode) => supabaseStore.submitDetectiveMove(map, detId, to, mode)}
        onMrXMove={(to, edgeMode, ticketUsed) => supabaseStore.submitMrXMove(map, to, edgeMode, ticketUsed)}
        onActivateDoubleMove={() => supabaseStore.activateDoubleMove()}
        extraHeaderContent={
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <PauseVote roomId={mpRoomId} myPlayerId={mpPlayerId} />
              <EndGameVote roomId={mpRoomId} myPlayerId={mpPlayerId} />
            </div>
            <ChatPanel roomId={mpRoomId} myPlayerId={mpPlayerId} myRole={mpRole} myDisplayName={mpDisplayName} />
            <TakeoverPanel roomId={mpRoomId} myPlayerId={mpPlayerId} isHost={mpIsHost} />
          </div>
        }
      />
    );

    if (mpSpectatorInfo) {
      return (
        <SpectatorScreen replacedRole={mpSpectatorInfo.replacedRole} onLeave={handleLeaveMultiplayer}>
          {gameBoardEl}
        </SpectatorScreen>
      );
    }

    return gameBoardEl;
  }

  return null;
}
