import { parseAvatarLook } from '@obby/shared';
import type { Scene } from 'three';
import { AvatarAppearance } from '../bloxity/AvatarAppearance.js';
import type { NetPlayerState } from '../net/netTypes.js';
import { logger } from '../util/logger.js';
import { RemotePlayer } from './RemotePlayer.js';

const SCOPE = 'RemotePlayerManager';

/**
 * Creates, updates and destroys the ghosted characters for every player in the
 * room except the local one.
 */
export class RemotePlayerManager {
  private readonly scene: Scene;
  private readonly players = new Map<string, RemotePlayer>();
  /**
   * Each remote player's Bloxity look, and the layer that dresses them in it.
   * The same `AvatarAppearance` the local player uses, fed from replicated
   * state instead of the SDK - so every client dresses a given player alike.
   */
  private readonly avatars = new Map<string, { appearance: AvatarAppearance; look: string }>();

  private localSessionId: string | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  setLocalSessionId(sessionId: string): void {
    this.localSessionId = sessionId;
    // The local player may have been added before we learned our own id.
    this.remove(sessionId);
  }

  get count(): number {
    return this.players.size;
  }

  add(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) return;
    if (this.players.has(sessionId)) return;

    const player = new RemotePlayer(sessionId);
    player.setNetworkTransform(state.x, state.y, state.z, state.rotationY);
    player.setMotionState(state);
    this.scene.add(player.character.root);
    // World-space effects are a sibling of the character, not a child - a
    // trail must stay where it was laid down.
    this.scene.add(player.character.worldRoot);
    player.character.setCosmetics(state.trailSlot, state.auraSlot);
    // Named from replicated state, so every client sees the same name over the
    // same player - and a player with no Bloxity name gets no plate at all.
    player.character.setDisplayName(state.legionName ?? '');
    this.players.set(sessionId, player);
    this.applyLook(sessionId, player, state.legionAvatar);

    logger.info(SCOPE, `remote player added: ${sessionId} (total ${this.players.size})`);
  }

  apply(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) return;

    const player = this.players.get(sessionId);
    if (!player) {
      this.add(sessionId, state);
      return;
    }

    player.setNetworkTransform(state.x, state.y, state.z, state.rotationY);
    player.setMotionState(state);
    // Cosmetics come from replicated state, so every client sees the same
    // trail and aura on a given player.
    player.character.setCosmetics(state.trailSlot, state.auraSlot);
    player.character.boots.setSlot(state.bootSlot);
    // Re-applied on every patch so a player who logs in mid-session stops
    // being their guest name on everyone else's screen. `setDisplayName`
    // returns early when it has not changed, so this costs nothing per patch.
    player.character.setDisplayName(state.legionName ?? '');
    this.applyLook(sessionId, player, state.legionAvatar);
  }

  /**
   * Dress a remote character in their replicated Bloxity look.
   *
   * An empty look is NOT "use the bundled texture": it parses to Bloxity's
   * default avatar, exactly as it would for the local player. Re-applied only
   * when the encoded string changes, so an idle patch costs a comparison.
   */
  private applyLook(sessionId: string, player: RemotePlayer, encoded: string | undefined): void {
    const look = encoded ?? '';
    let entry = this.avatars.get(sessionId);
    if (entry && entry.look === look) return;
    if (!entry) {
      entry = { appearance: new AvatarAppearance(player.character), look };
      this.avatars.set(sessionId, entry);
    }
    entry.look = look;
    entry.appearance.applyLook(parseAvatarLook(look));
  }

  remove(sessionId: string): void {
    const player = this.players.get(sessionId);
    if (!player) return;
    this.avatars.get(sessionId)?.appearance.dispose();
    this.avatars.delete(sessionId);
    player.dispose();
    this.players.delete(sessionId);
    logger.info(SCOPE, `remote player removed: ${sessionId} (total ${this.players.size})`);
  }

  /**
   * Called when a remote player touches down, with their world position.
   *
   * Derived entirely from replicated state, so remote landing effects cost no
   * network traffic at all.
   */
  onLanded: ((x: number, y: number, z: number) => void) | null = null;

  update(delta: number): void {
    for (const player of this.players.values()) {
      player.update(delta);
      if (!player.landedThisFrame) continue;
      const at = player.character.root.position;
      this.onLanded?.(at.x, at.y, at.z);
    }
  }

  dispose(): void {
    for (const entry of this.avatars.values()) entry.appearance.dispose();
    this.avatars.clear();
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
  }
}
