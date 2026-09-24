import { STARTER_BOOT, type PlayerAnimationState } from '@obby/shared';
import { Group, Object3D } from 'three';
import type { AnimationInput } from '../animation/AnimationInput.js';
import { PlayerAnimator } from '../animation/PlayerAnimator.js';
import { AuraEffect } from './AuraEffect.js';
import { TrailEffect } from './TrailEffect.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { AvatarAppearance } from '../bloxity/AvatarAppearance.js';
import { NamePlate } from './NamePlate.js';
import { PLAYER_MODEL_YAW_OFFSET } from '../config/playerVisuals.js';
import { playerModelLoader } from './PlayerModelLoader.js';

/**
 * The visual half of a player: a cloned FBX instance, its bone rig and its
 * animator, arranged so animation can never move the player.
 *
 * Node hierarchy:
 *   root       physics transform (world position + facing yaw). Gameplay owns
 *              this; the animator never writes to it.
 *     flipPivot  raised to hip height, carries the backflip rotation so the
 *                character spins around its own centre of mass in place.
 *       visual   carries the vertical bob.
 *         avatarRoot  body proportions from the player's Bloxity avatar.
 *           model  the cloned FBX (scaled), whose bones the rig poses.
 */
export class PlayerCharacter {
  /** Attach this to the scene. Its transform is the player transform. */
  readonly root = new Group();

  /**
   * World-space effects that must NOT follow the character.
   *
   * A trail is what the player has already passed through, so it cannot be
   * parented to a moving root. Whoever adds `root` to the scene adds this too.
   */
  readonly worldRoot = new Group();

  readonly animator: PlayerAnimator;
  readonly rig: PlayerRig;
  /**
   * Everything this character looks like: the player's Bloxity avatar, or -
   * whenever a Ronaldo tier is equipped, which is always in this game - that
   * Ronaldo in its place. One owner, so the two can never both paint it.
   */
  readonly appearance: AvatarAppearance;
  /** Worn glow. Parented to the character, so it follows the animation. */
  readonly aura = new AuraEffect();
  /** Ribbon left behind. Lives in `worldRoot`, not on the character. */
  readonly trail = new TrailEffect();

  /**
   * The player's Bloxity display name, floating above them.
   *
   * On `root`, the physics transform - not the flip pivot, which would
   * cartwheel it through a backflip, and not `visual`, which the death squash
   * scales.
   */
  readonly namePlate = new NamePlate();

  /**
   * Whole-body scale from the player's Bloxity avatar proportions.
   *
   * Its own node rather than a write to `visual` or `model`: `visual.scale` is
   * the death squash and the model clone's own scale is the FBX unit
   * conversion, so proportions written to either would be undone by an effect
   * or would undo the conversion. One owner per node is what keeps all three
   * independent.
   */
  readonly avatarRoot = new Group();

  private readonly flipPivot = new Group();
  private readonly visual = new Group();
  private readonly model: Object3D;

  constructor() {
    this.model = playerModelLoader.createInstance();

    // player.fbx already faces +Z; the offset exists so a re-authored model
    // can be corrected without touching gameplay code.
    this.model.rotation.y = PLAYER_MODEL_YAW_OFFSET;

    this.root.add(this.flipPivot);
    this.flipPivot.add(this.visual);
    this.visual.add(this.avatarRoot);
    this.avatarRoot.add(this.model);

    // Bind against the model's own space so the rig is independent of where
    // the character stands or which way it faces.
    this.rig = new PlayerRig(this.model, this.model);
    this.animator = new PlayerAnimator(this.rig, this.flipPivot, this.visual);
    // Built while the rig is still at bind pose - it seats Ronaldo's hair from
    // it. Every player starts as the starter Ronaldo, exactly as every player
    // used to start in the starter boots, until the server says otherwise.
    this.appearance = new AvatarAppearance(this);
    this.appearance.setOutfit(STARTER_BOOT.slot);

    this.root.add(this.aura.root);
    this.root.add(this.namePlate.sprite);
    this.worldRoot.add(this.trail.root);
  }

  /**
   * Name this character on screen.
   *
   * The player's BLOXITY DISPLAY NAME, never an internal id. An empty name
   * hides the plate rather than inventing a label.
   */
  setDisplayName(name: string): void {
    this.namePlate.setName(name);
  }

  /**
   * The cloned FBX itself.
   *
   * Exposed for the avatar layer, which re-skins its materials and hangs
   * accessories off its bones. Nothing else should need it - position, facing
   * and animation all have their own accessors above.
   */
  get modelRoot(): Object3D {
    return this.model;
  }

  /**
   * Become the Ronaldo of the tier the server says is equipped - the whole
   * character, not an outfit on top of it. Cosmetic only.
   */
  setOutfit(slot: number): void {
    this.appearance.setOutfit(slot);
  }

  /** Show the cosmetics the server says this player has equipped. */
  setCosmetics(trailSlot: number, auraSlot: number): void {
    this.trail.setSlot(trailSlot);
    this.aura.setSlot(auraSlot);
  }

  /**
   * Advance the cosmetic effects.
   *
   * Separate from `update` because the trail needs the player's world position
   * and speed, which the animation input does not carry.
   */
  updateEffects(delta: number, x: number, y: number, z: number, speed: number): void {
    this.aura.update(delta);
    this.trail.update(delta, x, y, z, speed);
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  /**
   * Scale the character for a presentation effect - the death squash.
   *
   * Written to the VISUAL node, never to `root`: root is the physics
   * transform gameplay owns, and the same rule that stops the animator moving
   * the player stops this too. The animator writes this node's position (the
   * bob) and never its scale, so the two cannot fight.
   */
  setVisualScale(x: number, y: number, z: number): void {
    this.visual.scale.set(x, y, z);
  }

  /** Advance the animation. Never changes `root`. */
  update(delta: number, input: AnimationInput): void {
    this.animator.update(delta, input);
  }

  get animationState(): PlayerAnimationState {
    return this.animator.currentState;
  }

  /** Clear animation state, e.g. after a server-issued respawn. */
  resetAnimation(): void {
    this.animator.reset();
    this.visual.scale.set(1, 1, 1);
    // The ribbon describes a run that no longer exists; keeping it would draw
    // a line from the old position to the spawn point.
    this.trail.clear();
  }

  dispose(): void {
    this.appearance.dispose();
    this.namePlate.dispose();
    this.aura.dispose();
    this.trail.dispose();
    this.root.removeFromParent();
    this.worldRoot.removeFromParent();
  }
}
