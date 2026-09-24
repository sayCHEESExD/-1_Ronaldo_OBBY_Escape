import { NO_AURA, auraBySlot, type AuraStyle } from '@obby/shared';
import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  OctahedronGeometry,
} from 'three';
import { PLAYER_HEIGHT } from '@obby/shared';

/** Orbiting motes. One InstancedMesh, so the whole aura is two draw calls. */
const MOTE_COUNT = 12;

/** Radius the motes orbit at. */
const ORBIT_RADIUS = 1.15;

/**
 * The glow worn around a player.
 *
 * Parented to the character, so it follows every animation for free. Two
 * meshes total whatever the tier: a translucent back-face shell that reads as
 * a glow, and one InstancedMesh of motes whose motion and colour give each
 * aura its identity. Nothing here is per-particle geometry.
 *
 * Cosmetic only. Which aura is worn - and what it multiplies - is the server's
 * decision; this renders the replicated slot and nothing else.
 */
export class AuraEffect {
  readonly root = new Group();

  private readonly shellGeometry = new IcosahedronGeometry(1, 1);
  private readonly moteGeometry = new OctahedronGeometry(0.13, 0);
  private readonly shellMaterial: MeshBasicMaterial;
  private readonly moteMaterial: MeshBasicMaterial;
  private readonly shell: Mesh;
  private readonly motes: InstancedMesh;
  private readonly dummy = new Object3D();

  private slot = NO_AURA;
  private style: AuraStyle = 'flame';
  private readonly color = new Color(0xffffff);
  private readonly accent = new Color(0xffffff);
  private readonly scratch = new Color();
  private time = 0;

