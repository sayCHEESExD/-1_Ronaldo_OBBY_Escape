# CLAUDE.md — +1 Backflip Obby Escape

Permanent project rules and design constraints. Read this before changing anything.

## What this is

A **production** browser multiplayer obby game. Not a demo, not a prototype.
"Roblox-inspired" describes the **visual and gameplay style only**.

## Technology (fixed)

| Layer     | Stack                                          |
| --------- | ---------------------------------------------- |
| Client    | Three.js + TypeScript + Vite                   |
| Server    | Colyseus + Node.js + TypeScript                |
| Shared    | TypeScript, framework-free                     |
| Target    | Browser / WebGL, desktop **and** mobile        |
| Repo      | npm workspaces monorepo                        |

**Not used, ever:** Unity. Roblox Studio or the Roblox engine. Any other game
engine. Do not add a framework or a build tool without a concrete need.

## Hard constraints

- Final browser build must stay **under 12 MB**.
- **Progression and rewards are server-authoritative.** The client may predict
  for UI feel but never decides, computes or claims a reward.
- Desktop and mobile browsers are both first-class. No desktop-only input
  assumptions.

## Core game design

**Layout — linear gorge**

- The gorge is linear. The player travels **along** it, never across it.
- Trophy platforms **never shift left/right**. Progress is forward only.
- The **banks are inaccessible** — they are scenery, not playable space.
- The **blue gorge floor is a death zone**. Falling respawns the player at spawn.

**Movement**

- **The MOUSE aims the camera; the camera defines forward.** WASD and the
  arrow keys move relative to it and never rotate it. The camera used to trail
  the player's own facing, so pressing a movement key turned the character,
  which swung the camera, which redefined forward - a feedback loop, not a
  control scheme. `ThirdPersonCamera` owns its yaw/pitch, `MouseLook` writes
  them, and `stepPlayer` rotates the stick by that yaw. The character's facing
  then follows where it actually moves.
- **One render transform.** `LocalPlayer.position` is the simulation
  interpolated to the current frame PLUS the eased reconciliation offset, and
  the camera, the character and the world triggers all read it. Two separate
  transforms is what caused camera vibration: the simulation only advances on
  60Hz boundaries, so a 144Hz display saw it move in bursts, and the camera
  followed the raw position while the character rendered at a corrected one.
- The camera smooths the POINT IT FOLLOWS, once. Smoothing the position while
  taking the look target raw makes the two disagree every frame, which reads as
  vibration however gentle the smoothing is.
- `reconcile` must not collapse the interpolation baseline onto the replayed
  state: replay re-runs inputs the client already ran, so the baseline is still
  valid, and re-basing it twenty times a second is a visible tick. Only a SNAP
  (past `SNAP_DISTANCE`) resets it.
- The camera's RIGHT is `(-cos yaw, sin yaw)`, not `(cos yaw, -sin yaw)`: with
  Y up and +X to the right of screen, +Z runs away from the viewer, which is
  why +X is the player's left down the gorge. Getting this backwards inverts
  strafing, and a trailing camera hides it completely.
- **Velocity determines jump distance.** Faster approach = longer jump. This is
  the central skill expression; do not cap it with a fixed jump arc.
- **Backflips are a traversal move.** Each flip re-launches the player in mid
  air with an upward impulse plus forward speed, and each successive flip in
  the same airborne window lifts HARDER than the last. Chaining flips is how a
  player climbs and covers ground.
- Level progression grants **backflips**, so more levels means more air.

**Progression**

- **Speed** is the currency. Players farm it by moving: distance travelled on
  foot plus a bonus each time they leave the ground.
- Crossing a level threshold grants **one more backflip**. Capacity EQUALS
  level - level 15 means fifteen flips before touching down.
- Gaps between islands are tuned so island N needs N flips. Farming Speed is
  what physically opens the route; you cannot run your way to +100.
- **Boots** set Speed gained per step, bought with trophy Wins. Buying is a
  DELIBERATE ACT: the player must walk onto a pedestal in the Win Shop while
  holding enough Wins. Reaching the Wins total alone does nothing.
  Wins are SPENT: the tier's cost is deducted on purchase. (This reverses the
  earlier "threshold, not a price" rule, by explicit request.) The highest tier
  OWNED is always equipped, so a purchase can never downgrade anyone, and
  spending never removes a boot already bought.
- **Trails** multiply ACTUAL MOVEMENT SPEED, bought with Wins and worn one at
  a time. They feed the one movement formula through its `extraMultiplier`
  parameter - never a calculation of their own.
- **Auras** multiply TROPHY REWARDS, bought with Wins and worn one at a time.
  Applied in `resolveTrophyReward`, after `TrophyService` has already validated
  the platform, the claim history, the position and the cooldown.
- The two never cross. A trail must never touch a reward and an aura must never
  touch speed; `resolveProgressionRate` (boots, rebirth, treadmill) is a third
  axis again. Keeping them separate is why each lives in its own shared config.
- **Rebirth** raises the level cap and the multiplier:
  `maxLevel = 10 x (rebirth + 1)`, `multiplier = 1 + rebirth x 0.5`.
  Available once the player reaches their current max level. It resets level
  and Speed but PRESERVES Wins, boots and every other permanent unlock.
