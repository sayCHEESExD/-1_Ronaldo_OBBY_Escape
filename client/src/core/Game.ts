
import { AudioEngine } from '../audio/AudioEngine.js';
import { BloxityBridge, type BloxityHost } from '../bloxity/BloxityBridge.js';
import { bloxity } from '../bloxity/BloxitySdk.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { clientConfig } from '../config/clientConfig.js';
import { InputManager } from '../input/InputManager.js';
import { NetworkClient } from '../net/NetworkClient.js';
import type { ConnectionStatus, NetPlayerState } from '../net/netTypes.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { playerModelLoader, type PlayerModelReport } from '../player/PlayerModelLoader.js';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js';
import { ProgressionStore } from '../progression/ProgressionStore.js';
import { RunController } from '../progression/RunController.js';
import { ShopController } from '../progression/ShopController.js';
import { LandingDebris } from '../rendering/LandingDebris.js';
import { RendererManager } from '../rendering/RendererManager.js';
import { WinCups } from '../rendering/WinCups.js';
import { SceneManager } from '../rendering/SceneManager.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { FpsMeter } from '../ui/FpsMeter.js';
import { ProgressHud } from '../ui/ProgressHud.js';
import {
  AURA_TIERS,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  TRAIL_TIERS,
  encodeAvatarLook,
  type RespawnMessage,
} from '@obby/shared';
import { AudioControls } from '../ui/AudioControls.js';
import { CosmeticShop } from '../ui/CosmeticShop.js';
import {
  ACTION_KEYS,
  MENU_KEYS,
  isTypingTarget,
  menuKeyFor,
  type ActionId,
} from '../config/menuKeys.js';
import { iconMarkup } from '../config/uiIcons.js';
import { installHudScale } from '../ui/uiScale.js';
import { injectMobileStyles } from '../ui/mobileStyles.js';
import { modalLayer } from '../ui/ModalLayer.js';
import { RebirthPanel } from '../ui/RebirthPanel.js';
import { TrophyPopup } from '../ui/TrophyPopup.js';
import { SpeedPopups } from '../ui/SpeedPopups.js';
import { TreadmillHud } from '../ui/TreadmillHud.js';
import { WinsCounter } from '../ui/WinsCounter.js';
import { logger } from '../util/logger.js';
import { GorgeWorld } from '../world/GorgeWorld.js';

const SCOPE = 'Game';

/** Seconds between debug overlay repaints. */
const OVERLAY_INTERVAL = 0.25;

/**
 * Volume moved by one press of the volume keys.
 *
 * Ten steps across the whole range: coarse enough that a quick tap is
 * audible, fine enough that holding the key ramps smoothly rather than
 * jumping between silent and loud.
 */
const VOLUME_STEP = 0.1;

/**
 * Composition root. Owns every subsystem and defines the per-frame update
 * order. Deliberately holds no gameplay rules of its own.
 */
export class Game {
  private readonly renderer: RendererManager;
  private readonly sceneManager = new SceneManager();
  private readonly camera = new ThirdPersonCamera();
  private readonly input = new InputManager();
  private readonly remotePlayers: RemotePlayerManager;
  private readonly progression = new ProgressionStore();
  private readonly overlay: DebugOverlay | null;
  private readonly hud: ProgressHud;
  private readonly winsCounter: WinsCounter;
  private readonly rebirthPanel: RebirthPanel;
  private readonly speedPopups: SpeedPopups;
  private readonly treadmillHud: TreadmillHud;
  private readonly trailShop: CosmeticShop;
  private readonly auraShop: CosmeticShop;
  private readonly audio = new AudioEngine();
  private readonly audioControls: AudioControls;
  /** Player-facing frame counter, shown only when the portal asks for it. */
  private readonly fpsMeter: FpsMeter;
  /** Bloxity: identity, avatar, friends, portal settings and Bux. */
  private readonly bloxityBridge: BloxityBridge;
  /** One pooled debris burst shared by every player in the room. */
  private readonly debris = new LandingDebris();
  /** Pooled trophy burst, played when the server awards Wins. */
  private readonly winCups = new WinCups();
  private readonly trophyPopup: TrophyPopup;
  private readonly network: NetworkClient;
  private readonly world = new GorgeWorld();
  private readonly run: RunController;
  private readonly shop: ShopController;