  constructor() {
    this.shellMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      // Back faces only, so the player is never hidden inside their own glow.
      side: BackSide,
      blending: AdditiveBlending,
      fog: false,
    });
    this.moteMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });

    this.shell = new Mesh(this.shellGeometry, this.shellMaterial);
    this.shell.scale.set(1.35, PLAYER_HEIGHT * 0.55, 1.35);
    this.shell.position.y = PLAYER_HEIGHT * 0.5;

    this.motes = new InstancedMesh(this.moteGeometry, this.moteMaterial, MOTE_COUNT);
    this.motes.frustumCulled = false;

    this.root.add(this.shell, this.motes);
    this.root.visible = false;
  }

  /** Wear an aura, or `NO_AURA` to remove it. */
  setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;

    const tier = auraBySlot(slot);
    if (!tier) {
      this.root.visible = false;
      return;
    }

    this.style = tier.style;
    this.color.setHex(tier.color);
    this.accent.setHex(tier.accent);
    this.shellMaterial.color.copy(this.color);

    // Dark styles cannot glow additively - black added to a scene is nothing -
    // so they draw normally and lean on their accent motes for contrast.
    const dark = this.style === 'darkmatter' || this.style === 'devil';
    this.shellMaterial.blending = dark ? NormalBlending : AdditiveBlending;
    this.shellMaterial.opacity = dark ? 0.42 : 0.22;

    this.root.visible = true;
  }

  update(delta: number): void {
    if (!this.root.visible) return;
    this.time += delta;

    const pulse = 1 + Math.sin(this.time * this.pulseRate()) * 0.06;
    this.shell.scale.set(1.35 * pulse, PLAYER_HEIGHT * 0.55 * pulse, 1.35 * pulse);

    for (let i = 0; i < MOTE_COUNT; i += 1) {
      this.placeMote(i);
      this.dummy.updateMatrix();
      this.motes.setMatrixAt(i, this.dummy.matrix);
      this.motes.setColorAt(i, this.moteColor(i));
    }
    this.motes.instanceMatrix.needsUpdate = true;
    if (this.motes.instanceColor) this.motes.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.shellGeometry.dispose();
    this.moteGeometry.dispose();
    this.shellMaterial.dispose();
    this.moteMaterial.dispose();
  }

  /** Where one mote sits this frame. The motion is the aura's personality. */
  private placeMote(index: number): void {
    const phase = (index / MOTE_COUNT) * Math.PI * 2;
    const t = this.time;
    let radius = ORBIT_RADIUS;
    let height = PLAYER_HEIGHT * 0.5;
    let scale = 1;

    switch (this.style) {
      case 'flame':
        // Rising and shrinking, like embers off a fire.
        height = ((t * 1.6 + index / MOTE_COUNT) % 1) * PLAYER_HEIGHT;
        radius = 0.55 + (1 - height / PLAYER_HEIGHT) * 0.35;
        scale = 1 - height / PLAYER_HEIGHT / 1.4;
        break;
      case 'sparkle':
        radius = 0.8 + Math.sin(t * 5 + phase) * 0.45;
        height = PLAYER_HEIGHT * (0.2 + ((index * 0.37) % 1) * 0.7);
        scale = 0.6 + Math.abs(Math.sin(t * 7 + phase)) * 0.9;
        break;
      case 'lightning':
        // Snaps between positions instead of gliding.
        radius = 0.9 + (Math.floor(t * 12 + index) % 3) * 0.22;
        height = PLAYER_HEIGHT * (0.15 + ((Math.floor(t * 9) + index) % 5) / 6);
        scale = 1.15;
        break;
      case 'toxic':
        height = ((t * 0.9 + index / MOTE_COUNT) % 1) * PLAYER_HEIGHT;
        radius = 1.05 + Math.sin(t * 2 + phase) * 0.2;
        scale = 0.8 + Math.sin(t * 3 + phase) * 0.3;
        break;
      case 'darkmatter':
        // Spirals inward, so it reads as being pulled in rather than shed.
        radius = 0.4 + ((t * 0.5 + index / MOTE_COUNT) % 1) * 1.1;
        height = PLAYER_HEIGHT * 0.5 + Math.sin(t + phase) * 0.7;
        scale = 1.3 - radius / 2;
        break;
      case 'royal':
        // A steady crown, the only aura whose motes hold formation.
        radius = 0.95;
        height = PLAYER_HEIGHT * 0.98 + Math.sin(t * 2 + phase) * 0.06;
        scale = 1.25;
        break;
      default:
        radius = ORBIT_RADIUS + Math.sin(t * 2 + phase) * 0.12;
        height = PLAYER_HEIGHT * 0.5 + Math.sin(t * 1.5 + phase) * 0.75;
        scale = 1;
        break;
    }

    const angle = phase + t * this.spinRate();
    this.dummy.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    this.dummy.rotation.set(t + phase, t * 0.7 + phase, 0);
    this.dummy.scale.setScalar(Math.max(0.05, scale));
  }

  private moteColor(index: number): Color {
    switch (this.style) {
      case 'disco':
        this.scratch.setHSL((this.time * 0.6 + index / MOTE_COUNT) % 1, 1, 0.6);
        break;
      case 'rich':
      case 'royal':
        this.scratch.copy(index % 3 === 0 ? this.accent : this.color);
        break;
      case 'lightning':
        this.scratch.copy(Math.floor(this.time * 12 + index) % 2 === 0 ? this.accent : this.color);
        break;
      case 'flame':
        this.scratch.copy(this.color).lerp(this.accent, (index / MOTE_COUNT + this.time) % 1);
        break;
      default:
        this.scratch.copy(index % 4 === 0 ? this.accent : this.color);
        break;
    }
    return this.scratch;
  }

  private spinRate(): number {
    if (this.style === 'lightning') return 0.2;
    if (this.style === 'royal') return 0.6;
    if (this.style === 'darkmatter') return 1.8;
    return 1.1;
  }

  private pulseRate(): number {
    if (this.style === 'lightning') return 14;
    if (this.style === 'crimson' || this.style === 'devil') return 5;
    return 2.4;
  }
}
