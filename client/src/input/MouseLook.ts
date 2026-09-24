import { CAMERA } from '@obby/shared';

/**
 * Zoom per wheel notch, as a distance multiplier. Multiplicative so a notch
 * feels the same close in as far out.
 */
const ZOOM_PER_NOTCH = 1.12;

/** Wheel pixels in one notch, for devices that report pixels (most mice). */
const PIXELS_PER_NOTCH = 100;

/** Radians of rotation per pixel of mouse movement. */
const SENSITIVITY = 0.0026;

/** Pitch limits, so the camera can never flip over the player. */
const MIN_PITCH = -0.55;
const MAX_PITCH = 1.15;

/**
 * Mouse look for the third-person camera.
 *
 * Accumulates yaw and pitch from raw pointer deltas. It owns NOTHING else -
 * the camera reads these two angles and the player controller rotates its
 * movement input by the yaw, so looking around never moves the character and
 * moving never turns the camera.
 *
 * Pointer lock follows the PANEL state, not clicks:
 *
 *   gameplay        -> cursor hidden, mouse steers the camera
 *   a panel opens   -> lock released, cursor free for its buttons
 *   the panel closes-> lock retaken, camera resumes at once
 *   Escape          -> the browser releases; the lock is taken straight back
 *
 * A PANEL IS THE ONLY THING THAT SHOWS A CURSOR. Escape does not, and neither
 * does anything else: the browser forces the lock open on Escape and no page
 * can prevent that, so the release is treated as accidental and reversed. Two
 * things do the reversing, because neither is enough on its own - the lock is
 * re-requested, which browsers refuse for a moment after an Escape, and the
 * cursor is hidden in CSS meanwhile, which covers the gap until the player's
 * next keystroke or click makes the request stick.
 *
 * The player is never trapped: Escape still works at the browser's level every
 * time, and the shop and rebirth keys give a real cursor on demand.
 *
 * The lock is taken on the player's FIRST gesture rather than waiting for a
 * deliberate click on the world. A browser will not grant it without one, so
 * "automatic" can only mean "on the first thing the player does" - and since a
 * keypress counts, pressing W to walk is enough. There is no click-to-play
 * step.
 *
 * Shops are opened by key, not by clicking the world, so nothing here needs to
 * distinguish a click on a panel from a click on the game: while a panel is up
 * this source is suppressed outright.
 *
 * Touch look goes through the SAME accumulator via `addLookDelta`, so the
 * pitch limits, the yaw wrap and the suppression rule exist once and cannot
 * drift between the two devices.
 */
export class MouseLook {
  private canvas: HTMLElement | null = null;

  private yawValue = 0;
  private pitchValue = 0.22;
  /** Camera distance chosen with the wheel; the default until it is used. */
  private distanceValue = CAMERA.distance;
  private suppressed = false;
  /** True while the left button is down and the pointer is NOT locked. */
  private dragging = false;

  /**
   * Whether this browser has ever actually granted the lock.
   *
   * Only used to decide whether drag-to-look is needed. Where pointer lock
   * works, holding the button must NOT steer - the cursor is free for the UI
   * and dragging on the world would be a second, invisible camera control.
   * Where it is refused - a sandboxed frame, an embedded preview - dragging
   * stays as the fallback, because otherwise there is no way to look around
   * at all.
   */
  private lockEverGranted = false;

  /**
   * Whether the player has done anything yet.
   *
   * A page cannot lock the pointer before its first user gesture, so this
   * records that the gesture has happened and the lock may be taken - and
   * retaken - from then on.
   */
  private armed = false;

  /** Portal sensitivity setting, as a multiple of `SENSITIVITY`. */
  private sensitivityScale = 1;

  /**
   * A re-lock that is owed but has not been granted.
   *
   * A browser will not grant a lock from an Escape keystroke: the HTML spec
   * excludes Esc from the input events that count as user activation,
   * precisely so a page cannot instantly re-trap a cursor the user escaped.
   * The request is still made - some browsers and embeddings honour it - and
   * when it is refused the debt is remembered and paid off on the player's
   * very next real gesture, which is the W press or click they were about to
   * make anyway.
   *
   * Set whenever the lock is lost with no panel up, which is the definition of
   * a release nobody asked for.
   */
  private pendingLock = false;

  get yaw(): number {
    return this.yawValue;
  }

  get pitch(): number {
    return this.pitchValue;
  }