- **Treadmills** multiply the progression gained per step while the player is
  running on one. They do NOT change movement speed. Four tiers, gated at
  rebirth 0/1/3/9, stand along the back wall of spawn as SIX machines: the two
  lowest tiers are pairs (`TREADMILL_DECKS`, shared config). Every system -
  collision, sim, server, visuals - iterates that deck list, never the tiers.
- Using a treadmill is a MOVEMENT STATE, owned by `stepPlayer`: come to a stop
  on an unlocked deck and the machine takes you, pinning position and velocity
  so you run without travelling. Any control at all - a nudge of the stick or
  the jump button - leaves on that same step, from exactly where you stood.
  Entry requires a still stick precisely because exit is any input; otherwise
  walking on would enter and leave on alternating steps.
- A runner earns progression from the BELT: distance is `runSpeed x step`
  instead of a position delta, fed through the same per-step formula. There is
  no second progression path.
- Treadmills are never single-occupancy. Entering preserves the player's own X
  within the belt and only snaps Z, so players sharing a machine keep distinct
  positions; all treadmill state is per-player.
- `player.speed` is the ANIMATION signal, not physics - it reports the speed a
  runner is running AT while the replicated velocity stays zero, or remote
  clients would show them idling on the spot.
- The gate is `maxTreadmillTier`, resolved from the server's own rebirth count
  and replicated so client prediction matches. There is no treadmill message,
  so there is nothing for a client to forge.

**Multiplayer**

- Other players are **ghosted**, and that word means EXACTLY one thing: they do
  not collide, so they can never block another player's run. They render
  completely normally - opaque, no fade, no ghost material. `buildMaterial` is
  opaque for every player and there is no per-instance opacity to pass.
- Remote flip animation is DERIVED from authoritative state, never from a
  free-running queue. `flipCount` is a LIFETIME total, so it only means
  anything as a difference against a baseline the client took on FIRST sight -
  treating it as "flips to play" replays a stranger's whole session as one
  endless spin. Flips are queued only while the server has the player
  airborne, the queue is bounded, and `grounded` ends the sequence outright.

## Assets

