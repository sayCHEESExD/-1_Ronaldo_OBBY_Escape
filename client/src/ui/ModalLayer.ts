import { isTypingTarget } from '../config/menuKeys.js';

/**
 * A panel that can be shown and hidden.
 *
 * Deliberately tiny: the layer only needs to be able to close a panel and ask
 * whether it is showing. Each panel keeps owning its own DOM and its own
 * open/close behaviour.
 */
export interface ModalPanel {
  /** Hide the panel. Must be safe to call when already closed. */
  close(): void;
  /** True while the panel is showing. */
  readonly isOpen: boolean;
}

/**
 * The single owner of "which full-screen panel is showing".
 *
 * Before this existed each panel hid itself and knew nothing about the others,
 * so opening the Aura shop over the Trail shop left two stacked overlays and
 * Escape did nothing. Routing every open through here gives three guarantees
 * for free: only one panel is ever up, Escape always closes it, and gameplay
 * input is suppressed for exactly as long as one is up.
 *
 * Panels register once and call `opened` instead of showing themselves
 * directly; they still decide what "showing" means.
 */
class ModalLayer {
  private readonly panels = new Set<ModalPanel>();
  private readonly watchers = new Set<() => void>();
  private listening = false;

  register(panel: ModalPanel): void {
    this.panels.add(panel);
    this.listen();
  }

  unregister(panel: ModalPanel): void {
    this.panels.delete(panel);
  }

  /**
   * Announce that a panel is about to show, closing every other one.
   *
   * Called by the panel itself, so a panel never has to know its siblings.
   */
  opened(panel: ModalPanel): void {
    for (const other of this.panels) {
      if (other !== panel) other.close();
    }
    this.changed();
  }

  /**
   * Be told the moment the open panel changes, in the SAME event that changed
   * it.
   *
   * Polling `anyOpen` once a frame is enough to decide whether gameplay input
   * is suppressed, but not to re-acquire the pointer lock: a browser only
   * grants that inside the gesture that asked for it, and by the next frame
   * the gesture is over. Escape is the case that actually bites - it carries
   * no user activation at all - so the request has to be made here, while the
   * keystroke is still on the stack.
   *
   * @returns a function that stops watching.
   */
  watch(listener: () => void): () => void {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
    };
  }

  /** True while any registered panel is showing. */
  get anyOpen(): boolean {
    for (const panel of this.panels) {
      if (panel.isOpen) return true;
    }
    return false;
  }

  /** Close whatever is showing. */
  closeAll(): void {
    for (const panel of this.panels) panel.close();
    this.changed();
  }

  /** Tell every watcher the open panel changed. */
  private changed(): void {
    for (const watcher of this.watchers) watcher();
  }

  /** One Escape handler for every panel, attached on first registration. */
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (isTypingTarget(event.target)) return;
      // With nothing open there is nothing to close, and the keystroke is left
      // alone. It still reaches the browser, which releases the pointer lock
      // whatever this handler does; `MouseLook` treats that release as
      // accidental and takes the lock back.
      if (!this.anyOpen) return;
      event.preventDefault();
      this.closeAll();
    });
  }
}

export const modalLayer = new ModalLayer();