  /** Orbit distance chosen with the mouse wheel, within the camera limits. */
  get distance(): number {
    return this.distanceValue;
  }

  /** True while the browser has the pointer captured. */
  get locked(): boolean {
    return !!this.canvas && document.pointerLockElement === this.canvas;
  }

  /**
   * Scale mouse sensitivity, 1 being the game's own tuning.
   *
   * A MULTIPLIER rather than a replacement, so the portal's slider moves the
   * feel around the value this game was tuned at instead of redefining it.
   * Touch look goes through the same accumulator and is deliberately left
   * alone: a drag is already proportional to the finger's travel.
   */
  setSensitivityScale(scale: number): void {
    this.sensitivityScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    canvas.addEventListener('mousedown', this.onMouseDown);
    // On the CANVAS, like the click: panels are DOM above it, so a wheel over
    // a shop scrolls the shop and never reaches the camera. Not passive, so
    // a wheel over the world cannot also scroll an embedding page.
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('keydown', this.onFirstGesture);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  detach(): void {
    this.canvas?.removeEventListener('mousedown', this.onMouseDown);
    this.canvas?.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onFirstGesture);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.body.classList.remove('obby-cursor-hidden');
    this.canvas = null;
  }

  /**
   * Stop looking while a panel owns the screen, and hand the cursor back.
   *
   * Releasing the lock is what makes the shop buttons clickable. Closing the
   * panel deliberately does NOT take it back: the player may well want to open
   * another shop, and re-grabbing the cursor the instant a panel closes is the
   * behaviour that makes a menu feel like it is fighting you. One click on the
   * world resumes play.
   */
  setSuppressed(suppressed: boolean): void {
    const wasSuppressed = this.suppressed;
    this.suppressed = suppressed;

    if (suppressed) {
      this.dragging = false;
      this.pendingLock = false;
      this.applyCursor();
      if (this.locked) document.exitPointerLock();
      return;
    }

    // The panel closed. Take the lock straight back so the camera resumes
    // without the player having to click the world first - closing a menu IS
    // the request to go back to playing. If the browser refuses, `pendingLock`
    // keeps the request alive; it is cleared the moment the lock arrives.
    if (wasSuppressed && this.armed) {
      this.pendingLock = true;
      this.requestLock();
    }
    this.applyCursor();
  }

  /**
   * Arm the lock and take it as soon as the browser allows.
   *
   * Called from the first real user gesture. Kept separate from the gesture
   * handlers so an embedding host - a portal SDK owning its own menu and
   * pointer-lock lifecycle - has one method to drive instead of having to
   * synthesise clicks.
   */
  engage(): void {
    this.armed = true;
    if (!this.suppressed) this.requestLock();
    this.applyCursor();
  }

  /**
   * Hand the lock and the cursor back to whatever is embedding the game.
   *
   * Disarms as well as releasing, which is what separates this from a panel
   * opening: a suppressed source is still playing and takes the lock back the
   * moment the panel closes, whereas a released one has stopped, shows a
   * cursor and waits to be engaged again.
   */
  release(): void {
    this.dragging = false;
    this.pendingLock = false;
    this.armed = false;
    if (this.locked) document.exitPointerLock();
    this.applyCursor();
  }

  /**
   * Toggle the lock. This is the ONLY thing that ever acquires it.
   *
   * Bound to the canvas, so it hears clicks on the game world and nothing
   * else: every panel, button and backdrop is DOM above the canvas and stops
   * the event before it arrives. That is what keeps a click on a shop from
   * grabbing the cursor the player is using to click it.
   */
  /**
   * Any keypress is a user gesture, and the first one arms the lock.
   *
   * This is what removes the click-to-play step: the player presses W to walk
   * and the cursor disappears on the same keystroke. Escape is excluded - it
   * is how the player asks to be LET OUT, so it must never be the thing that
   * puts them back in.
   */
  private readonly onFirstGesture = (event: KeyboardEvent): void => {
    // Escape can never carry the activation a lock needs, so it is not the
    // keystroke that restores one - it only ever loses it. The debt it leaves
    // behind is settled by the next key that does count.
    if (event.key === 'Escape') return;
    if (!this.armed) {
      this.engage();
      return;
    }
    // A re-lock the browser refused during a panel close, paid off by the
    // first keystroke that DOES carry user activation.
    if (this.pendingLock && !this.locked && !this.suppressed) this.requestLock();
  };

