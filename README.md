# Scotland Yard — Web Version

A hidden-movement detective board game (Scotland-Yard-style) with three maps
(a procedural city, a real-neighborhood Bengaluru map, and an illustrated
Westeros map), playable two ways:

- **Same-device pass-and-play** — everyone shares one screen, hand the
  device off between turns. Works with zero setup.
- **Online multiplayer** — create a room, share a code, each player plays
  from their own device. Requires a free Supabase project (setup below).

## Project structure

```
scotland-yard-web/
├── index.html              entry HTML page
├── package.json
├── vite.config.js
├── .env.local.example       copy to .env.local and fill in for multiplayer
├── supabase/
│   ├── schema.sql            tables + Row Level Security policies
│   └── functions.sql         RPC functions (moves, chat, room lifecycle)
└── src/
    ├── main.jsx               React entry point
    ├── App.jsx                top-level router (landing/setup/lobby/game)
    ├── maps/                  one file per map — see "Adding a new map" below
    │   ├── mapSchema.js
    │   ├── city.js
    │   ├── bengaluru.js
    │   ├── westeros.js
    │   └── index.js
    ├── lib/
    │   ├── gameEngine.js         pure game rules (the ONE source of truth)
    │   ├── localGameStore.js     pass-and-play state (React state)
    │   ├── supabaseGameStore.js  multiplayer state (Supabase Realtime)
    │   ├── supabaseClient.js     Supabase connection
    │   ├── supabaseApi.js        RPC call wrappers
    │   ├── matchStateAdapter.js  converts DB rows -> match state shape
    │   └── useChat.js            chat polling hook
    └── components/
        ├── LandingScreen.jsx      choose pass-and-play / create / join
        ├── LobbyScreen.jsx        waiting room before a multiplayer game starts
        ├── SetupScreen.jsx        map/detective picker (pass-and-play)
        ├── HandoffScreen.jsx      "pass the device to..." (pass-and-play only)
        ├── GameBoard.jsx          the board itself (shared by both modes)
        ├── EndedScreen.jsx        results screen (shared by both modes)
        ├── ChatPanel.jsx          two-channel chat (All Players / Detectives)
        └── MapBackground.jsx     per-map decorative art
```

## Running locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Same-device pass-and-play works
immediately with no further setup. Online multiplayer needs the Supabase
setup below first.

---

## Setting up online multiplayer (Supabase)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in → **New Project**.
2. Pick a name, set a database password (save it), pick a nearby region.
3. Wait ~2 minutes for it to finish provisioning.

### 2. Run the database setup

1. In your Supabase project, open **SQL Editor** (left sidebar) → **New query**.
2. Paste the entire contents of `supabase/schema.sql`, click **Run**.
3. New query again → paste the entire contents of `supabase/functions.sql` → **Run**.

Both files are safe to re-run if you ever need to (they use
`create table if not exists` / `create or replace function` throughout).

### 3. Get your API keys

Go to **Project Settings → API**. You need two values:
- **Project URL** (e.g. `https://xxxxx.supabase.co`)
- **anon public** key (a long string starting with `eyJ...`)

Do **not** use the `service_role` key anywhere in this project — it
bypasses all the security rules and must never be shipped to a browser.

### 4. Configure locally

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in the two values from step 3:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Restart `npm run dev` if it was already running. Online multiplayer should
now work locally.

### 5. Configure on Vercel (for the deployed site)

1. Go to your Vercel project → **Settings → Environment Variables**.
2. Add both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same
   values as your `.env.local`.
3. Redeploy (or push a new commit — Vercel redeploys automatically).

---

## How the two modes work under the hood

Both modes share the exact same game rules (`src/lib/gameEngine.js`) and
the exact same board UI (`src/components/GameBoard.jsx`). They differ only
in *where the game state lives*:

- **Pass-and-play**: state lives in React state on one device
  (`localGameStore.js`). Nothing is hidden from the browser itself — the
  hiding of Mr. X's position is purely a UI convention (his dot just isn't
  drawn except on his own turn), since there's only one device and it's
  trusted to show the right thing at the right time.

- **Multiplayer**: state lives in Supabase Postgres. Mr. X's real position
  is enforced-hidden at the database level via Row Level Security — a
  detective's browser genuinely cannot fetch Mr. X's true position, even
  by inspecting network traffic in devtools, because that data is never
  sent to it in the first place. See the comments at the top of
  `supabase/schema.sql` for the full explanation of how this works.

Move legality (is there really a taxi route between these two stations) is
checked in the browser (`gameEngine.js`) before either mode submits a
move. The multiplayer RPC functions additionally check *identity* (are
you really who you claim to be) and *turn order* (is it really your turn)
server-side, but do not re-derive full map-graph legality in SQL — this
was a deliberate simplicity tradeoff for a private game played with
friends, not hardened against a determined cheater with devtools open.
See the comments at the top of `supabase/functions.sql` for more, and how
to upgrade this later if it's ever needed.

## Adding a new map

Every map is one self-contained file in `src/maps/`. To add one:

1. Copy `src/maps/city.js` (the minimal template) or `src/maps/westeros.js`
   (the fullest template, with custom background art, region hulls, and a
   full name-theme reskin) as a starting point.
2. Fill in your station coordinates, edges, names, etc. See the comment
   block at the top of `src/maps/mapSchema.js` for the full shape every
   map config must follow.
3. Register it with one line in `src/maps/index.js`.

That's it — no changes needed anywhere else. The board renderer, the game
engine, the multiplayer sync, and the map picker on both the pass-and-play
setup screen and the "Create Room" screen all read the map list
generically.

If your map wants custom background art (not just the default parchment
look), add a matching `case` in `src/components/MapBackground.jsx` — see
the comments there for the two existing examples (Bengaluru's
Google-Maps-style look, Westeros's illustrated regions).

### Checking your work while editing a map

Hand-editing coordinate/edge arrays is error-prone (typos in station
numbers, a station left with zero connections, etc.) and mistakes used to
only surface as a confusing crash once the app was already running. Two
tools close that gap:

**1. The validator script** — run after editing any map file, before
deploying:

```bash
node src/maps/validateMap.js city        # check one map
node src/maps/validateMap.js             # check all registered maps
```

It reports duplicate/missing stations, edges pointing at stations that
don't exist, unreachable stations (zero connections), coordinates outside
the map's canvas, and a few other common mistakes — as a plain list, with
enough detail to go fix the actual line.

**2. The map preview page** — a live visual check, no game required:

```bash
npm run dev
# then open http://localhost:5173/preview
```

Pick a map from the top bar to see it rendered exactly as it will look in
the game. Click any station to see its raw data (position, connections,
name) in the sidebar. A summary card flags the same issues the validator
catches, updated live as you edit and refresh. This is also available on
your deployed site at `https://your-game.vercel.app/preview` if you want
to sanity-check a map without running anything locally.

Typical editing loop: open `src/maps/city.js` and the `/preview` page side
by side, change a coordinate or edge, save, refresh the preview tab, look.


## Notes on the current build

- Same-device pass-and-play works with zero configuration.
- Online multiplayer requires the Supabase setup above.
- Chat has two channels: "All Players" (everyone, including Mr. X) and
  "Detectives Only" (hidden from Mr. X's client both in the UI and at the
  database level).
- Designed for a 1920×1080 (16:9) desktop/laptop screen; the sidebar (log,
  tickets, chat) and the map share the full width of the browser window.
- Three maps: Simplified City, Bengaluru (real neighborhoods, diagonal
  metro lines), and Westeros (illustrated fantasy map, Game of Thrones
  theme).
