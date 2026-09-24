# +1 Ronaldo Obby Escape

A production browser multiplayer obby game. Three.js + TypeScript on the client,
Colyseus + Node.js on the server, in an npm-workspaces monorepo.

It is +1 Backflip Obby Escape reskinned as a football / Cristiano Ronaldo
game, with every system kept exactly as it was:

- **Win Shop -> Ronaldo characters.** Nine full-body Ronaldos stand on the
  shop pedestals, one per era of his career. Walk onto one holding enough Wins
  and you BECOME him - body, head, hair and kit - replacing your avatar. Same
  nine tiers, prices and Speed per step as the boots they replace.
- **Backflip -> Siuuu.** Every backflip plays as Ronaldo's celebration - a
  leaping spin into the SIU stance - with the flip's lift, forward push and
  chaining unchanged.
- **Japan -> football.** The shrine gorge is now a stadium: a giant goal over
  the gorge mouth, a grandstand, floodlights, LED hoardings, flags and bunting,
  with the islands named after his career.

The Ronaldos, the stadium and every sign are drawn procedurally at runtime -
no image files - so the build stays inside the 12 MB budget.

"Roblox-inspired" describes the **visual and gameplay style only** — this is not
a Roblox Studio project and uses no game engine. See [CLAUDE.md](CLAUDE.md) for
the permanent project rules and game design constraints.

## Prerequisites

- **Node.js >= 20.11** (developed on 22.17)
- **npm >= 10** (workspaces)
- A WebGL2-capable browser

## Install

```bash
npm install
```

That installs all three workspaces at once. No per-workspace install needed.

## Development

Run both the server and the client together:

```bash
npm run dev
```

- Client: <http://localhost:5173>
- Server: `ws://localhost:2567`

Vite binds to all interfaces, so a phone on the same LAN can reach the client at
`http://<your-lan-ip>:5173` (set `VITE_SERVER_URL` if the server is elsewhere).

### Running them separately

```bash
npm run dev:server
```

```bash
npm run dev:client
```

`shared/` compiles to `shared/dist` and both consumers read from there, so build
it first if you start a workspace directly:

```bash
npm run build:shared
```

### Other commands

| Command                  | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `npm run typecheck`      | Type-checks every workspace                           |
| `npm run build`          | Production build of shared + server + client          |
| `npm start`              | Runs the compiled server from `server/dist`           |
| `npm run inspect:fbx`    | Dumps bones, meshes and texture paths from player.fbx |
| `npm run verify:assets`  | Checks the player assets are present and unmodified   |
| `npm run verify:persistence` | Account/guest persistence + Bux grants against the built server |

Environment variables: `PORT`, `HOST`, `MONGODB_URI`, `OBBY_DATA_DIR`, `BLOXITY_GAME_SLUG`
and `BLOXITY_WEBHOOK_SECRET` on the server; `VITE_SERVER_URL`, `VITE_DEBUG=1`
and (dev only) `VITE_BLOXITY_PORTAL_URL` / `VITE_BLOXITY_API_URL` on the
client.

### Bloxity

The game integrates the Bloxity SDK for identity, avatars, friends, portal
settings and Bux. Two things need configuring outside the code:

- **`BLOXITY_WEBHOOK_SECRET`** on the game server. Bloxity POSTs confirmed
  purchases to `/bloxity/bux-webhook` with an `x-legion-webhook-secret` header;
  without the secret set the endpoint refuses everything, because a route that
  mints currency must not be open by default. `GET /health` reports whether it
  is configured.
- **Logging in from a dev machine.** Served from localhost with no URLs given,
  the SDK points its portal and API at the local origin, so login would open
  `http://localhost:5173/auth`. Set `VITE_BLOXITY_PORTAL_URL=https://bloxity.io`
  and `VITE_BLOXITY_API_URL=https://api.bloxity.io` to reach the real portal.
  Leave both unset in production - the SDK's own defaults are correct there.

### Deploying to Bloxity Hosting

`.github/workflows/deploy.yml` deploys both halves of one commit, and the
branch picks the channel:

| Branch | Channel | Backend |
| ------ | ------- | ------- |
| `dev`  | `dev`   | `wss://ronaldo-obby-escape.dev.host.bloxity.io` |
| `main` | `prod`  | `wss://ronaldo-obby-escape.host.bloxity.io` |

The server is built by the root `Dockerfile`, pushed to GHCR tagged with the
commit SHA, and deployed to the channel; the client is then built with that
channel's `VITE_SERVER_URL`, zipped with `index.html` at the archive root and
uploaded. The SERVER GOES FIRST on purpose - the Colyseus schema is shared, so
a client that ships ahead of its server speaks a protocol the server does not
have yet.

Required once, in **Settings > Secrets and variables > Actions**:

- **`LEGION_DEPLOY_TOKEN`** (secret). Never committed; the workflow reads it
  from `secrets` and passes it to `curl` through the environment so it cannot
  appear in a rendered command line.

Still to fill in: the two `BLOXITY_*_URL` values at the top of the workflow.
They are blank because Bloxity's hosting API is documented behind the developer
login at <https://dev.bloxity.io/hosting/docs> and is not public - a guessed
route would POST a build somewhere that may not exist. The `preflight` job
fails with instructions until both are set.

**Saved progress on Bloxity lives in Bloxity's managed MongoDB.** Bloxity
Hosting injects `MONGODB_URI` into every pod, and whenever it is set the server
stores profiles there instead of on disk - the container's disk is replaced on
every deploy and on every scale-to-zero, which is why progress used to vanish
after an update. Nothing needs configuring. After a deploy, the server log
should show `using Bloxity managed MongoDB (MONGODB_URI)` followed by
`[persistence/mongo] connected to database "..."`; if it shows the JSON-file
warning instead, the variable is not reaching the pod.

While the database is unreachable the server stays up (`/health` keeps
answering) but refuses joins with a "please try again" message (the client
retries), rather than starting anyone from zero and later saving that zero over
their progress. Each join re-reads that player's profile from the database, and
every save touches only that player's own document, so several pods never roll
each other back. A `profiles.json` found in `OBBY_DATA_DIR` is imported into the
database on boot, insert-only - it never replaces anything already there.

**A signed-in player's progress follows their Bloxity ACCOUNT**, on every
browser and device. The client sends the SDK's login TOKEN (never an account
id) with the join and again whenever the login changes; the server asks Bloxity
who it belongs to (`POST https://api.bloxity.io/v1/auth/game-token/verify`, body
`{ gameSlug }`) and plays them on `bloxity:<account id>`. Guests keep the
browser's localStorage id as before. An account's first verified login moves
that browser's guest progress onto it, if the account has none yet; an account
that already has progress is never overwritten by a browser's.

The token is checked against the game's bloxity.io slug,
**`ronaldo-obby-escape`** (`shared/src/config/bloxity.ts`) - a separate
registration from the hosting id (`BLOXITY_GAME_ID` in the deploy workflow),
even though both are spelled `ronaldo-obby-escape` here. A token is a
capability for one game; verifying it against any other slug rejects every
signed-in player and progress silently stays per-browser.

**Bux purchases** are recorded durably by the webhook (keyed by transaction id,
so a retried webhook pays once across pods and restarts), addressed to the
Bloxity account that paid, and handed over when that account is verified in a
room. The four SKUs (`wins_pouch`, `wins_sack`, `wins_chest`, `wins_vault`)
must exist in Bloxity's catalogue under `ronaldo-obby-escape`.