  private localPlayer: LocalPlayer | null = null;
  /** Authoritative respawn waiting for the death transition to finish. */
  private pendingRespawn: RespawnMessage | null = null;
  private localSessionId: string | null = null;
  private modelReport: PlayerModelReport | null = null;

  /** Last replicated Speed total, used to derive gain popups. */
  private lastTotalSpeed = -1;

  /**
   * Leaderboard revision already drawn.
   *
   * Redrawing three canvases is far too expensive to do per patch, and the
   * boards move rarely - so the server bumps a counter when a row actually
   * changes and this compares one integer per frame.
   */
  private lastLeaderboardVersion = -1;

  /** Stops the modal watcher. Null until `start`. */
  private unwatchModals: (() => void) | null = null;

  /**
   * True while the room's EXISTING players are being delivered.
   *
   * Colyseus reports players already in the room through the same callback as
   * one who walks in later, and the portal has a different toast for each -
   * "your friend is in here" is not "your friend just arrived". The initial
   * batch arrives synchronously when the handler is registered, so a task
   * boundary is enough to tell the two apart.
   */
  private initialSyncPending = false;

  /**
   * Last replicated Wins total, used to spot an actual award.
   *
   * Wins are server-authoritative and only ever rise, so an INCREASE is the
   * one honest signal that a reward happened. A patch that merely repeats the
   * same total - and every patch carries it - changes nothing, which is what
   * keeps the effect from firing twice for one collection. Remote players
   * never reach here at all: this runs only for the local session.
   */
  private lastWins = -1;

  /**
   * An award waiting for the player to be back at spawn.
   *
   * The Wins patch usually lands while the death transition is still playing,
   * and cups thrown around a character mid-squash at the pad they just left
   * is not the moment being celebrated.
   */
  private winCelebrationPending = false;
  /** Wins the pending celebration paid - what the server's total rose by. */
  private winCelebrationAmount = 0;

  private overlayTimer = 0;
  private frameCount = 0;
  private fpsTimer = 0;
  private fps = 0;