- Characters are **Bloxity's own avatar body** (`static.bloxity.io/avatars/
  player.glb`), assembled per player - see the Bloxity section. It carries the
  same twelve bone names as the FBX, so the procedural animation drives it
  unchanged, and it is scaled at load to the FBX's height.
- `assets/player/player.fbx` is the **fallback** body, used only when Bloxity's
  body cannot be fetched (boot waits 8s for it, then settles on the FBX for the
  session). It is always loaded, so the game never depends on the CDN.
- `assets/player/base_rig.fbx` is **byte-identical** to player.fbx. Do not load
  both.
- **Never modify the supplied FBX files.**
- The FBX embeds **dead absolute texture paths** (`X:\legion\poxel\...`). Texture
  resolution is handled explicitly in `client/src/config/assets.ts` and
  `client/src/player/PlayerModelLoader.ts`: every texture request is remapped
  before it hits the network, and materials are assigned in code after load.
  Never rely on the FBX's own texture paths.
- The FBX contains **no animation clips** — it is a bind-pose rig with 12 bones
  (`Rig1 Spine1 Spine2 Neck1 ArmL1 ArmL2 ArmR1 ArmR2 LegR1 LegR2 LegL1 LegL2`).
  All animation is **procedural**, driven from those bones. Do not add an
  animation library or a downloaded clip pack.
- The FBX declares **two skin deformers**, so FBXLoader creates two Bone objects
  per name: the real joint and a zero-length terminal child. The arms mesh binds
  to the terminals, the body mesh to the real joints. `PlayerRig` binds the
  **first** bone of each name (traversal visits a parent before its child), which
  drives both meshes. Binding the terminals animates the arms only.
- Background music is `assets/audio/background.mp3` (`ASSET_PATHS.
  backgroundMusic`), looped by `MusicTrack`. It is STREAMED through an
  `<audio>` element routed into the Web Audio graph - never decoded into an
  AudioBuffer, which would hold tens of MB of PCM for the session - so master
  volume, mute and the portal's music slider all apply to it.
- Assets are served straight from the repo `assets/` folder via Vite's
  `publicDir`. Do not copy assets into `client/`.

## Animation

Procedural, bone-driven, and required for the finished game — not a placeholder.

- `PlayerAnimator` is the only animation state machine. Animation logic never
  goes in movement, input or networking code.
- It consumes a read-only `AnimationInput` (grounded, speed, vertical velocity,
  jump/land/flip-request edges) and writes **only** to bones, the flip pivot and
  the visual bob node. It must never move the character's physics root, change
  velocity, or decide gameplay outcomes.
- Poses are authored in **character space** (`+X` pitch swings a limb backward)
  and resolved onto each bone's baked local axes by `PlayerRig`. Every frame
  rebuilds `rotation * restQuaternion` from scratch, so posing cannot drift.
- Backflips rotate a **flip pivot** at hip height inside the character, plus a
  bone tuck. Never rotate the whole rendered object.
- The flip's lift and forward impulse are applied by `LocalPlayer`, which owns
  velocity — **never by the animator**. The animator stays purely visual: it
  writes bones, the flip pivot and the bob node, and nothing else. Keeping the
  impulse in gameplay is what lets flips change the arc without the animation
  system ever being able to move the player.
- Chained flips ADD a full turn to the target angle rather than restarting.
  Rotation is one scalar, wrapped modulo 2π only at read time and rebuilt with
  `setFromAxisAngle`; quaternions are never accumulated across frames.
- "Available backflips" (server-authoritative allowance) and "flips being
  performed" are **different state**. Having flips available never performs one.
- Remote players run the same animator, reconstructed locally from compact
  replicated signals. **Never transmit bone transforms.**

## World

- **One torii on the route: the great gate over the gorge mouth**
  (`SpawnDecor`). Gates per island made the river a corridor of red frames;
  do not add scenery gates along the river.
- The island ladder is **generated, not authored past the opening**. The
  hand-tuned first ten islands end exactly at the rebirth-0 level cap; every
  island after that continues the same curve by compounding (`GAP_GROWTH`,
  `REWARD_GROWTH`, both read off the authored tail). Adding more islands is a
  one-number change to `EXTENDED_ISLANDS`, never another table of values.
- `GORGE.horizonZ` is DERIVED from `ROUTE_END_Z`. The terrain is a handful of
  scaled boxes, so length is free, but a fixed horizon would leave the last
  islands floating over open sky. Foliage is a DENSITY for the same reason.
- The gorge layout is **pure data** in `shared/src/config/gorge.ts` - platform
  positions, trophy values, bank terraces and redlines. Never scatter world
  coordinates through scene code.
- `TROPHY_PLATFORMS` is **generated from a gap list**, so a per-platform X,
  Y or rotation cannot be introduced by accident. Every platform shares one
  geometry and one material; only the mesh's Z differs.
- Islands are **rectangular and wider across the gorge than along it** (22 x 11).
  The collection pad sits at the **far left** of every island, so a player who
  wants a bigger trophy runs down the right-hand lane instead.
- Each island has a themed **name and deck colour** (Starter, Cloud, Volcano,
  Tsunami, Hot, Nature, Crystal, Thunder, Ancient). Names live in shared config
  as island identity; colours live in `client/src/config/worldVisuals.ts`. The
  deck is a separate thin mesh laid on top - the island body keeps the shared
  geometry AND the shared material, so the geometry rule is untouched.
- `GorgeCollision` is the gameplay shape of the world and `GorgeWorld` is its
  visuals. Both read the same config, so they cannot drift apart.
- Redlines cover EVERY gap from the +10 island to the end of the route. The
  ramp is 1 line, 2 lines, three single columns, then the endgame pattern -
  three columns of three rows - repeated for every remaining gap. It repeats
  rather than escalating with gap length: out past +100 the gaps run to two
  thousand units, and scaling the hazard count with them would build a wall no
  arc could pass instead of a gate to thread.
- Redlines sit **in the gaps between islands**, never on an island. An island
  is where a player lands, re-aims and launches; a hazard there punishes the
  one part of the route that must be safe. A gap is the opposite - the player
  is already committed to an arc, so a line there is a shape to fly through.
- Every line spans **bank to bank**. Its half-span comes from `bankXAtHeight`,
  which follows the canyon wall, so a high line is a LONGER line and both ends
  are always buried in terrain rather than stopping in mid air.
- A stacked column is now a TIGHT BAND (rows 2.4 apart), deliberately below the
  threading threshold, so it has one answer: clear the whole thing. Widening
  the spacing back past 3.64 silently re-opens the gaps between rows.
- Superseded, kept for the arithmetic - a column that DOES want a passable
  window between rows: the hit test treats
  the player as a box 3.2 tall and each line is 0.22 thick, so rows need more
  than 3.64 units of clear air between them. `ROW_HEIGHTS` uses 4.8.
- Superseded, kept for context - redlines used to sit over islands: a line high enough that a
  normal jump passes under it (y >= 7.2) may span a gap, where it reads as "do
  not flip here". Any other height over a gap is unfair - the jump arc is under
  a metre high at the launch edge, so a low line is unclearable, and it peaks
  above head height mid-gap, so a mid line is unavoidable.
- **Hazard spacing is a hard constraint, not taste.** A low line needs ~1.9
  units of run-up before it, because it is only cleared once the player's FEET
  pass it. A high line cannot be launched from within ~0.9 units, because the
  head rises into it immediately. Place a high line just before a low one and
  those windows exclude each other, leaving no legal launch point. A pair on one
  island needs ~4.5 units between them; most islands carry a single line.
- **One owner per visible surface.** The island body stops where its deck
  begins, and the spawn grass is cut into four slabs around the treadmill bay
  (`TREADMILL_BAY`, shared config, so the hole and the floor come from one
  rectangle). Two surfaces a hundredth apart is z-fighting, not layering; the
  fix is always to remove one of them, never to nudge it.
- Walls stop at the INNER FACE of the wall they meet, never at the platform
  edge - running them to the edge buries one wall inside another with both tops
  at the same height.
- The canyon SLOPES start at the gorge mouth, not at `GORGE.startZ`. A slope
  crosses platform height at x = 27.9 while the starting headland reaches
  x = 33, so running them the full length pushed five units of blue bank up
  through the spawn grass on both sides. The RIMS still run the full length -
  they sit outboard of the headland and cannot intersect it.
- A sign hung near a wall must clear that wall's COPING, which oversails it by
  a quarter on each side.
- **Platforms are solid slabs, not one-way floors.** `resolveCeiling` stops a
  rising player at the underside; without it the whole route was climbable from
  below. The head test is gated on the player's PREVIOUS head height, so
  standing on a platform never traps them under the one they are on, and the
  ceiling footprint is deliberately not inflated by the player radius - the
  ground test inflates so you can stand on an edge, but inflating a ceiling
  would block you in mid air beside one.
- The Win pad is a BUILT object - framed chequered slab plus gold trophies -
  because the place a reward is banked has to read from across a gap. One
  frame geometry, one top geometry and a single InstancedMesh carrying every
  trophy on the route. It marks the spot; `TrophyService` decides the reward.
- The treadmill bay's floor is INLAID - its top sits exactly at platform level
  rather than raised - so the area reads as a dedicated room without adding a
  step the simulation would have to know about. The machines keep their own
  0.2 deck step, which is the only thing the player actually walks onto.
- The collection pad is narrower than the platform on purpose - a player can
  skirt around it to push on for a bigger trophy. Banking is a choice.
- Trophy rewards are granted in exactly one place: `TrophyService` on the
  server. It validates the platform, the run's claim history, the player's
  reported position and a claim cooldown. The client only ever asks.
- **Wins are spent in exactly one place**: `Wallet.spend`. Boots, trails and
  auras are three shops but must not become three ways to take payment - a
  second deduction path is how a wallet ends up disagreeing with an inventory.
  Wins are ADDED in exactly two places, and nowhere else may add them:
  `TrophyService` for earned rewards, and `BuxFulfilmentService` for a paid
  Bloxity purchase (recorded there, handed over by `GorgeRoom.applyGrants`
  with the uint32 guard). The second exists because real money is a real
  source of currency, and it is a whole service rather than a few lines in an
  HTTP handler for the same reason `Wallet.spend` is a service - so the catalog
  lookup and the duplicate check live together and cannot be skipped by a new
  caller. Wins are only ever removed by `Wallet.spend`.
- Trails and auras share one `CosmeticService`, parameterised by a binding, so
  the buy-and-equip transaction exists once. What each multiplier DOES is never
  decided in that service.
- **Movement speed has exactly one EVALUATOR**: `SpeedService.movementProfile`.
  It is the only place that knows every modifier feeding the shared formula,
  so nothing else may write `moveMultiplier`. `RebirthService.sync` used to,
  and silently dropped the equipped trail the moment trails existed.
- Boots are decided in exactly one place: `BootService` on the server. It
  validates the slot, the Wins, that the player is standing at that pedestal
  and a purchase cooldown, then DEDUCTS the price and equips the best tier
  owned. Taking payment, granting the item and equipping happen together in
  that one method, so the wallet and the inventory cannot disagree. The client
  only asks and renders.
- **Movement is SERVER-AUTHORITATIVE.** Clients send INPUT only
  (`MoveMessage` carries seq, dt and the stick - no transform). The server runs
  `stepPlayer` from `shared/src/sim/PlayerSim.ts` and owns position, velocity,
  rotation, grounded, jump and backflip state. The client runs the identical
  function to predict, keeps unacknowledged inputs, and on each server update
  snaps and replays them. Never add a second physics implementation, and never
  let a client assert a transform.
- `WorldCollision` lives in `shared/src/sim/` because BOTH sides collide
  against it. The client's `world/GorgeCollision.ts` is only a re-export.
- **Actual movement speed has exactly ONE formula**: `resolveMovementProfile`
  in `shared/src/config/rebirth.ts`. The server evaluates it from level and
  rebirth and replicates `moveMultiplier`; the client multiplies its base
  speeds by that and never derives its own. Boots and treadmills multiply in
  through the `extraMultiplier` parameter - never by adding a second formula.
  Server movement validation reads the same profile, so what the player moves
  at and what the server will credit can never disagree.
- **Progression gained per step has exactly ONE formula**:
  `resolveProgressionRate` in `shared/src/config/progressionGain.ts`. Boots,
  rebirth and treadmill multiply together there and nowhere else. A new
  modifier is added to that function, never to a caller - `SpeedService` is its
  only caller and does no arithmetic of its own.
- Persistence sits behind `PersistenceAdapter` in `server/src/persistence/`.
  Nothing above that boundary knows where profiles are stored, and
  `createPersistence` is the ONLY place naming a concrete adapter.
- **Production progress lives in Bloxity's managed MongoDB** (`MONGODB_URI`,
  injected per game+channel; official `mongodb` 6.x driver, which fits the
  `>=20.11` engines range). The container disk is replaced on every deploy and
  scale-to-zero - a JSON file there is how progress vanished after updates.
  The JSON adapter is for local development only.
- **The storage contract is PER KEY** (`PersistenceAdapter`: get / put /
  insertIfAbsent / loadAll / whenWritten / flush), one document per player.
  Several pods share one database, so nothing may write back a whole-map
  snapshot.
- **A profile that decides progress is read FRESH at join/sign-in**
  (`profileStore.resolve` in `GorgeRoom.onAuth`), never from the boot cache -
  that cache only feeds the boards, refreshed every minute, newer `updatedAt`
  wins. A failed read is NOT "no profile": `get` THROWS and the join is REFUSED
  (503, the client retries). Admitting someone on an empty profile would
  autosave that zero over their progress.
- Saves queue the latest snapshot per key, written as idempotent
  `updateOne($set, upsert)` and retried with backoff - an outage delays them,
  never drops them. Only `migratedTo`/`migratedFrom` are ever `$unset`; every
  field this build does not know about is preserved (`profileCodec` carries
  unknown fields through, `profileFields` merges).
- A `profiles.json` in `OBBY_DATA_DIR` is imported into Mongo on boot with
  `$setOnInsert` - insert-only, safe every boot. The JSON store keeps atomic
  temp+fsync+rename writes, recovers a leftover `.tmp`, and MOVES an
  unparseable file aside rather than overwriting it.
- Boot never fails on storage: `/health` keeps answering (or Legion restart-
  loops the pod) and `profileStore.open` retries in the background.
- Shutdown: Colyseus's own shutdown handler is disabled (it exits before
  saves land); ours runs `gracefullyShutdown(false)`, then awaits the flush,
  lets grant confirmations land, then closes.
- Rebirth state is server-authoritative: `RebirthService` alone decides
  eligibility and performs the reset.
- Speed is granted in exactly one place: `SpeedService` on the server. It is
  DERIVED from movement the server observes - the distance between consecutive
  reported positions, capped at a plausible step so a teleport pays nothing.
  A client cannot request Speed, and the HUD only ever renders the replicated
  total. Reset the movement baseline on every respawn.

- The starting area is walled on the left (+X) and the back (-Z), with the Win
  Shop's backdrop closing the right. The front is open only across the GORGE
  MOUTH (`|x| <= GORGE.channelHalfWidth`); the rest of the front edge is wall,
  because the start is far wider than the channel it feeds into and an open
  edge out there would yank a player sideways to the channel limit in one step.
  `WorldCollision.clampToBounds` owns those limits and applies them anywhere at
  or behind the platform's front edge - a range test would let a large
  displacement tunnel the back wall.
- The start is the HEAD OF THE GORGE, not a floating slab: solid ground from
  rim to rim running down past the river floor, with the blue channel beginning
  at its front face (`GORGE_HEAD`). Only the starting area is grounded like
  this - the trophy islands stay floating platforms.
- The canyon slope is a rotated slab whose TOP FACE is the visible bank. Its
  centre must be offset along that face's own normal, never straight down in
  world Y: offsetting in Y slides the face inward and down, so the slope starts
  inside the channel and never reaches the rim, which is what left the green
  bank visibly disconnected from the blue wall.

## Architecture rules

- **No god files.** Logic belongs in its module: `networking`, `player`, `input`,
  `rendering`, `camera`, `animation`, `world`, `progression`, `configuration`.
- Gameplay tuning is **data-driven** and lives in `shared/src/config/*`. Numbers
  the client and server must agree on go in `shared/`, never duplicated.
- `shared/` must not import `three`, `colyseus`, or anything DOM.
- The client touches `colyseus.js` only inside `client/src/net/`.
- **The HUD has ONE scaling system**: `client/src/ui/uiScale.ts` sets
  `--obby-ui-scale` from the live viewport (proportional to a 1366x768 design
  at 1.3, clamped to 0.66-1.6, and capped so the left rail always fits), and
  every HUD metric is `design px * var(--obby-ui-scale)`. Never give a
  platform its own fixed sizes - that is how phones got a desktop-sized
  column - and never write `if mobile -> scale = X`.
- Anchors are fixed: the left rail is LEFT + VERTICAL CENTRE (each tile at
  `50% + (railTop - --obby-rail-center) * scale`), the progress bar BOTTOM +
  HORIZONTAL CENTRE on `--obby-hud-bottom`. `mobileStyles.ts` may only move
  things clear of the touch controls (keyed on `body.obby-touch-mode`, not on
  a device size), using the stick radius TouchControls publishes as
  `--obby-stick-r`.
- The client touches `window.Legion` - the Bloxity SDK - only inside
  `client/src/bloxity/`, and only through the `bloxity` façade in
  `BloxitySdk.ts`. The SDK is a third-party script from a CDN, so it can be
  blocked or missing; every method on the façade degrades to a no-op and the
  game stays fully playable without it. Nothing in the game loop may depend on
  it being there.

## Bloxity

The game is published on bloxity.io, whose SDK provides identity, avatars,
friends, portal settings and Bux. It runs identically embedded (an iframe on
bloxity.io, routed by postMessage) and standalone (our own host, routed to
api.bloxity.io) - there is one code path, never a branch on environment.

- `client/src/bloxity/` is the whole integration and the only place the SDK is
  reachable. `BloxityBridge` holds ONE `onUserChanged` subscription as the
  source of truth for identity; the panel, the avatar, the friends list and the
  Bux balance all hang off it. The user object is never cached - `getUser()` is
  read through every time, because a copy is one login away from being wrong.
- Portal settings are FORWARDED to whichever subsystem already owns the
  concern - volume to `AudioEngine`, resolution to `RendererManager`,
  sensitivity to `MouseLook`. The portal never becomes a second owner of
  anything, and only settings with a real effect are registered, because
  registering a listener is also what makes a control appear in the portal menu.
- Avatar PROPORTIONS are additive and their defaults are identity: every one
  is a multiplier around 1 applied to a rest pose captured once, so untouched
  proportions leave the rig exactly as shipped, and applying twice changes
  nothing. The layer writes bone POSITION and SCALE only - rotation belongs to
  `PlayerRig.applyPose`, which rebuilds it from the bind pose every frame.
- **A character is assembled exactly as the Bloxity SDK's own avatar renderer
  (`createAvatarPreview` in legion-sdk.js) assembles one** - that renderer is
  the ground truth, so read it before changing anything here:
  - body: `player.glb`, one skeleton, six skinned part meshes named
    `default_head`, `default_torso`, `default_arm_L/R`, `default_leg_L/R`;
  - parts: the SDK's `headId` / `torsoId` / `armLId` / `armRId` / `legLId` /
    `legRId` select `/avatars/parts/{head|torso}/{id}.glb` or
    `/avatars/parts/{arms|legs}/{id}_{L|R}.glb`, swapped in as the matching
    mesh's GEOMETRY with joint indices REMAPPED BY BONE NAME (a part lists its
    own joints in its own order). A missing or failed part falls back to
    Bloxity's default part for THAT slot only;
  - skin: ONE atlas per player, drawn for those meshes' UVs, on that
    character's own cloned material. It must NEVER go on player.fbx: the FBX
    has different UVs, and wrapping the atlas round it is what put a face on a
    leg. An unset skin (`-1`, empty) is Bloxity's default skin `0`
    (`resolveBloxitySkin`); an id with no id-named file (the built-in Default
    Skin, whose `assetPaths` texture is `skins/0.png`) also resolves to skin 0;
  - hat on `Neck1` at y 0.8, back item on `Spine2`, textures with three's
    DEFAULT flipY (OBJ UVs) - forcing `flipY = false` mirrors them;
  - proportions: the SDK's bone formulas for height, arm length, head scale
    and neck height. The SDK renderer does not apply shoulder width, leg
    spacing or torso width; those three are the plain reading of their names
    on the `*_Offset` joints and `Spine2`.
  A guest's selection is read from `getGuest().avatar`: the SDK's own
  `avatar.getEquipped()` reads only a logged-in user and reports `-1` for
  everyone else.
- Avatar ASSETS (`bloxity/BloxityAvatarAssets.ts`) are cached per asset as
  promises: one download per file however many players wear it, and a failure
  is remembered. Geometry, skins and accessory meshes are shared read-only;
  materials, accessory nodes and bone shaping are per character.
- Every character - local AND remote - is dressed by the same
  `AvatarAppearance`. The local player's look comes from the SDK; a remote
  player's from the replicated `legionAvatar` (`shared/config/avatarLook.ts`:
  skin, hat, back, the six part ids and proportions - catalog IDS only, never
  a model or texture - in one encoded string). It is cosmetic and
  client-supplied like the name; the server only re-encodes it through the
  shared parser, which drops unknown ids and clamps every proportion. Skin
  textures are cached per id across characters, so a room of default avatars
  is one texture.
- **Bux never grants anything client-side.** The client names a SKU and the
  portal charges for it; the price lives in Bloxity's catalog keyed by game
  slug. What that SKU is worth in Wins is decided by the shared catalog in
  `shared/src/config/bux.ts` and credited by the server when Bloxity's
  server-to-server webhook arrives at `/bloxity/bux-webhook`. A non-2xx reply
  REFUNDS the player, so only a grant that would be wrong answers with an
  error - and a duplicate delivery answers 200, because the first one already
  paid out.
- **Purchases are a durable QUEUE, addressed to the Bloxity account that
  paid** (the webhook's `userId`) - never to anything the browser supplies.
  `BuxGrants` records each one in the same store as the profiles, keyed by
  transaction id (so it pays once across pods and restarts), and the webhook
  answers 2xx only once that record is durable. A room hands grants over when
  that account is VERIFIED there - on join, on sign-in, and on a 3s poll -
  claiming them atomically (pending -> claimed -> applied), saving the Wins
  together with the ids in `buxApplied`, and marking them applied only once
  that save lands. A sweep settles claims left by a dead pod by reading
  `buxApplied`. Crediting the stored profile directly was wrong: a live
  player's next autosave wrote it back.
- **`pointer_lock_changed` is the portal handing off the pointer, not a
  report.** The SDK emits it ONLY from the portal's `legion_pointer_lock`
  message - false when the portal takes the pointer for its pause menu, true
  when it hands it back - and never echoes the game's own lock changes (it has
  no `pointerlockchange` listener). On false, release only a lock the game
  still HOLDS: a portal-initiated release is mid-flight (`exitPointerLock` is
  asynchronous), so the lock still reads as held, and releasing stops the game
  re-grabbing it behind the portal's menu. When the player's own Escape opened
  that menu the browser has already let go - and the portal sends NO true on
  Resume ("Skipping re-lock") - so the game's owed re-lock must stand. That is
  also why the portal menu is not modelled as input suppression: the Resume
  after an Escape emits nothing, and a suppressed game would never come back.
  Do not subscribe `portal.onPointerLockChanged` as well; in this SDK it is the
  same emitter, and every handoff would be handled twice.
- A player's Bloxity identity on the room - `legionName`, `legionUserId` and
  `legionPfp` - is CLIENT-SUPPLIED AND COSMETIC, like a nickname. The server
  only cleans its shape. Nothing that decides an outcome may read any of them:
  the name labels a player, the id aims friend requests, the avatar is a
  picture. (`legionAvatar`, the look, follows the same rule and travels with
  the join and through `UpdateAvatar`.) All three go with the join, and again
  through `UpdateIdentity` when
  `onUserChanged` reports a real change, because a guest who logs in after
  joining would otherwise stay known to everyone by their guest name, with no
  account to befriend.
- **Progress is keyed by the VERIFIED Bloxity account** (same pattern as
  +1 Speed Spaceship Escape). The client sends the SDK's login TOKEN (join
  option `bloxityToken`, and `Authenticate` on every login change, deduped) -
  never an account id. `bloxity/BloxityAuth.ts` asks Bloxity
  (`POST https://api.bloxity.io/v1/auth/game-token/verify`, Bearer token, body
  `{ gameSlug }`; the host is a constant) and a signed-in player plays on
  `bloxity:<account id>` on every device. Fail closed: only a 2xx carrying a
  string `_id` is verified. THREE outcomes - verified / rejected (guest) /
  unavailable (guest for now, re-verified on a backoff, never cached).
  Verified answers are cached briefly (capped at the token's exp), rejected
  ones for 30s, keyed by a hash of the token. Never verify the JWT locally:
  `JWT_SECRET` is the game's own secret, not Bloxity's key.
- **The slug is `anime-backflip-escape`** (`shared/src/config/bloxity.ts`,
  the bloxity.io/g/<slug> page), used by BOTH the client's `init` and the
  server's verification. A token is a capability for one game: verifying
  against any other slug rejects every signed-in player, which is exactly how
  progress stayed per-browser while it said `1-backflip-obby-escape`. It is
  NOT the hosting id `speed-backflip-escape` (Legion's `BLOXITY_GAME_ID`).
- Guests keep the browser key; `guestKeyFrom` refuses the `bloxity:`
  namespace so it cannot be forged. An account that has a profile ALWAYS wins
  and is never touched by browser data. On an account's FIRST verified login a
  guest profile with real progress (the LIVE state when signing in
  mid-session) is written with `insertIfAbsent` + `migratedFrom`; only after
  that succeeds is the guest copy marked `migratedTo` (kept as a recovery
  copy - a crash in between duplicates, never loses). A `migratedTo` profile is
  never restored, never migrated again and is off the boards; an empty guest
  profile is not migrated; a lost insert race loads the winner.
- Sign-in / sign-out mid-session is a MESSAGE on the live session, never a
  reconnect: autosaves blocked while switching, the profile being LEFT saved
  from live state, the new one applied through the same service order as
  `onJoin`, pending grants applied, player placed at spawn, saved. If storage
  fails mid-switch the session stays on its current profile; only the newest
  login counts (one arriving mid-switch is queued).
- `npm run verify:persistence` spawns the BUILT server with only the verify
  URL stubbed (`node --import scripts/support/bloxity-verify-stub.mjs`), joins
  with real colyseus.js clients and reads storage directly - JSON always,
  MongoDB with `PERSISTENCE_MONGO_HARNESS=scripts/support/mongod-harness.mjs`
  (real mongod, outage tests). The cosmetic `legionUserId` is never a storage
  key.
- **Identity is re-sent whenever it differs from what the ROOM has**, never
  gated on the account id changing: the SDK announces one login more than once
  (restored, then refreshed from its API) and a login can land after the join,
  so an id-only check left signed-in players with their guest name overhead
  and on the boards. `NetworkClient.updateIdentity` does the comparison.
- **The scoreboard picture is RENDERED FROM THE CURRENT LOOK**, not read from
  the account: `avatarPfpUrl` builds the SDK's own `getAvatarPfpPath` key
  (skin, hat, back, parts, proportions) and Bloxity's CDN renders any
  combination on demand. It is re-sent whenever the avatar changes; a stored
  `pfp` field only changes when the account is re-read, so the boards showed
  an old face. `resolvePfpUrl` (paths like `/pfps/s0.png` to CDN URLs) is the
  fallback when the SDK is absent. A full render key runs past 300 characters,
  so the server accepts picture URLs up to 600.
- **A player's shown name is Bloxity's own rule: `displayName || username`**
  (`visibleName` in `BloxitySdk.ts`), never with a leading `@` and never an
  internal or account id. The SDK's documented label for a player is
  `username`, and an account need not have a `displayName`; requiring one left
  those players nameless - no plate and "Player" on every board.
- **A player is their Bloxity name, everywhere it is shown** - the
  plate over their head, all three boards, the panel. Never an `@handle`,
  never the session id, and never the internal `playerId`. The boards used to
  derive a label from that id, which is why `leaderboardName` no longer
  exists: a generated identifier must not be able to creep back onto a public
  scoreboard. A player with no Bloxity name gets no plate rather than a
  fallback label, and a profile saved before identities existed reads
  "Player" until its owner next plays.
- `legionPfp` is validated harder than the other two because it is FETCHED
  rather than drawn: every other player's browser loads that URL, so only
  https on Bloxity's own hosts is accepted - a real `URL` parse, never a
  substring match, or `static.bloxity.io.attacker.net` would pass. The board
  loads it CORS-anonymous, because a tainted canvas cannot be uploaded as a
  WebGL texture and one bad avatar would take the whole scoreboard down.
- The name and avatar are PERSISTED in the profile, not just replicated. The
  boards are global and rank profiles whose owners are offline, and an offline
  player has no live state to read a name from.

## Current milestone

Milestone 9 (treadmill interaction, Wins spending, map connection) and
milestone 10 (redlines, Space Island, trails and auras) are complete. The route
now ends at Space Island (+200), redlines live in the gaps in a 1 / 2 / 3 / 3 /
3 / 3x3 pattern, and two cosmetic ladders exist: trails multiply movement speed
and auras multiply trophy rewards.

Milestone 8 (durable persistence and treadmills) is complete.

Profiles are written behind a `PersistenceAdapter`: Bloxity's managed MongoDB
in production (see Architecture rules) - progress does NOT reset on a deploy,
a restart or scale-to-zero, and a signed-in player's profile follows their
verified Bloxity account across devices - and in development a single JSON file
under `server/data/`, written debounced and ATOMICALLY - temp file, fsynced,
then renamed - so a crash mid-write cannot corrupt a save. The
room also autosaves every connected player every 15s, because Speed accrues
continuously between the discrete events that otherwise trigger a save.

Treadmills are the new gameplay system: eight decks along the back wall of the
starting platform, which grew to 54 x 56 to hold them without crowding the run.
A deck is a 0.2 step - deliberately inside the simulation's landing tolerance,
so walking on and off needs no step-up rule. Visual tier ramps with the gate:
colour, emissive frame, belt scroll speed, a lit halo from tier 4 and orbiting
energy cubes from tier 6. Every machine shares one geometry per part.

Milestone 7 (server-authoritative movement) is complete: the physics step and
the collision model moved into `shared/src/sim/`, the client sends input on a
fixed 60Hz step and predicts with reconciliation, and the server simulates and
owns every movement field. The old x3.5 speed cap is gone (now a 50x safety
rail), so R2+ scales properly.

Milestone 6 (real movement speed, rebirth, longer route) is complete on top of
milestone 5: level and rebirth now drive ACTUAL movement speed through one
shared formula, rebirth is implemented with the 10/20/30/40 cap ladder, gaps
after the second island are much larger, and progression survives a reconnect
via an in-memory profile store keyed by a browser-stored player id.

Milestone 5 (boots and the Win Shop) is complete, on top of milestone 4:
seven boot tiers bought by walking onto their pedestal, the Win Shop on the
right of an enlarged walled starting area, and sneakers worn on the player's
feet.

Milestone 4 (Speed, levels and game UI) remains, on top of the milestone 3
gorge: Speed farming from movement, a level curve that grants one backflip per
level, flip-gated island gaps, themed named islands, and the game HUD - wins
counter, Speed/level bar, airborne jump counter and floating Speed popups.

The gorge itself is the toy-brick reference style - blue tiled channel, steep
canyon walls, studded grass rims with instanced conifers, a cloudy sky - with
nine identical wide islands (+1 to +100) on one straight axis, left-hand
collection pads, server-validated trophy collection and red hazard lines. All
world textures are generated procedurally on canvas; no image assets.

The temporary test floor is gone.

**Not built yet, and out of scope until the milestone advances:** full UI,
monetization, final VFX, audio.

`ProfileStore` stays a process-wide singleton because a room dies with its last
client, but it is only a CACHE for the boards in front of a durable adapter;
progress-deciding reads go to storage. Two tabs in one browser still share a
guest `playerId`, and therefore one guest profile.

The level cap is `PROGRESSION.baseLevelCap`; rebirth will raise it. Boots will
multiply Speed per step - that hook belongs in `SpeedService`, nowhere else.

Backflips are ANIMATED and input-driven, but the progression that grants them
is not built: `BACKFLIP.defaultCapacity` in `shared/src/config/backflip.ts` is
a flat allowance that level progression will replace.

## Verification

Do not claim something works without running it. `npm run typecheck` must pass,
both servers must start, and browser behaviour must be checked in a real browser.