`npm run verify:persistence` checks all of this against the built server with
real clients (only Bloxity's verify URL is stubbed); see the header of
`scripts/verify-persistence.mjs` for running it against MongoDB.

### Deploying elsewhere

The client is also configured as a static build (Netlify, `netlify.toml`) and
the server as a long-running Node process (Render). Those remain valid and
independent of the Bloxity workflow. Two settings decide whether either
deployment behaves like the dev setup:

- **`VITE_SERVER_URL`** is baked into the client at BUILD time, so it must be
  set on the host that runs `npm run build:client` - changing it later means
  rebuilding. Over HTTPS it has to be a `wss://` URL.
- **Set `MONGODB_URI`, or point `OBBY_DATA_DIR` at storage that survives a
  restart.** With a database URI the directory is unused. Without one it
  defaults to `data/` beside the server, which on a container host is part of
  the image and is thrown away on every deploy and every cold start. Profiles
  are the ONLY record of what players have earned, and the leaderboards rank
  exactly that, so an ephemeral data directory means a server that begins with
  nobody having earned anything - three empty boards - after each restart.
  Mount a persistent disk and point `OBBY_DATA_DIR` at it. The line
  `[ProfileStore] store="json-file" profiles=N` in the boot log is the check:
  N is the population the boards can rank.

## Project structure

```text
assets/player/        player.fbx (canonical), base_rig.fbx (unused dupe), green.png
client/               Vite + Three.js + TypeScript
  src/animation/      PlayerAnimator (state machine), LocomotionCycle,
                      BackflipAnimator, PoseBuffer, AnimationInput,
                      rig/PlayerRig + rig/boneNames
  src/camera/         ThirdPersonCamera
  src/config/         client, asset and player-visual configuration
  src/core/           Game (composition root), GameLoop
  src/input/          InputManager, KeyboardSource, InputState
  src/net/            NetworkClient (only place colyseus.js is imported)
  src/player/         PlayerModelLoader, PlayerCharacter, LocalPlayer,
                      RemotePlayer, RemotePlayerManager
  src/progression/    ProgressionStore (mirrors server values), RunController
  src/rendering/      RendererManager (+ resize), SceneManager (+ lighting)
  src/ui/             ProgressHud (Speed/level/jump bar), WinsCounter,
                      SpeedPopups, RebirthPanel, TreadmillHud,
                      DebugOverlay (diagnostics)
  src/world/          GorgeWorld, GorgeCollision (re-export), GorgeTerrain,
                      TrophyPlatforms, Redlines, Foliage, SpawnArea, BootShop,
                      Treadmills, WorldTextures
server/               Colyseus + TypeScript
  src/config/         serverConfig
  src/movement/       MovementService (authoritative simulation)
  src/persistence/    PersistenceAdapter (the boundary), JsonFilePersistence,
                      MongoPersistence, Bux grant stores,
                      createPersistence (the only place naming an adapter)
  src/progression/    ProgressionService, TrophyService, SpeedService,
                      BootService, RebirthService, TreadmillService,
                      ProfileStore (all server-authoritative)
  src/rooms/          GorgeRoom + state/{PlayerState,GorgeState}
  src/util/           logger
shared/               Types and constants identical on both sides
  src/config/         movement, camera, backflip, boots, progression,
                      progressionGain, rebirth, speed, treadmills, gorge
                      (all data-driven; gorge.ts owns the whole world layout)
  src/constants/      network, world
  src/sim/            PlayerSim (the physics step), WorldCollision
  src/types/          math, player, messages
scripts/              inspect-fbx.mjs, verify-assets.mjs (zero-dependency)
```

Assets are served straight out of the repo-level `assets/` folder via Vite's
`publicDir`, so there is **no duplicate copy** of the FBX inside `client/`.

## Current milestone

**Milestone 13 — camera stability and map defect fixes.**

1. **Camera vibration removed at source.** The renderer ran at 144Hz over a
   60Hz simulation with no interpolation, the camera followed the raw
   simulated position while the character rendered at a corrected one, and the
   camera smoothed its position but not its look target. Now there is one
   interpolated render transform that everything reads, and the camera smooths
   only the point it follows. Measured over walk/jump/land/strafe: direction
   flips 26 → 1, worst single-frame step 0.68 → 0.08.
2. **Stacked redlines tightened** from 4.8 to 2.4 apart — one band to clear
   rather than a lattice to thread. Pattern, count and gaps unchanged.
3. **Z-fighting fixed geometrically**: island bodies stop where their decks
   begin, and the spawn grass is cut into four slabs around the treadmill bay.
4. **Boot Shop wall** rebuilt in the treadmill bay's structural language.
5. **Mouth walls** now stop at the side wall's inner face instead of burying
   two units of themselves inside it.
6. **Win areas run the island's full length** on Z; the trigger is built from
   the same number, so the whole strip collects.

### Previous milestone

**Milestone 12 — map and layout polish.**

1. **Redlines run the whole route.** 201 lines across all 26 hazard gaps, using
   the existing pattern: 1 / 2 / three single columns / then three columns of
   three rows repeated to the end. None sit on an island, and every line still
   spans to the bank at its own height.
2. **Win Shop moved to the right-hand corner** (x -10 → -21). The walkable
   right limit is derived from its wall, so the open floor widened with it.
3. **The start reads as built**: coping courses along every wall top, corner
   posts at the corners and either side of the gorge mouth, and a rock ledge
   stepping out below the headland grass.
4. **Win pads rebuilt** to the reference — a framed chequered slab with gold
   trophies stood on it, consistent across all 30 islands.
5. **Treadmill bay** — inlaid tiled floor, kerb on three sides, divider posts
   between machines and a "Train Speed" banner over the row. Tiers, colours,
   effects and interaction untouched.

### Previous milestone

**Milestone 11 — reference UI, mouse-look camera, the deep-space run.**

1. **UI restyled to the references.** The three launchers are now square rail
   tiles with heavy white outlines under the trophy counter; the panels share
   one look — near-black card, thick light border, big outlined title with a
   divider, oversized red X. Item cards lead with the name, then a colour chip
   and the multiplier, with an orange Equip/Unequip button or a green cost pill
   on the right. No purchase, equip or reward logic was touched.
2. **Mouse-look third-person camera.** `MouseLook` (pointer lock, with
   click-drag as a fallback) owns yaw and pitch; the camera orbits the player
   and movement is rotated by the camera's yaw. WASD and the arrow keys move
   only. Input still goes to the server exactly as before — the client sends a
   stick and a camera yaw, and the server owns the simulation.
3. **Twenty more islands.** The route runs to 30 islands and z ~17,500,
   generated by continuing the authored curve rather than a second table.

### Previous milestone

**Milestone 10 — redlines, Space Island, trails and auras.**

1. **Redlines moved into the gaps.** They used to sit over islands and stop in
   mid air. Each line's half-span now follows the canyon wall (`bankXAtHeight`),
   so a high line is a longer line and both ends bury themselves in the bank.
   The pattern from the +10 island on is 1 / 2 / 3 / 3 / 3 / 3x3, one entry per
   gap, with the lone line dead-centred.
2. **Space Island** (+200 Wins) closes the route after +100, same dimensions
   and orientation, with a procedural starfield deck.
3. **Trails** — 10 tiers, 150 to 300,000 Wins, ×1.5 to ×10 on ACTUAL MOVEMENT
   SPEED via the shared formula's `extraMultiplier`. A distance-sampled ribbon
   follows the player and stops emitting when they stand still.
4. **Auras** — 11 tiers, 250 to 100,000 Wins, ×1.25 to ×5.5 on TROPHY REWARDS
   via `resolveTrophyReward`. A back-face shell plus one InstancedMesh of motes
   whose motion gives each tier its identity.
5. **One wallet.** `Wallet.spend` is now the only place Wins leave a profile,
   shared by all three shops.

### Previous milestone

**Milestone 9 — treadmill interaction, Wins spending, map connection.**

1. **Treadmills are usable.** Stopping on an unlocked deck pins the player onto
   it: they run in place without travelling, and earn progression from the belt
   (`runSpeed x step`) through the same per-step formula boots and rebirth
   already use. Any control — stick or jump — leaves on that same step, from
   exactly where they stood, and the multiplier stops with it. Entry, exit and
   the rebirth gate all live in `stepPlayer`, so the server owns them and the
   client predicts the identical result. Treadmills are not single-occupancy:
   entry preserves each player's own X within the belt, so several players
   share a machine in distinct lanes.
2. **Wins are spent.** `BootService` now deducts the tier's price on purchase,
   in the same method that grants and equips it, behind a cooldown so a burst
   of requests cannot double-spend. This reverses the earlier "threshold, not a
   price" rule, by request.
3. **The bank seam is fixed.** The canyon slope is a rotated slab, and its
   centre was being offset straight down in world Y instead of along the
   rotated face's own normal — which slid the visible slope inward and down so
   it started inside the channel and never reached the rim. It now runs exactly
   foot (16, −14) to rim (33, 6).
4. **The start is the head of the gorge.** It was a slab hanging in empty space
   with the river running underneath. It is now solid ground from rim to rim,
   dropping past the river floor, with the blue channel beginning at its front
   face. The platform widened to 66 (left wall inner 25.4 → 31.4) so it meets
   the canyon rim, and the front edge is walled except across the gorge mouth.

### Previous milestone

**Milestone 8 — durable persistence and treadmills.**

1. **Progression survives a server restart.** Profiles are written to disk
   behind a `PersistenceAdapter`; the shipped adapter is one JSON file under
   `server/data/` (override with `OBBY_DATA_DIR`). Writes are debounced and
   atomic — temp file, fsync, rename — so a crash mid-write cannot corrupt a
   save. Rooms also autosave every connected player every 15s, because Speed
   accrues continuously between the discrete events that trigger a save.
   Swapping in a database means writing one adapter and editing
   `createPersistence`; nothing above that boundary changes.
2. **Treadmills.** Eight decks along the back wall of spawn multiply the
   progression gained per step (×1, ×1.5, ×2, ×3, ×5, ×8, ×14, ×25), gated by
   rebirth (0, 1, 3, 9, 18, 36, 100, 200). They do **not** touch movement
   speed — the loop stays *step → progression → level → speed*.
3. **One gain formula.** `resolveProgressionRate` multiplies boots, rebirth
   and treadmill together in a single place. `SpeedService` is its only caller
   and does no arithmetic of its own, so the next modifier is a one-line change
   there rather than a formula copied into another service.
4. **Nothing to spoof.** There is no treadmill message. The server derives the
   deck from the position it simulated and checks the gate against its own
   rebirth count, so a client cannot claim a deck it is not on or a tier it has
   not earned.
5. **The starting platform grew to 54 × 56** so the treadmill row fits behind
   the Win Shop without crowding the run into the gorge. Decks are a 0.2 step,
   inside the simulation's landing tolerance, so walking on and off them needed
   no new movement rule.
6. **Visual tiers.** Colour, emissive frame and belt scroll speed climb with
   the tier; a lit halo appears at tier 4 and orbiting energy cubes at tier 6.
   All eight machines share one geometry per part and one belt canvas.

### Previous milestone

**Milestone 7 — server-authoritative movement.**

- The physics step (`stepPlayer`) and the collision model (`WorldCollision`)
  live in `shared/src/sim/`, so the server and client prediction run the *same*
  code rather than two implementations that must be kept in agreement.
- `MoveMessage` is now INPUT ONLY — `seq`, `dt` and the stick. There is no
  field through which a client can assert a position, velocity or rotation.
- The client simulates on a fixed 60Hz step, sends every step, buffers
  unacknowledged inputs, and on each server update snaps to the authoritative
  state and replays the rest. Small corrections ease out over the render
  transform; large ones snap.
- Server validation: `dt` clamped, stick clamped to the unit disc, a simulated
  time budget (1.5x real time), stale sequences dropped, and implausible
  sequence jumps refused.
- The x3.5 movement cap is gone. `MOVEMENT_SCALING.maxMultiplier` is now 50 —
  a safety rail, not a progression limit — so R2 (x4.32) and R3 (x6.40) scale.

### Previous milestone

**Milestone 6 — real movement speed, rebirth, longer route.**

1. **Level changes how fast you actually move.** One formula,
   `resolveMovementProfile(level, rebirth, extra)`, lives in shared config. The
   server evaluates it and replicates `moveMultiplier`; the client multiplies
   its base speeds by that number and never computes its own. Server movement
   validation reads the same profile, so the credit cap always matches the
   speed the player is allowed to move at.
2. **Rebirth**: `maxLevel = 10 x (rebirth + 1)`, `multiplier = 1 + rebirth x 0.5`,
   continuing automatically. Reached max level unlocks the rebirth button under
   the trophy count; the panel shows before/after multiplier and cap.
3. **Longer route.** Gaps are now `7, 13, 32, 43, 57, 70, 84, 98, 122` — the
   first two islands stay easy, then the gap jumps 2.5x. Measured reach
   (flips + speed together) is 17 / 26 / 37 / 49 / 64 / 78 / 93 / 107 / 135 at
   levels 1-10, so island N needs a specific level and the last one lands
   exactly on level 10, the rebirth-0 cap.
4. **Progression survives a reload** via an in-memory profile store keyed by a
   `localStorage` player id.

### Previous milestone

**Milestone 5 — boots and the Win Shop.**

Seven boot tiers set how much Speed a step is worth. Buying is deliberate: you
walk onto a boot's pedestal in the Win Shop while holding enough Wins. Reaching
the Wins total alone does nothing — the boot waits for you. Wins are never
deducted; the requirement is a threshold, not a price. The highest tier you own
is always equipped.

| slot | boot | per step | wins |
| ---- | ---- | -------- | ---- |
| 1 | Starter | +1 | 0 |
| 2 | Runner | +2 | 10 |
| 3 | Bubble | +3 | 35 |
| 4 | Frost | +4 | 100 |
| 5 | Magma | +6 | 250 |
| 6 | Storm | +8 | 500 |
| 7 | Mythic | +15 | 1,500 |

The Win Shop stands along the right-hand side of the starting platform, with a
pedestal per tier showing `+N/Step` and `EQUIPPED` / `OWNED` / `WALK OVER TO
BUY` / `N Wins Required`. Boots you can afford glow and rise on their stand.

The starting area is 42 × 48 and walled on the left and the back, with the
shop's backdrop closing the right — only the front is open onto the gorge.

Boots are low-poly sneakers built from merged boxes (a coloured upper over a
white sole), used both on the shop stands and on the player's feet, where they
are parented to the leg bones so they follow the animation through walks and
backflips.

### Previous milestone — Speed farming and levels

Progression gates the route.

1. **Speed** is farmed by moving: distance travelled plus a bonus for every
   jump. The server derives it from the movement it observes, capping each
   report at a plausible step — a client cannot ask for Speed or teleport-farm.
2. **One backflip per level.** Everyone starts at level 1 with one flip;
   capacity equals level, so level 15 chains 15 flips before touching down.
   Verified: capacity 1/2/5/10/15 → exactly 1/2/5/10/15 flips.
3. **Gaps are flip-gated.** Measured reach is 10.7 units with no flips, then
   17.1 / 25.0 / 34.3 / 44.4 / 55.1 / 65.7 / 86.6 for 1–8 flips. Each gap sits
   above the previous flip count's reach, so island N needs N flips:

   | island | +1 | +3 | +5 | +10 | +15 | +25 | +35 | +45 | +100 |
   | ------ | -- | -- | -- | --- | --- | --- | --- | --- | ---- |
   | gap    | 7  | 13 | 20 | 28  | 37  | 47  | 58  | 69  | 79   |
   | flips  | 0  | 1  | 2  | 3   | 4   | 5   | 6   | 7   | 8    |
   | level  | 1  | 1  | 2  | 3   | 4   | 5   | 6   | 7   | 8    |

   The +1 → +3 jump is the first wall: no amount of running clears 13 units.
4. **HUD** bottom-centre: `Jump: N/M` while airborne, "Total Speed", a level
   bar with `Level N` and `into/required`, and the rebirth multiplier. Wins sit
   top-left with a trophy icon, and Speed gains float up as scattered `+N`
   popups. Every one of these renders replicated state only.
5. **Themed islands.** Each island carries a name floating above it —
   Starter, Cloud, Volcano, Tsunami, Hot, Nature, Crystal, Thunder, Ancient —
   and a matching deck colour on its top surface. The body geometry and
   material are still shared; only the thin deck and the label vary.
6. The level curve is `10 × 1.5^(level-1)`, which reproduces the reference
   exactly: a 40.6k total reads as Level 19, 11.1k/14.8k.

### Previous milestone — the gorge A linear obby route down a blue gorge with
terraced banks, nine trophy platforms and red hazard lines. Verified working:

1. Long straight gorge along +Z: a blue tiled channel (a river visually, not
   water), steep tiled canyon walls, studded grass rims and a cloudy sky.
   Every texture is drawn procedurally on canvas — no image assets.
2. Nine trophy islands — +1 +3 +5 +10 +15 +25 +35 +45 +100 — sharing one
   geometry and one material. Identical width, length, thickness, X, Y and
   rotation; **only Z differs**. Each is 22 × 11, twice as wide across the
   gorge as it is deep.
3. Gaps grow from 7.0 to 9.5 units against a 10.9-unit sprint jump.
4. Gold collection pads at the **far left** of each island, with floating
   "+N Wins" labels — run the right-hand lane to skip a trophy and push on.
5. Walking into a pad awards that platform's wins **once**, then respawns at
   spawn. The server validates and grants; the client only asks.
6. Falling into the pit respawns at spawn.
7. Red hazard lines span bank to bank; touching one respawns at spawn.
8. Hazards start at the +35 platform, with more and tighter ones at +45 and
   +100 as the tilt increases.
9. Each line has one fair answer — run under the high ones, jump the low ones,
   and cross the high gap line without flipping.
10. Invisible boundaries at x = ±13 keep players off the walls (which start at
    x = ±16).
11. 300 layered conifers in two instanced draw calls; 38 meshes for the whole world.
12. **Backflips are traversal.** Each flip re-launches the player with an
    upward impulse and forward speed, and each successive flip lifts harder:
    measured peaks 3.5 → 4.6 → 6.9 → 9.9 units, carrying 14.3 → 25.6 units
    forward. One redline is strung high over a gap specifically as a "do not
    flip here" hazard.

### Earlier milestone — player foundation + procedural animation

Still working, unchanged:

1. Vite client starts.
2. Colyseus server starts.
3. Browser connects and joins the `gorge` room.
4. Server creates a player entity on join and removes it on leave.
5. Local player renders from the supplied `player.fbx`.
6. Model loads through `FBXLoader` (2 meshes, 312 triangulated verts, 3.20 world units tall).
7. Skeleton verified at runtime — 12 bones: `Rig1 Spine1 Spine2 Neck1 ArmL1 ArmL2 ArmR1 ArmR2 LegR1 LegR2 LegL1 LegL2`.
8. Texture fallback works — the FBX's dead absolute paths are remapped before any request.
9. Third-person follow camera.
10. Desktop movement: WASD/arrows, `Shift` sprint, `Space` jump.
11. Position and rotation sync through the server.
12. Remote players render as translucent ghosts.
13. Procedural animation on the real rig: idle, walk, run, jump start,
    airborne, landing, backflip and chained backflip.
14. Remote players animate from replicated compact state (no bone data on the wire).

Controls: **WASD** or arrow keys to move, **Shift** to sprint, **Space** to jump —
and **Space again while airborne** to spend one available backflip. Tap it
repeatedly to chain flips and climb higher with each one. Flips refill the
moment you touch the ground.

Move to farm Speed. Levels arrive fast at first (level 2 costs 10 Speed) and
each one adds a backflip, which is what lets you reach the next island.

### Animation system

The FBX has no clips, so the character is animated **procedurally** from its 12
bones. No animation library, no clip pack: the whole system is ~13 KB of source
and the production bundle got *smaller*, because dropping three.js'
`AnimationMixer` saved more than the new code costs.

| Module | Responsibility |
| ------ | -------------- |
| `rig/PlayerRig` | Binds the 12 bones, resolves character-space axes onto each bone's baked orientation, applies poses |
| `PoseBuffer` | Flat allocation-free pose storage and blending |
| `LocomotionCycle` | One walk/run cycle; cadence and pose strength follow real movement speed |
| `BackflipAnimator` | Rotation angle, chaining, abort-on-landing |
| `PlayerAnimator` | The state machine; blends poses and drives the rig, flip pivot and bob |
| `config/animationConfig.ts` | Every tunable number |

Key invariants:

- **Animation never moves the player.** It writes to bones, a flip pivot and a
  visual bob node — never to the character root that carries the physics
  position. Verified: jump trajectories are bit-for-bit identical with 0, 1 and
  3 flips.
- **Poses are authored in character space** (`+X` pitch swings a limb backward)
  and mapped onto each bone's baked local axes at bind time, so the rig's
  non-trivial authored orientations never leak into pose authoring.
- **Chaining cannot drift.** Rotation is a single scalar; each chained flip adds
  a full turn to the target rather than restarting, and the pivot quaternion is
  rebuilt from an axis-angle every frame. After 6 continuous rotations the pivot
  returns to exactly `(0,0,0,1)`.
- **Availability and performance are separate state.** `flipsRemaining` (server
  allowance) is distinct from flips in flight; having flips never performs one.
- **The flip impulse is gameplay, not animation.** `LocalPlayer` applies the
  lift and forward push because it owns velocity; the animator still cannot
  move the player.

### FBX texture handling

`player.fbx` references two textures by absolute path on a machine that does not
exist here (`X:\legion\poxel\...`). Three.js reduces those to their basenames,
so the client would otherwise request `/player/test.png` and
`/player/small_bevel.png`.

Two layers prevent that:

1. A `LoadingManager` URL modifier remaps every texture request before it is
   issued — `test.png` → `green.png`, `small_bevel.png` → an inline flat normal
   map. No dead path ever reaches the network.
2. After parsing, all materials are replaced with a `MeshStandardMaterial` built
   in code, using `green.png` with nearest-neighbour filtering (it is a 64×64
   pixel-art atlas, not a smooth texture).

Both live in `client/src/config/assets.ts` and
`client/src/player/PlayerModelLoader.ts`. The FBX files themselves are untouched.

## Known limitations

- **Flip duration vs airtime.** A flip takes 0.45s and a standing jump gives
  0.73s of airtime, so exactly one flip fits a flat-ground jump. Chaining needs
  the longer falls the gorge will provide.
- **`green.png` is a stand-in.** It is a plausible 64×64 atlas for this model but
  is not confirmed to be the original `test.png`. UVs land on sensible regions.
- **The JSON store is for development only.** One process writing one file -
  not safe to run two server processes against. Deployed pods use MongoDB.
- **Two tabs in one browser share a guest `playerId`**, and therefore one guest
  profile. The same account in two sessions at once shares one profile, and
  the most recent save wins.
- **Input is sent at 60 msg/s per player.** The server advances only by the
  inputs it receives, so nothing is throttled; at the 24-player room cap that
  is ~1,440 msg/s. Batching several steps per message would cut it.
- **The "do not flip here" gap hazard was removed.** Now that every gap after
  the first requires flips, a line punishing flips over a gap would make that
  gap impassable. All four remaining hazards sit on islands.
- **Hazard density is limited by island depth.** A low line needs ~1.9 units of
  run-up and a high line blocks launching within ~0.9, so a fair pair needs
  ~4.5 units between them. Only the +100 island carries both kinds; the others
  carry one. More hazards per island would need deeper islands.
- **The route ends at +100.** The gorge geometry continues to the horizon but
  there is nothing to reach past the last platform.
- **No mobile touch controls yet.** The client is mobile-*ready* (viewport, pixel
  ratio cap, `touch-action`, orientation handling) but input is keyboard-only, so
  jumping and backflipping are unavailable on touch devices.
- **`base_rig.fbx` is unused**, byte-identical to `player.fbx`, and excluded from
  the production build.
- **`@colyseus/core` is pinned to `0.16.24`** via a root `overrides` entry —
  `0.16.25` ships a broken `workspace:^` dependency that npm cannot install.

## Next milestone

The full UI pass, then monetization, VFX and audio. A real database behind
`PersistenceAdapter` and mobile touch controls are the two infrastructure
items still owed.