  constructor(container: HTMLElement) {
    // Responsive overrides FIRST, so every panel built below is laid out for
    // this screen on its first paint rather than after a reflow.
    // ONE responsive scale for the whole HUD, driven by the viewport.
    installHudScale();
    injectMobileStyles();
    this.renderer = new RendererManager(container);
    this.remotePlayers = new RemotePlayerManager(this.sceneManager.scene);
    this.overlay = clientConfig.debug ? new DebugOverlay(container) : null;
    this.hud = new ProgressHud(container);
    this.winsCounter = new WinsCounter(container);
    this.rebirthPanel = new RebirthPanel(container, () => this.network.requestRebirth());
    this.speedPopups = new SpeedPopups(container);
    this.trophyPopup = new TrophyPopup(container);
    this.treadmillHud = new TreadmillHud(container);

    // Two shops, one panel: trails multiply movement speed, auras multiply
    // trophy rewards. Both only ever ASK - the server owns both ledgers.
    this.trailShop = new CosmeticShop(
      container,
      {
        title: 'Trails',
        icon: iconMarkup('trail'),
        menuKey: menuKeyFor('trails')?.label ?? '',
        effect: 'Speed',
        buttonTop: 146,
        accent: '#d05bd8',
        rows: TRAIL_TIERS.map((tier) => ({
          slot: tier.slot,
          name: tier.name,
          cost: tier.cost,
          multiplier: tier.multiplier,
          swatch: hex(tier.color),
          ...(tier.style === 'rainbow' ? { swatchAccent: '#3ad2ff' } : {}),
        })),
      },
      {
        buy: (slot) => this.network.buyTrail(slot),
        equip: (slot) => this.network.equipTrail(slot),
      },
    );

    this.auraShop = new CosmeticShop(
      container,
      {
        title: 'Aura',
        icon: iconMarkup('aura'),
        menuKey: menuKeyFor('auras')?.label ?? '',
        effect: 'Wins',
        buttonTop: 222,
        accent: '#3aa8ff',
        rows: AURA_TIERS.map((tier) => ({
          slot: tier.slot,
          name: tier.name,
          cost: tier.cost,
          multiplier: tier.multiplier,
          swatch: hex(tier.color),
          swatchAccent: hex(tier.accent),
        })),
      },
      {
        buy: (slot) => this.network.buyAura(slot),
        equip: (slot) => this.network.equipAura(slot),
      },
    );

    this.audioControls = new AudioControls(container, this.audio, 298);
    this.fpsMeter = new FpsMeter(container);

    // Bloxity gets a narrow host rather than the Game object: it is wiring,
    // and every entry below is either a setting the portal owns or a request
    // it can make. None of them decide anything the server is responsible for.
    this.bloxityBridge = new BloxityBridge(container, this.bloxityHost(), menuKeyFor('bloxity')?.label ?? '');
    this.sceneManager.scene.add(this.debris.mesh);
    this.sceneManager.scene.add(this.winCups.mesh);
    // A remote landing is reconstructed from replicated `grounded` - it throws
    // rubble, but deliberately no sound: there is no spatial audio to place it
    // with, so every distant landing would read as one at the player's feet.
    this.remotePlayers.onLanded = (x, y, z) => this.debris.burst(x, y, z);

    this.renderer.onResize((width, height) => this.camera.setViewport(width, height));

    this.network = new NetworkClient({
      onStatusChange: (status) => this.onStatusChange(status),
      onSelfJoined: (sessionId) => this.onSelfJoined(sessionId),
      onPlayerAdded: (sessionId, player) => this.onPlayerAdded(sessionId, player),
      onPlayerChanged: (sessionId, player) => this.onPlayerChanged(sessionId, player),
      onPlayerRemoved: (sessionId) => this.remotePlayers.remove(sessionId),
      onRespawn: (message) => {
        // The server's authoritative respawn. Held rather than applied at
        // once: the client is usually mid-transition, and the whole point of
        // the transition is that nothing moves the character until it ends.
        // `acknowledgeRespawn` lifts the reconciliation barrier here, because
        // every patch the server sends AFTER this message is post-respawn.
        this.pendingRespawn = message;
        this.localPlayer?.acknowledgeRespawn();
        this.applyPendingRespawn();
      },
    });

    this.run = new RunController(this.world.collision, {
      claimTrophy: (index) => {
        // Flush the transform first so the server can see the player standing
        // in the zone when it validates the claim.
        this.flushTransform();
        this.network.claimTrophy(index);
      },
      reportHazard: () => this.network.reportHazard(),
    });

    this.shop = new ShopController(this.world.collision, {
      buyBoot: (slot) => {
        // Flush the transform first: the server validates the purchase against
        // the last position it received, so at 20Hz the request would
        // otherwise overtake the position that justifies it.
        this.flushTransform();
        this.network.buyBoot(slot);
      },
    });
  }

