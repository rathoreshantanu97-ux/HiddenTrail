import React, { useState, useEffect } from "react";
import { MAPS } from "./maps/index.js";
import { useLocalGameStore } from "./lib/localGameStore.js";
import { useSupabaseGameStore } from "./lib/supabaseGameStore.js";
import * as api from "./lib/supabaseApi.js";
import LandingScreen from "./components/LandingScreen.jsx";
import LobbyScreen from "./components/LobbyScreen.jsx";
import SetupScreen from "./components/SetupScreen.jsx";
import HandoffScreen from "./components/HandoffScreen.jsx";
import GameBoard from "./components/GameBoard.jsx";
import EndedScreen from "./components/EndedScreen.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
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
// ---------------------------------------------------------------------------

const LOCAL_ROOM_KEY = "scotlandyard_room";

export default function App() {
  const [appMode, setAppMode] = useState("landing"); // "landing" | "passandplay" | "multiplayer"

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
  const [mpMapId, setMpMapId] = useState("city");
  const [mpDisplayName, setMpDisplayName] = useState("");
  const [mpStage, setMpStage] = useState("lobby"); // "lobby" | "playing"

  const supabaseStore = useSupabaseGameStore({
    roomId: appMode === "multiplayer" ? mpRoomId : null,
    myPlayerId: mpPlayerId,
    myRole: mpRole,
  });

  // Restore a multiplayer session on refresh (room/player id persisted to
  // localStorage), so accidentally reloading the page mid-game doesn't
  // boot the player out of their seat.
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
          setMpMapId(parsed.mapId);
          setMpDisplayName(parsed.displayName);
          setAppMode("multiplayer");
          setMpStage(parsed.stage || "lobby");
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
      mapId: mpMapId,
      displayName: mpDisplayName,
      stage: mpStage,
      ...extra,
    };
    localStorage.setItem(LOCAL_ROOM_KEY, JSON.stringify(payload));
  }

  // ---- Landing screen handlers ----
  function handleChoosePassAndPlay() {
    setAppMode("passandplay");
  }

  async function handleCreateRoom({ displayName, mapId, numDetectives }) {
    const { roomId, roomCode, hostPlayerId } = await api.createRoom({
      mapId,
      numDetectives,
      hostDisplayName: displayName,
    });
    setMpRoomId(roomId);
    setMpRoomCode(roomCode);
    setMpPlayerId(hostPlayerId);
    setMpRole("mrx");
    setMpIsHost(true);
    setMpNumDetectives(numDetectives);
    setMpMapId(mapId);
    setMpDisplayName(displayName);
    setMpStage("lobby");
    setAppMode("multiplayer");
    localStorage.setItem(
      LOCAL_ROOM_KEY,
      JSON.stringify({
        roomId,
        roomCode,
        playerId: hostPlayerId,
        role: "mrx",
        isHost: true,
        numDetectives,
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
    const info = await api.lookupRoom(roomCode); // to get mapId/numDetectives for the lobby screen
    setMpRoomId(roomId);
    setMpRoomCode(roomCode);
    setMpPlayerId(playerId);
    setMpRole(role);
    setMpIsHost(false);
    setMpNumDetectives(info.numDetectives);
    setMpMapId(info.mapId);
    setMpDisplayName(displayName);
    setMpStage("lobby");
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
        mapId: info.mapId,
        displayName,
        stage: "lobby",
      })
    );
  }

  async function handleStartMultiplayerGame() {
    const map = MAPS[mpMapId];
    await supabaseStore.startGame(map);
    setMpStage("playing");
    persistMpSession({ stage: "playing" });
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

  if (appMode === "landing") {
    return (
      <LandingScreen
        onChoosePassAndPlay={handleChoosePassAndPlay}
        onChooseCreateRoom={handleCreateRoom}
        onChooseJoinRoom={{ lookup: handleLookupRoom, confirm: handleConfirmJoin }}
      />
    );
  }

  if (appMode === "passandplay") {
    const match = localStore.match;
    const map = MAPS[passAndPlayMapId];
    const mrxName = () => map.mrxName || "Mr. X";
    const detectiveName = (id) => (map.characterNames && map.characterNames[id]) || `Detective ${id + 1}`;

    if (!match) {
      return <SetupScreen onStart={handleStartPassAndPlay} />;
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
      />
    );
  }

  if (appMode === "multiplayer") {
    const map = MAPS[mpMapId];
    const mrxName = () => map.mrxName || "Mr. X";
    const detectiveName = (id) => (map.characterNames && map.characterNames[id]) || `Detective ${id + 1}`;

    if (mpStage === "lobby") {
      return (
        <LobbyScreen
          roomId={mpRoomId}
          roomCode={mpRoomCode}
          myPlayerId={mpPlayerId}
          myRole={mpRole}
          isHost={mpIsHost}
          numDetectives={mpNumDetectives}
          mapId={mpMapId}
          onStart={handleStartMultiplayerGame}
        />
      );
    }

    const match = supabaseStore.match;
    if (!match) {
      return <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>Loading game state...</div>;
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

    // phase === "playing" -- multiplayer never shows a handoff screen;
    // each player has their own device and just waits for their turn
    // (GameBoard's "Waiting for X..." note covers that).
    return (
      <GameBoard
        map={map}
        match={match}
        myRole={mpRole}
        mrxName={mrxName}
        detectiveName={detectiveName}
        onDetectiveMove={(detId, to, mode) => supabaseStore.submitDetectiveMove(map, detId, to, mode)}
        onMrXMove={(to, edgeMode, ticketUsed) => supabaseStore.submitMrXMove(map, to, edgeMode, ticketUsed)}
        onActivateDoubleMove={() => supabaseStore.activateDoubleMove()}
        extraHeaderContent={
          <div style={{ marginBottom: 10 }}>
            <ChatPanel roomId={mpRoomId} myPlayerId={mpPlayerId} myRole={mpRole} myDisplayName={mpDisplayName} />
          </div>
        }
      />
    );
  }

  return null;
}