  /** A click on the world resumes play after Escape released the lock. */
  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.suppressed || event.button !== 0) return;
    this.armed = true;
    if (this.locked) return;

    // Only where the lock is refused outright does holding the button steer;
    // see `lockEverGranted`.
    this.dragging = !this.lockEverGranted;
    this.requestLock();
  };

  /**
   * The lock was gained or lost.
   *
   * Nothing is re-acquired here. Escape, a tab switch and the browser's own
   * release all land in the same place - cursor visible, camera still - and
   * the player takes control back by clicking the world.
   */
  private readonly onLockChange = (): void => {
    if (this.locked) {
      this.lockEverGranted = true;
      this.pendingLock = false;
      // A granted lock supersedes drag-to-look; the two must never both steer.
      this.dragging = false;
      this.applyCursor();
      return;
    }

    this.dragging = false;
    // Lost the lock with no panel up. Nothing in the game asks for that, so it
    // came from Escape, an alt-tab or the browser itself - all of which are
    // reversed rather than accepted, because a cursor over the HUD is not a
    // state this game has. The immediate retry usually fails during the
    // browser's post-Escape cooldown; `pendingLock` is what actually gets it
    // back, on the next keystroke or click.
    if (!this.suppressed && this.armed) {
      this.pendingLock = true;
      this.requestLock();
    }
    this.applyCursor();
  };

  /**
   * Show a cursor only while a panel owns the screen.
   *
   * Guarded on `lockEverGranted` so it can never hide a cursor the player
   * still needs: where pointer lock is refused outright - a sandboxed frame,
   * an embedded preview - the rail buttons are the only way into the shops and
   * they have to stay clickable.
   */
  private applyCursor(): void {
    const hide = this.armed && this.lockEverGranted && !this.suppressed;
    document.body.classList.toggle('obby-cursor-hidden', hide);
  }

  /**
   * Ask for the lock, tolerating every way a browser can say no.
   *
   * The request rejects on its own promise in sandboxed frames and during the
   * browser's own post-Escape cooldown. Neither is a fault - drag-to-look
   * still works - so it is caught rather than left to surface as an unhandled
   * rejection.
   */
  private requestLock(): void {
    if (!this.canvas || this.locked || this.suppressed) return;
    const request = this.canvas.requestPointerLock?.() as unknown;
    if (request instanceof Promise) request.catch(() => undefined);
  }

  private readonly onMouseUp = (): void => {
    this.dragging = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.suppressed) return;
    if (!this.locked && !this.dragging) return;
    const sensitivity = SENSITIVITY * this.sensitivityScale;
    this.addLookDelta(event.movementX * sensitivity, event.movementY * sensitivity);
  };

  /**
   * Apply a look delta already scaled to RADIANS.
   *
   * The one place yaw and pitch are written. Mouse movement and touch drags
   * both arrive here, so neither can invent its own pitch clamp.
   */
  addLookDelta(deltaYaw: number, deltaPitch: number): void {
    if (this.suppressed) return;
    if (!Number.isFinite(deltaYaw) || !Number.isFinite(deltaPitch)) return;

    this.yawValue -= deltaYaw;
    this.pitchValue += deltaPitch;

    // Wrapping keeps the accumulated yaw finite over a long session.
    if (this.yawValue > Math.PI) this.yawValue -= Math.PI * 2;
    else if (this.yawValue < -Math.PI) this.yawValue += Math.PI * 2;

    this.pitchValue =
      this.pitchValue < MIN_PITCH
        ? MIN_PITCH
        : this.pitchValue > MAX_PITCH
          ? MAX_PITCH
          : this.pitchValue;
  }

  /**
   * Mouse wheel: up zooms in, down zooms out, clamped to the camera limits.
   *
   * Ignored while a panel is up, exactly like looking - the menu owns the
   * screen and its own scrolling.
   */
  private readonly onWheel = (event: WheelEvent): void => {
    if (this.suppressed) return;
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault();

    // Normalise to notches: pixel-mode wheels report ~100 per notch, line
    // mode ~3 lines, page mode one page.
    const notches =
      event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
        ? event.deltaY / PIXELS_PER_NOTCH
        : event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY / 3
          : Math.sign(event.deltaY);

    const next = this.distanceValue * ZOOM_PER_NOTCH ** notches;
    this.distanceValue = Math.min(Math.max(next, CAMERA.minDistance), CAMERA.maxDistance);
  };

  private readonly onBlur = (): void => {
    this.dragging = false;
  };
}