  /**
   * The settings and actions the Bloxity portal may drive.
   *
   * Each one is forwarded to the subsystem that already owns that concern -
   * volume to the audio engine, resolution to the renderer, sensitivity to
   * mouse look - so the portal never becomes a second owner of anything.
   */
  private bloxityHost(): BloxityHost {
    return {
      setMasterVolume: (level) => this.audio.setVolume(level),
      setMusicVolume: (level) => this.audio.setMusicVolume(level),
      setGraphicsQuality: (level) => this.renderer.setQuality(level),
      setShowFps: (visible) => this.fpsMeter.setVisible(visible),
      setCameraSensitivity: (scale) => this.input.look.setSensitivityScale(scale),
      setPanelOpacity: (opacity) => {
        document.documentElement.style.setProperty(
          '--obby-panel-opacity',
          String(Math.min(Math.max(opacity, 0.2), 1)),
        );
      },
      // A REQUEST. The server decides where a respawn lands and replies with
      // the authoritative message, exactly as it does for a fall.
      respawn: () => this.network.requestRespawn(),
      getCharacterForAvatar: () => this.localPlayer?.character ?? null,
      setPortalPointerLock: (locked) => {
        const look = this.input.look;
        if (locked) {
          look.engage();
          return;
        }
        // Release only a lock the game still HOLDS. When the portal takes the
        // pointer itself, the SDK has just called exitPointerLock, which is
        // asynchronous - the lock still reads as held, and releasing here stops
        // the game re-grabbing it behind the portal's menu. When the player's
        // own Escape opened that menu, the browser has already let go and the
        // portal will not hand it back on Resume, so the owed re-lock must
        // stand: releasing then would leave a visible cursor over the game.
        if (look.locked) look.release();
      },
      setAvatarLook: (look) => this.network.setAvatarLook(look),
      updateIdentity: (name, userId, pfp) => {
        this.network.updateIdentity(name, userId, pfp);
        // The plate over this player's own head, which nobody else's state
        // carries. Remote plates follow the replicated name instead.
        this.localPlayer?.character.setDisplayName(name);
      },
      updateLogin: () => this.network.sendAuthenticate(),
      getRoomPlayers: () =>
        this.network.roomIdentities.filter((player) => player.sessionId !== this.localSessionId),
    };
  }

  /** Load assets and build the world. Networking is started separately. */
  async initialise(): Promise<PlayerModelReport> {
    this.world.addTo(this.sceneManager.scene, this.sceneManager);

    this.modelReport = await playerModelLoader.load();
    this.overlay?.setModelReport(this.modelReport);
    // The Win Shop's Ronaldos and the spawn statue are the same body every
    // character uses, so they can only be stood up once it has loaded.
    this.world.populateFigures();

    this.localPlayer = new LocalPlayer(this.world.collision);
    this.sceneManager.scene.add(this.localPlayer.character.root);
    this.sceneManager.scene.add(this.localPlayer.character.worldRoot);

    logger.info(SCOPE, 'world ready');
    return this.modelReport;
  }

  /** Join the Colyseus room. Rendering continues even if this fails. */
  async connect(): Promise<void> {
    // Introduce the player by their Bloxity name, so other clients can raise
    // a friend-joined toast. Guests are named too, so this is rarely empty.
    this.network.setIdentity(
      this.bloxityBridge.playerName,
      this.bloxityBridge.playerUserId,
      this.bloxityBridge.playerPfp,
    );
    // Sent with the join, so everyone sees this player's Bloxity look from
    // their very first frame rather than the bundled default.
    this.network.setAvatarLook(encodeAvatarLook(this.bloxityBridge.avatarLook));
    // WHOSE progress this is: the login token, which the server verifies with
    // Bloxity so a signed-in player gets their account's profile on every
    // device. Read at join time and again on every login change.
    this.network.setTokenProvider(() => this.bloxityBridge.loginToken);
    await this.network.connect();
  }

