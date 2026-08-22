import React, { useState } from "react";
import { MODE_DEFAULT } from "../maps/mapSchema.js";
import { DETECTIVE_COLORS } from "../lib/gameEngine.js";

// ---------------------------------------------------------------------------
// RULEBOOK — a single, shared, full-screen overlay explaining how to play,
// opened the same way from every screen that needs it (LandingScreen,
// SetupScreen, LobbyScreen, and a help icon on GameBoard). One component,
// one source of truth, instead of the rules text getting copy-pasted and
// drifting between screens (which is what SetupScreen's old inline
// `rulesBox` was already starting to become).
//
// Diagrams here are small custom SVGs built directly from the game's own
// MODE_DEFAULT palette and DETECTIVE_COLORS (not static screenshots) --
// so if the route colors or detective palette are ever retuned, this
// rulebook updates automatically instead of quietly going stale like a
// screenshot would. mrxName/detectiveName let it reskin correctly for
// character-named maps (e.g. City of Sendhwa), same pattern GameBoard
// itself uses.
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: "objective", label: "Objective" },
  { id: "board", label: "The board & transport" },
  { id: "tickets", label: "Tickets" },
  { id: "turns", label: "Turn order & rounds" },
  { id: "staying", label: "Staying put" },
  { id: "reveals", label: "Reveal rounds" },
  { id: "winning", label: "Winning the game" },
  { id: "controls", label: "On-screen controls" },
  { id: "multiplayer", label: "Multiplayer extras" },
];

