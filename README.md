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

### 6. Set up access control (recommended before sharing your deployed link)

By default, once online multiplayer is configured, the app is **private**:
new visitors must either request access (you relay a one-time code to
them) or use an invite code from someone already approved.

1. In Supabase SQL Editor, run `supabase/access_control_schema.sql`, then
   `supabase/access_control_functions.sql` (in that order).

   **If you already ran these files before** (i.e. you're updating an
   existing deployment, not setting one up fresh), also run
   `supabase/migration_rename_owner_to_admin.sql` — this safely renames
   the internal `is_owner` column to `is_admin` without losing any
   existing data, then re-run `access_control_functions.sql` (the updated
   version references `is_admin`, so the migration must run first).
2. Sign up at [resend.com](https://resend.com) (free tier) and get an API key.
3. In Supabase Dashboard → Edge Functions, deploy the function in
   `supabase/functions/notify-access-request/` (requires the
   [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase functions deploy notify-access-request
   ```
4. Set the two secrets it needs (via Terminal, using the Supabase CLI):
   ```bash
   supabase secrets set RESEND_API_KEY=your_resend_api_key
   supabase secrets set OWNER_EMAIL=your_own_email@example.com
   ```
   (`OWNER_EMAIL` must match the email address your Resend account is
   registered under — Resend's free tier without a verified domain can
   only send to that address.)
5. Create your own account by using the normal "Request access" flow on
   the deployed app once — you'll get the OTP emailed to `OWNER_EMAIL`.
6. In Supabase SQL Editor, mark your account as an admin:
   ```sql
   update accounts set is_admin = true where username = 'your_chosen_username';
   ```
7. Log back in — you'll now see an "Admin Panel" link on the landing
   screen, where you can adjust invite-code limits, review pending
   requests, toggle public/private mode, activate/deactivate individual
   maps, and set turn-timer bounds + the default invite-code limit for
   new accounts.

**What the Admin Panel controls:**
- **Public/private mode** — toggle whether "Continue as guest" is offered.
- **Maps** — deactivate a map (e.g. while it's being edited/tested) so it
  stops appearing in the map picker, without deleting its code. Reactivate
  any time.
- **Game settings** — the min/max bounds a host can pick a room's turn
  timer from, and the default invite-code limit newly issued codes start
  with (existing codes keep whatever limit they already had). Note: the
  turn-timer minimum can never be set below 15 seconds, even if you enter
  a lower number — this is enforced in the database itself, since going
  lower risks conflicting with how inactive-player detection works.
- **Accounts table** — see every account, who invited them, their
  invite-code usage, and adjust any account's invite limit or regenerate
  their code.
- **Pending requests** — see who's waiting on an OTP (new signups or
  invite-code upgrades) so you know who to relay a code to.

**How people get in:**
- **You approve them directly**: they use "Request access", you get an
  email with a one-time code, you relay it to them yourself (text, call,
  in person), they enter it and set a password.
- **Someone you approved invites their own friends**: every approved
  account gets a reusable invite code (default limit: 20 uses, adjustable
  per-account in the Admin Panel). Their friends use "I have an invite
  code" instead of requesting access from you — no OTP needed.
- **Public mode** (toggle in the Admin Panel): also allows anyone to
  "Continue as guest" with just a name, no account at all. Useful for a
  one-off open game night; switch back to private afterward and existing
  guest sessions simply won't be re-honored on their next visit.

### Data cleanup (recommended, keeps your database tidy)

Rooms don't clean themselves up automatically unless you set this up.
Without it, ended games and abandoned lobbies just sit in your database
forever.

1. In Supabase SQL Editor, run `supabase/data_cleanup.sql`.
2. **Note:** this uses the `pg_cron` Postgres extension, which is
   available on Supabase's hosted plans but may not be enabled by
   default on every project tier — if the `create extension` line fails,
   check **Database → Extensions** in your Supabase dashboard and enable
   `pg_cron` manually first, then re-run the file.
3. Once set up, a scheduled job runs every 30 minutes and deletes:
   - Rooms whose game ended more than 1 hour ago (gives players time to
     see the results screen first).
   - Lobbies nobody ever started a game in, after 24 hours.
4. To verify it's running: `select * from cron.job_run_details order by start_time desc limit 10;`
   in the SQL Editor.
5. To clean up manually right now (e.g. for testing): `select cleanup_stale_rooms();`

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