  /** One simulation + render step. Called by GameLoop. */
  update(delta: number, now: number): void {
    // A shop or the rebirth panel owns the input while it is up; closing it
    // hands control straight back on the next frame.
    this.input.setSuppressed(modalLayer.anyOpen);
    const input = this.input.sample();
    const player = this.localPlayer;

    // The MOUSE aims the camera, and the camera defines forward. Nothing the
    // player presses rotates the view.
    this.camera.setOrbit(this.input.look.yaw, this.input.look.pitch, this.input.look.distance);

    if (player) {
      // Camera-relative movement: W is whichever way the camera is facing.
      // The character's own facing then follows where it actually moves,
      // which the shared simulation does for both sides.
      player.update(delta, input, this.input.look.yaw);

      // Triggers are sampled after the player has moved, so a trophy pad or a
      // redline is detected at the position actually reached this frame.
      this.run.update(delta, player);
      // The death transition has run its course; place the player, preferring
      // the server's own transform when it has already arrived.
      if (player.deathComplete) this.applyPendingRespawn();
      this.shop.update(delta, player);

      this.snapCameraIfPlaced();
      this.camera.setTarget(player.position);
      this.sendTransform(now, player);

      // One landing, one effect. `justLanded` is the simulation's own edge, so
      // it cannot fire while merely standing.
      // A NORMAL jump off the ground - the simulation's own edge, which a flip
      // never raises (flips have their own sound below).
      if (player.justJumped) this.audio.jump();

      // One death, one sound: the run controller's edge fires only on the
      // frame a death begins. Banking a trophy uses the same transition but
      // is a reward, not a death - it gets the Win fanfare instead.
      const death = this.run.deathStartedThisFrame;
      if (death === 'fell' || death === 'redline') this.audio.death();

      // Footsteps while actually running on the ground - or on a treadmill
      // belt, where the character runs in place.
      this.audio.setWalking(player.isWalking);

      if (player.justLanded) {
        this.audio.land();
        this.debris.burst(player.position.x, player.position.y, player.position.z);
      }

      // One sound per flip that the SIMULATION started, so a chain climbs and
      // a press with nothing left is silent.
      const flips = player.flipsStartedThisFrame;
      // flipChainLength counts the whole chain so far, so stepping back by
      // the flips added this frame gives each one its own position in it.
      const chainBefore = player.flipChainLength - flips;
      for (let i = 0; i < flips; i += 1) this.audio.backflip(chainBefore + i);

      // Held until the respawn has finished, so the cups land around the
      // player at spawn rather than around a character mid-death.
      if (this.winCelebrationPending && !player.isDying) {
        this.winCelebrationPending = false;
        this.audio.win();
        this.winCups.burst(player.position.x, player.position.y, player.position.z);
        // The cups are small at camera distance; the popup is what reads.
        this.trophyPopup.show(this.winCelebrationAmount);
        this.winCelebrationAmount = 0;
      }
    }

    if (player) {
      this.hud.setJumps(!player.isGrounded, player.flipsRemaining, player.flipCapacity);
    }

    this.syncLeaderboards();

    this.speedPopups.update(delta);
    this.debris.update(delta);
    this.winCups.update(delta, this.camera.camera.quaternion);
    this.camera.update(delta);
    this.remotePlayers.update(delta);
    // After the camera, so the sky layers sit on this frame's eye position.
    this.world.update(delta, this.camera.camera.position, player?.position.z ?? 0);

    this.renderer.renderer.render(this.sceneManager.scene, this.camera.camera);

    this.updateDiagnostics(delta);
    this.fpsMeter.setFps(this.fps);
  }