export default function RulebookView({ onClose, mrxName, detectiveName, modeTheme, startOnSection }) {
  const [activeSection, setActiveSection] = useState(startOnSection || "objective");
  // modeTheme lets the rulebook's diagrams/copy reflect a map's custom
  // transport names (e.g. Westeros's "Horse"/"Raven"/"Dragon" instead of
  // "Taxi"/"Bus"/"Underground") -- same reskin idea as mrxName/
  // detectiveName above. Falls back to the generic palette when no map
  // is loaded yet (e.g. opened from LandingScreen).
  const activeMode = modeTheme || MODE_DEFAULT;
  const mrxLabel = mrxName ? mrxName() : "Mr. X";
  const detLabel = (n) => (detectiveName ? detectiveName(n) : `Detective ${n + 1}`);

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <div style={styles.title}>How to Play</div>
        <button style={styles.closeBtn} onClick={onClose}>
          ✕ Close
        </button>
      </div>

      <div style={styles.body}>
        <nav style={styles.nav}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{ ...styles.navBtn, ...(activeSection === s.id ? styles.navBtnActive : {}) }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div style={styles.content}>
          {activeSection === "objective" && <ObjectiveSection mrxLabel={mrxLabel} detLabel={detLabel} />}
          {activeSection === "board" && <BoardSection activeMode={activeMode} mrxLabel={mrxLabel} />}
          {activeSection === "tickets" && <TicketsSection activeMode={activeMode} mrxLabel={mrxLabel} />}
          {activeSection === "turns" && <TurnsSection mrxLabel={mrxLabel} detLabel={detLabel} />}
          {activeSection === "staying" && <StayingSection mrxLabel={mrxLabel} />}
          {activeSection === "reveals" && <RevealsSection mrxLabel={mrxLabel} />}
          {activeSection === "winning" && <WinningSection mrxLabel={mrxLabel} detLabel={detLabel} />}
          {activeSection === "controls" && <ControlsSection activeMode={activeMode} mrxLabel={mrxLabel} />}
          {activeSection === "multiplayer" && <MultiplayerSection mrxLabel={mrxLabel} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small reusable pieces
// ---------------------------------------------------------------------------
function SectionTitle({ children }) {
  return <h2 style={styles.sectionTitle}>{children}</h2>;
}
function P({ children }) {
  return <p style={styles.p}>{children}</p>;
}
function DiagramCard({ children, caption }) {
  return (
    <div style={styles.diagramCard}>
      <div style={styles.diagramBox}>{children}</div>
      {caption && <div style={styles.diagramCaption}>{caption}</div>}
    </div>
  );
}

// A tiny 5-station example board, built purely from MODE_DEFAULT colors so
// it's always visually consistent with whatever palette the live game uses.
function ExampleBoardSVG({ activeMode, highlightMode }) {
  const stations = [
    { id: "A", x: 20, y: 60 },
    { id: "B", x: 60, y: 30 },
    { id: "C", x: 100, y: 60 },
    { id: "D", x: 60, y: 90 },
    { id: "E", x: 140, y: 35 },
  ];
  const edges = [
    { a: "A", b: "B", mode: "taxi" },
    { a: "B", b: "C", mode: "taxi" },
    { a: "A", b: "D", mode: "bus" },
    { a: "D", b: "C", mode: "bus" },
    { a: "C", b: "E", mode: "underground" },
    { a: "B", b: "E", mode: "underground" },
  ];
  const pos = Object.fromEntries(stations.map((s) => [s.id, s]));
  const dim = (mode) => (highlightMode && highlightMode !== mode ? 0.22 : 1);
  return (
    <svg viewBox="0 0 160 110" style={{ width: "100%", maxWidth: 360, height: "auto" }}>
      {edges.map((e, i) => {
        const p1 = pos[e.a];
        const p2 = pos[e.b];
        return (
          <line
            key={i}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={activeMode[e.mode].color}
            strokeWidth={e.mode === "underground" ? 4 : 3}
            opacity={dim(e.mode)}
            strokeLinecap="round"
          />
        );
      })}
      {stations.map((s) => (
        <g key={s.id}>
          <circle cx={s.x} cy={s.y} r="7" fill="#fff" stroke="#8a8375" strokeWidth="1.5" />
          <text x={s.x} y={s.y + 3} fontSize="7" textAnchor="middle" fontWeight="700" fill="#3a3a3a">
            {s.id}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ModeLegendRow({ activeMode, mode, description }) {
  return (
    <div style={styles.legendRow}>
      <span style={{ ...styles.legendSwatch, background: activeMode[mode].color }} />
      <div>
        <b>{activeMode[mode].label}</b>
        <div style={styles.legendDesc}>{description}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function ObjectiveSection({ mrxLabel, detLabel }) {
  return (
    <>
      <SectionTitle>Objective</SectionTitle>
      <P>
        One player is <b>{mrxLabel}</b>, moving in secret across the map. Everyone else is a detective, working together to
        figure out where {mrxLabel} is and catch them before time runs out.
      </P>
      <div style={styles.roleGrid}>
        <div style={styles.roleCard}>
          <div style={{ ...styles.roleDot, background: "#1a1a1a" }} />
          <b>{mrxLabel}</b>
          <P>
            Moves secretly every round. Detectives never see where {mrxLabel} is directly — only the type of ticket used
            for each move, and their exact position on scheduled reveal rounds.
          </P>
        </div>
        <div style={styles.roleCard}>
          <div style={{ display: "flex", gap: 4 }}>
            {DETECTIVE_COLORS.slice(0, 3).map((c, i) => (
              <div key={i} style={{ ...styles.roleDot, background: c }} />
            ))}
          </div>
          <b>Detectives (2–5 players)</b>
          <P>
            Move openly — every detective's position is visible to everyone at all times. Win by moving onto {mrxLabel}'s
            exact station.
          </P>
        </div>
      </div>
    </>
  );
}

function BoardSection({ activeMode, mrxLabel }) {
  return (
    <>
      <SectionTitle>The board & transport</SectionTitle>
      {/* -----------------------------------------------------------
          v3.32 -- THE COLOUR KEY LIVES HERE NOW.
          Up to v3.31 this key was pinned permanently to the side panel,
          on screen for the whole game. It is reference material you
          consult once or twice and then never again, so it was removed
          from constant display and folded into the rules, on demand.
          Built from the ACTIVE map's own mode theme, so a themed map
          (Auto / Cab / Metro / Secret Tunnel) shows its own names and
          colours rather than the generic defaults -- exactly what the
          side-panel legend did.
          ----------------------------------------------------------- */}
      <div style={styles.quickLegend}>
        <div style={styles.quickLegendTitle}>Route &amp; ticket colour key</div>
        <div style={styles.quickLegendRow}>
          {Object.entries(activeMode).map(([key, m]) => (
            <span key={key} style={styles.quickLegendItem}>
              <span style={{ ...styles.legendSwatch, background: m.color }} />
              {m.label}
            </span>
          ))}
        </div>
      </div>
      <P>
        Stations are connected by colored routes. Each route only supports certain transport modes — moving between two
        stations means using a ticket that matches one of the routes actually connecting them.
      </P>
      <DiagramCard caption="A small example board — taxi (short hops), bus (longer jumps), and underground (hub-to-hub) routes.">
        <ExampleBoardSVG activeMode={activeMode} />
      </DiagramCard>
      <ModeLegendRow activeMode={activeMode} mode="taxi" description="Short, frequent hops between neighboring stations." />
      <ModeLegendRow activeMode={activeMode} mode="bus" description="Covers more ground per ticket, but only along bus routes." />
      <ModeLegendRow
        activeMode={activeMode}
        mode="underground"
        description="Jumps between major interchange hubs — fast, but only a few stations connect this way."
      />
      <P>
        On real-city maps (like Bengaluru or City of Sendhwa), the board is dense — pinch, scroll, or use the +/− buttons
        to zoom in and reveal every local street and neighborhood name.
      </P>
      <P>
        Some maps also have <b>ferry routes</b> (dashed lines, over rivers or lakes) — these are {mrxLabel}-only, and
        always cost a black ticket to use.
      </P>
    </>
  );
}

function TicketsSection({ activeMode, mrxLabel }) {
  return (
    <>
      <SectionTitle>Tickets</SectionTitle>
      <P>Every move spends one ticket of the matching type. Detectives start with a limited supply of each.</P>
      <ModeLegendRow activeMode={activeMode} mode="taxi" description="Used for taxi routes." />
      <ModeLegendRow activeMode={activeMode} mode="bus" description="Used for bus routes." />
      <ModeLegendRow activeMode={activeMode} mode="underground" description="Used for underground routes." />
      <div style={styles.legendRow}>
        <span style={{ ...styles.legendSwatch, background: "#2b2b2b" }} />
        <div>
          <b>Black ticket ({mrxLabel} only)</b>
          <div style={styles.legendDesc}>
            Works on ANY route type, and hides which transport mode was actually used on the shared travel log —
            camouflage. Also the only ticket that can be used on a ferry. {mrxLabel} has a limited number for the whole
            game.
          </div>
        </div>
      </div>
      <div style={styles.legendRow}>
        <span style={{ ...styles.legendSwatch, background: "#a0740d" }} />
        <div>
          <b>2x / Double-move card ({mrxLabel} only)</b>
          <div style={styles.legendDesc}>
            Lets {mrxLabel} make two moves back-to-back in a single turn before detectives respond. {mrxLabel} holds a
            couple of these for the whole game.
          </div>
        </div>
      </div>
      <P>
        <b>Recycling rule:</b> whenever a detective spends a ticket, that exact ticket doesn't disappear — it's handed to{" "}
        {mrxLabel}'s own pool. This is why {mrxLabel} usually ends a game holding plenty of tickets even without
        collecting any directly.
      </P>
    </>
  );
}

function TurnsSection({ mrxLabel, detLabel }) {
  const order = ["1. " + mrxLabel + " moves", "2. Planning", "3. Everyone acts"];
  return (
    <>
      <SectionTitle>Turn order & rounds</SectionTitle>
      <P>
        Each round has three phases. {mrxLabel} moves first and in secret. Then there's a shared planning window where
        detectives can preview possible destinations together but nobody can move yet. Then the acting phase begins:
        every detective player moves at the same time, not in a fixed order — each on their own clock.
      </P>
      <DiagramCard caption="One full round, repeated until the game ends.">
        <div style={styles.turnFlow}>
          {order.map((name, i) => (
            <React.Fragment key={i}>
              <div style={{ ...styles.turnChip, ...(i === 0 ? styles.turnChipMrx : {}) }}>{name}</div>
              {i < order.length - 1 && <span style={styles.turnArrow}>→</span>}
            </React.Fragment>
          ))}
          <span style={styles.turnArrow}>↻</span>
        </div>
      </DiagramCard>
      <P>
        <b>Acting phase, in detail:</b> if you control more than one detective, you move them one after another inside
        your own window — but different players are never waiting on each other. A player controlling three
        detectives simply gets a longer personal window than one controlling a single detective. The acting phase
        ends once everyone still connected has finished, or the room's outer time limit is reached, whichever comes
        first.
      </P>
      <P>
        <b>Skipping the wait:</b> every detective player can tick "Ready to act" once they're done deciding, or already
        know they have nothing left to do. The acting phase starts early only once <i>everyone</i> currently connected
        has ticked it — a single tick never fast-forwards the room on its own. If people don't tick, play still moves
        on automatically once the planning timer runs out.
      </P>
      <P>The game has a fixed number of rounds (shown at setup, and always visible during play) — if {mrxLabel} survives to the end, they win by evasion.</P>
    </>
  );
}

function StayingSection({ mrxLabel }) {
  return (
    <>
      <SectionTitle>Staying put</SectionTitle>
      <P>
        You must move if you have a legal move available — {mrxLabel} included. There's no option to voluntarily stay
        in place while a real move is still on the table.
      </P>
      <P>
        <b>Genuinely stuck is different.</b> If you truly have no legal move — no ticket that matches any route out of
        your station — you're automatically passed for that round. This costs nothing: no ticket is forfeited, and it
        isn't a choice you make, it just happens the moment the game detects you're out of options.
      </P>
    </>
  );
}

function RevealsSection({ mrxLabel }) {
  const rounds = [3, 8, 13, 18, 22];
  const total = 22;
  return (
    <>
      <SectionTitle>Reveal rounds</SectionTitle>
      <P>
        {mrxLabel}'s exact station is hidden almost every round — except on a handful of scheduled reveal rounds, fixed
        for the whole game and known to every player in advance (shown on the travel log throughout play).
      </P>
      <DiagramCard caption={`Example: a ${total}-round game with reveal rounds at ${rounds.join(", ")}.`}>
        <div style={styles.timelineWrap}>
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
            <div key={n} style={{ ...styles.timelineDot, ...(rounds.includes(n) ? styles.timelineDotReveal : {}) }} title={`Round ${n}`} />
          ))}
        </div>
        <div style={styles.timelineLegendRow}>
          <span style={{ ...styles.timelineDot, ...styles.timelineDotReveal, position: "static" }} />
          <span>Reveal round — {mrxLabel}'s station is shown on the map for that move only</span>
        </div>
      </DiagramCard>
      <P>
        Outside of reveal rounds, detectives still see the TYPE of ticket {mrxLabel} used each turn on the shared travel
        log (unless it was camouflaged with a black ticket) — enough to narrow down possibilities, even without knowing
        the exact station.
      </P>
      <P>
        Longer or shorter maps automatically scale their own reveal schedule proportionally — the exact round numbers
        shown in your game may differ from this example.
      </P>
    </>
  );
}

function WinningSection({ mrxLabel, detLabel }) {
  return (
    <>
      <SectionTitle>Winning the game</SectionTitle>
      <div style={styles.roleGrid}>
        <div style={styles.roleCard}>
          <b>Detectives win if...</b>
          <P>Any detective ever moves onto the exact station {mrxLabel} is currently occupying.</P>
        </div>
        <div style={styles.roleCard}>
          <b>{mrxLabel} wins if...</b>
          <P>
            {mrxLabel} survives every round of the game without being caught, or if {mrxLabel} ever moves onto a
            station a detective is standing on (walking into a detective is treated the same as being caught).
          </P>
        </div>
      </div>
      <P>
        After the game ends, {mrxLabel}'s entire hidden route is revealed to everyone, and can be stepped through move
        by move using the <b>Replay</b> feature on the results screen.
      </P>
    </>
  );
}

function ControlsSection({ activeMode, mrxLabel }) {
  return (
    <>
      <SectionTitle>On-screen controls</SectionTitle>
      <P>Quick reference for what you'll see and use during a live game:</P>
      <ul style={styles.controlList}>
        <li>
          <b>Tapping a station</b> proposes a move there (if it's currently reachable with a ticket you have) — confirm
          in the popup that appears.
        </li>
        <li>
          <b>Zoom controls (+/−, or pinch/scroll)</b> reveal more detail on dense real-city maps.
        </li>
        <li>
          <b>Route explorer</b> (planning phase, if enabled for the room) lets you preview reachable stations ahead
          without committing to anything.
        </li>
        <li>
          <b>"All detectives" / "My detectives" toggle</b> (top-left of the map, planning phase) switches whether you
          see everyone's origin/destination previews or just your own — useful once the board gets crowded.
        </li>
        <li>
          <b>Travel log</b> (sidebar) shows every move {mrxLabel} has made so far by ticket type, and marks upcoming and
          past reveal rounds.
        </li>
        <li>
          <b>Auto-pass</b> — if you genuinely have no legal moves, you're passed automatically for that round, free of
          charge, no click required. See "Staying put."
        </li>
        <li>
          <b>Ready to act</b> (top-right, planning phase, detectives only) — tick when you're done previewing to vote
          for an early start to the acting phase.
        </li>
        <li>
          <b>2x button</b> ({mrxLabel} only, top-right during {mrxLabel}'s own turn) activates a double-move card,
          adding extra time to that turn's clock.
        </li>
      </ul>
    </>
  );
}

function MultiplayerSection({ mrxLabel }) {
  return (
    <>
      <SectionTitle>Multiplayer extras</SectionTitle>
      <P>Online rooms have a few coordination features beyond the core rules:</P>
      <ul style={styles.controlList}>
        <li>
          <b>Pause / Resume</b> — any player can propose a pause; resuming needs everyone still active to agree (or it
          resolves automatically after a set time).
        </li>
        <li>
          <b>End game early</b> — ends the match by unanimous vote among active players, without waiting for a normal
          win condition.
        </li>
        <li>
          <b>Takeover</b> — if a player disconnects, another player can take over their seat (including {mrxLabel}'s)
          so the game isn't stuck waiting on someone who's gone. A takeover can also be reversed by vote if the
          original player reconnects.
        </li>
        <li>
          <b>Redistribute roles</b> — the host can propose reshuffling who plays which seat mid-lobby, if enabled for
          the room; needs everyone's agreement.
        </li>
        <li>
          <b>Chat</b> — detectives share one channel; {mrxLabel} is deliberately left out of it, matching the game's own
          information asymmetry.
        </li>
        <li>
          <b>Room setup</b> — the host picks the map, detective count, timers, room visibility (private code-only or
          public/listed), and which of the above features are switched on, all before the game starts. Seat colors and
          (on character-named maps) detective names are also customizable in the lobby.
        </li>
      </ul>
    </>
  );
}

const styles = {
  quickLegend: {
    border: "1px solid #e6e2d8",
    background: "#fbfaf7",
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 14,
  },
  quickLegendTitle: { fontSize: 12, fontWeight: 800, color: "#5b4636", marginBottom: 8, letterSpacing: 0.3, textTransform: "uppercase" },
  quickLegendRow: { display: "flex", flexWrap: "wrap", gap: "8px 16px" },
  quickLegendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#333" },

  overlay: {
    position: "fixed",
    inset: 0,
    background: "#f7f6f3",
    zIndex: 2500,
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #e5e2d8",
    background: "#fff",
    flexShrink: 0,
  },
  title: { fontSize: 18, fontWeight: 700 },
  closeBtn: {
    border: "1px solid #ddd",
    background: "#fff",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    cursor: "pointer",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  nav: {
    width: 220,
    flexShrink: 0,
    borderRight: "1px solid #e5e2d8",
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    padding: 10,
    gap: 4,
    overflowY: "auto",
  },
  navBtn: {
    textAlign: "left",
    border: "none",
    background: "transparent",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13.5,
    fontWeight: 600,
    color: "#555",
    cursor: "pointer",
  },
  navBtnActive: {
    background: "#eef0ff",
    color: "#2937c9",
  },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 32px",
    maxWidth: 720,
  },
  sectionTitle: { fontSize: 20, fontWeight: 800, marginBottom: 10 },
  p: { fontSize: 14.5, lineHeight: 1.6, color: "#333", marginBottom: 12 },
  diagramCard: {
    border: "1px solid #e5e2d8",
    borderRadius: 12,
    background: "#fff",
    padding: 16,
    marginBottom: 16,
  },
  diagramBox: { display: "flex", justifyContent: "center" },
  diagramCaption: { fontSize: 12.5, color: "#888", textAlign: "center", marginTop: 8 },
  legendRow: { display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 },
  legendSwatch: { width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2 },
  legendDesc: { fontSize: 13, color: "#666", marginTop: 2, lineHeight: 1.5 },
  roleGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 },
  roleCard: { border: "1px solid #e5e2d8", borderRadius: 12, padding: 14, background: "#fff" },
  roleDot: { width: 18, height: 18, borderRadius: "50%", marginBottom: 8 },
  turnFlow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  turnChip: {
    border: "1px solid #ddd",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 600,
    background: "#f5f5f5",
  },
  turnChipMrx: { background: "#1a1a1a", color: "#fff", borderColor: "#1a1a1a" },
  turnArrow: { color: "#999", fontSize: 15 },
  timelineWrap: { display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" },
  timelineDot: { width: 14, height: 14, borderRadius: "50%", background: "#e2ddce", border: "1px solid #d3cdb8" },
  timelineDotReveal: { background: "#c12115", border: "1px solid #8f1710" },
  timelineLegendRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5, color: "#666" },
  controlList: { margin: "0 0 12px 18px", padding: 0, lineHeight: 1.7, fontSize: 14 },
};