  start(): void {
    window.addEventListener('keydown', this.onMenuKey);
    // Suppression is polled every frame as well, but a frame is too late to
    // ask for the pointer lock back: the browser only grants it inside the
    // gesture that asked. Escape closing a panel has to reach the input layer
    // while that keystroke is still running.
    this.unwatchModals = modalLayer.watch(() => {
      this.input.setSuppressed(modalLayer.anyOpen);
    });
    this.input.attach(this.renderer.renderer.domElement);
    // Audio waits for a real gesture; this only arms the listeners.
    this.audio.attach();

    // After the world and the local player exist, so the first avatar push
    // has something to dress.
    this.bloxityBridge.start();
    // The first `onUserChanged` is the CURRENT state rather than a change, so
    // it deliberately announces nothing - this is what puts the player's own
    // name over their own head on the first frame.
    this.localPlayer?.character.setDisplayName(this.bloxityBridge.playerName);
    bloxity.gameplayStart();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onMenuKey);
    this.bloxityBridge.dispose();
    this.fpsMeter.dispose();
    this.unwatchModals?.();
    this.unwatchModals = null;
    this.input.detach();
    this.remotePlayers.dispose();
    this.hud.dispose();
    this.winsCounter.dispose();
    this.rebirthPanel.dispose();
    this.speedPopups.dispose();
    this.treadmillHud.dispose();
    this.trailShop.dispose();
    this.auraShop.dispose();
    this.audioControls.dispose();
    this.audio.dispose();
    this.debris.dispose();
    this.winCups.dispose();
    this.trophyPopup.dispose();
    this.world.dispose();
    void this.network.disconnect();
    this.renderer.dispose();
  }

  /**
   * Push any buffered input immediately.
   *
   * Used before a request the server validates against position - a trophy
   * claim or a boot purchase - so the movement that justifies it is simulated
   * first. The server's own position is the one checked either way.
   */
  private flushTransform(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const message of player.drainOutgoing()) {
      this.network.sendInputNow(performance.now(), message);
    }
  }

  /**
   * Send this frame's INPUT. Never a transform - the server simulates movement
   * and owns the result.
   */
  private sendTransform(now: number, player: LocalPlayer): void {
    // Every simulated step must reach the server - it advances only by the
    // inputs it receives, so dropping one loses authoritative movement.
    for (const message of player.drainOutgoing()) {
      this.network.sendInput(now, message);
    }
  }

  /**
   * Bring the camera with the player when the player was PLACED.
   *
   * A respawn - a fall, a redline, a banked trophy - and a reconcile snap both
   * move the player somewhere they did not travel to. The camera's smoothing
   * exists to absorb movement, and easing it across a placement is exactly
   * what read as a zoom out followed by a zoom back in: the camera position
   * and the look target are both derived from the smoothed follow point, so
   * while it lagged, the camera sat far behind a player who had already
   * arrived.
   *
   * A respawn additionally plays a short zoom-IN: the follow point is already
   * at spawn on the first frame, so only the camera's distance moves and the
   * shot stays framed on the player throughout. That is what separates it from
   * the artefact it replaced, which drifted through every position between the
   * death and spawn.
   *
   * Safe to call at any time - it does nothing unless a placement is pending,
   * and reading the flag clears it, so one placement snaps exactly once.
   */
  /**
   * Place the player at spawn once the death transition allows it.
   *
   * Does nothing while the transition is still playing, so an authoritative
   * respawn that arrives early waits its turn rather than cutting the effect
   * short. Falls back to the shared spawn constants when the server has not
   * answered yet - the client predicted the respawn, and the server's own
   * message will simply confirm the same place.
   */
  private applyPendingRespawn(): void {
    const player = this.localPlayer;
    if (!player) return;
    if (player.isDying && !player.deathComplete) return;
    if (!player.isDying && !this.pendingRespawn) return;

    const at = this.pendingRespawn;
    player.teleport(
      at?.x ?? SPAWN_POSITION.x,
      at?.y ?? SPAWN_POSITION.y,
      at?.z ?? SPAWN_POSITION.z,
      at?.rotationY ?? SPAWN_ROTATION_Y,
    );
    this.pendingRespawn = null;
    this.snapCameraIfPlaced();
  }

  /**
   * Repaint the spawn scoreboards when the server says they moved.
   *
   * The rankings are global and server-authoritative; nothing here computes an
   * order or trusts a local figure. Rows arrive already sorted and already cut
   * to the top nine.
   */
  private syncLeaderboards(): void {
    const snapshot = this.network.leaderboards;
    if (!snapshot) return;
    if (snapshot.version === this.lastLeaderboardVersion) return;
    this.lastLeaderboardVersion = snapshot.version;

    const boards = this.world.leaderboards;
    boards.setRows('rebirths', snapshot.rebirths);
    boards.setRows('totalSpeed', snapshot.totalSpeed);
    boards.setRows('wins', snapshot.wins);
  }

  /**
   * Open and close panels from the keyboard.
   *
   * The bindings live in `menuKeys`, so a key is declared once and the rail
   * button that advertises it reads the same entry. Toggling routes through
   * each panel's own `toggle`, which already goes through `ModalLayer` - so
   * only one panel is ever up and the pointer lock follows automatically.
   */
  private readonly onMenuKey = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // Embedded, Escape belongs to the PORTAL: it owns the pause menu, and its
    // Resume is what puts the cursor back. `true` asks for that re-lock.
    // `ModalLayer` has already closed a panel if one was up, and only leaves
    // the event unconsumed when the player was actually playing.
    if (event.key === 'Escape') {
      if (!event.defaultPrevented && bloxity.isEmbedded()) bloxity.showPortalMenu(true);
      return;
    }

    // Rail actions first, because one of them repeats and the panel keys
    // deliberately do not.
    const action = ACTION_KEYS.find((b) => b.code === event.code);
    if (action) {
      if (event.repeat && !action.repeatable) return;
      event.preventDefault();
      this.runAction(action.id);
      return;
    }

    if (event.repeat) return;
    const binding = MENU_KEYS.find((b) => b.code === event.code);
    if (!binding) return;

    const panel =
      binding.id === 'bloxity'
        ? this.bloxityBridge.menuPanel
        : binding.id === 'rebirth'
        ? this.rebirthPanel
        : binding.id === 'trails'
          ? this.trailShop
          : this.auraShop;

    event.preventDefault();
    panel.toggle();
  };

  /**
   * Run a rail action bound to a key.
   *
   * These exist because the rail cannot be clicked during play - the pointer
   * is locked - and a panel's backdrop covers it the rest of the time. The
   * audio engine still owns muting and volume; this only asks.
   */
  private runAction(id: ActionId): void {
    switch (id) {
      case 'muteToggle':
        this.audio.toggleMuted();
        return;
      case 'volumeDown':
        this.audio.nudgeVolume(-VOLUME_STEP);
        return;
      case 'volumeUp':
        this.audio.nudgeVolume(VOLUME_STEP);
        return;
    }
  }

  private snapCameraIfPlaced(): void {
    const player = this.localPlayer;
    if (!player) return;
    const placement = player.consumePlacement();
    if (placement === 'none') return;
    // Only a respawn plays the dolly. A correction is the server quietly
    // disagreeing with prediction and happens on ordinary packet loss - a zoom
    // there would turn a network hiccup into a cutscene.
    this.camera.snapTo(player.position, placement === 'respawn');
  }

  private onStatusChange(status: ConnectionStatus): void {
    this.overlay?.setStatus(status);
    // A room this player can no longer reach is not one to invite a friend
    // into. Cleared when the connection is lost and re-announced when it comes
    // back, so an invite link never points at a room they have left.
    if (status === 'disconnected' || status === 'error') {
      this.bloxityBridge.setRoom('');
    } else if (status === 'connected' && this.network.roomId) {
      this.bloxityBridge.setRoom(this.network.roomId);
    }
  }

  private onSelfJoined(sessionId: string): void {
    this.localSessionId = sessionId;
    this.remotePlayers.setLocalSessionId(sessionId);
    this.overlay?.setSessionId(sessionId);

    // Tell the portal which room a friend's invite should land in. Colyseus
    // routes a full room's overflow to a new one, so this is the only id that
    // actually means "here".
    this.bloxityBridge.setRoom(this.network.roomId ?? '');

    // Everyone already present arrives in the next synchronous batch.
    this.initialSyncPending = true;
    window.setTimeout(() => {
      this.initialSyncPending = false;
    }, 0);
  }

  private onPlayerAdded(sessionId: string, player: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalProgression(player);
      return;
    }
    this.remotePlayers.add(sessionId, player);
    this.overlay?.setRemoteCount(this.remotePlayers.count);

    // The portal raises a toast only if this name is one of the player's
    // friends; it is given every name and decides for itself.
    const name = player.legionName;
    if (this.initialSyncPending) this.bloxityBridge.playerInRoom(name);
    else this.bloxityBridge.playerJoined(name);
  }

  private onPlayerChanged(sessionId: string, player: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalProgression(player);
      // The server has simulated further; snap prediction to it and replay
      // whatever it has not acknowledged yet.
      this.localPlayer?.reconcile(player);
      // A reconcile SNAP places the player. Handled here rather than waiting
      // for the next frame, because one frame of the camera easing across a
      // placement is still a frame the player did not ask for.
      this.snapCameraIfPlaced();
      return;
    }
    this.remotePlayers.apply(sessionId, player);
    this.overlay?.setRemoteCount(this.remotePlayers.count);
  }

  /**
   * Mirror the local player's server-authoritative progression: flip capacity
   * follows level, and the HUD shows the replicated Speed total. Nothing here
   * computes progress - the popups only visualise a gain the server granted.
   */
  private applyLocalProgression(player: NetPlayerState): void {
    if (this.lastTotalSpeed >= 0 && player.totalSpeed > this.lastTotalSpeed) {
      this.speedPopups.add(player.totalSpeed - this.lastTotalSpeed);
    }
    this.lastTotalSpeed = player.totalSpeed;

    // An award, not a repeat: the first sight of a player only takes the
    // baseline, and equal totals do nothing.
    if (this.lastWins >= 0 && player.wins > this.lastWins) {
      this.winCelebrationPending = true;
      this.winCelebrationAmount += player.wins - this.lastWins;
    }
    this.lastWins = player.wins;

    this.progression.applyFromNetwork(player);
    this.winsCounter.update(player.wins);
    // Movement speed is the server's number, applied verbatim.
    this.localPlayer?.setMoveMultiplier(player.moveMultiplier);
    this.localPlayer?.setBackflipCapacity(player.backflipCapacity);
    this.localPlayer?.setMaxTreadmillTier(player.maxTreadmillTier);
    this.rebirthPanel.update({
      level: player.level,
      maxLevel: player.maxLevel,
      rebirths: player.rebirths,
    });
    this.world.bootShop.setState(player.wins, player.ownedBoots, player.bootSlot);
    // Treadmill state is entirely the server's; the HUD and the row only
    // mirror what it replicated.
    this.world.treadmills.setRebirths(player.rebirths);
    this.treadmillHud.update({
      standing: player.treadmillStanding,
      active: player.treadmillTier,
      maxTier: player.maxTreadmillTier,
      multiplier: player.treadmillMultiplier,
      speedPerStep: player.speedPerStep,
      rebirths: player.rebirths,
    });
    this.shop.setState(player.wins, player.ownedBoots);
    this.localPlayer?.setRonaldoSlot(player.bootSlot);
    this.localPlayer?.setCosmetics(player.trailSlot, player.auraSlot);
    this.trailShop.setState(player.wins, player.ownedTrails, player.trailSlot);
    this.auraShop.setState(player.wins, player.ownedAuras, player.auraSlot);
    this.hud.update(
      player.totalSpeed,
      player.maxLevel,
      player.rebirths,
    );
  }

  private updateDiagnostics(delta: number): void {
    if (!this.overlay) return;

    this.frameCount += 1;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 0.5) {
      this.fps = this.frameCount / this.fpsTimer;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    this.overlayTimer += delta;
    if (this.overlayTimer < OVERLAY_INTERVAL) return;
    this.overlayTimer = 0;

    const player = this.localPlayer;
    if (player) {
      this.overlay.setPlayer(
        player.position.x,
        player.position.y,
        player.position.z,
        player.horizontalSpeed,
      );
      this.overlay.setAnimation(
        player.animationState,
        player.flipsRemaining,
        player.flipsInProgress,
        player.isGrounded,
      );
      this.overlay.setWins(this.progression.value.wins);
    }
    this.overlay.setFps(this.fps);
    this.overlay.setRemoteCount(this.remotePlayers.count);
    this.overlay.render();
  }
}

/** Hex integer -> CSS colour, for the shop swatches. */
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
