/**
 * A frame-rate readout in the corner.
 *
 * Separate from `DebugOverlay`, which is compiled out of a production build:
 * this one is a PLAYER-FACING control the portal offers through the `show_fps`
 * setting, so it has to exist in the shipped game. It renders the figure the
 * game loop already measures rather than timing frames again.
 *
 * Hidden by default and costs nothing while hidden - the setter returns early
 * unless the whole number changed, so an idle meter does no DOM work at all.
 */
export class FpsMeter {
  private readonly root: HTMLElement;
  private shown = false;
  private lastDrawn = -1;

  constructor(parent: HTMLElement) {
    injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'obby-fps';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (this.shown === visible) return;
    this.shown = visible;
    this.root.hidden = !visible;
  }

  setFps(fps: number): void {
    if (!this.shown) return;
    const rounded = Math.round(fps);
    if (rounded === this.lastDrawn) return;
    this.lastDrawn = rounded;
    this.root.textContent = `${rounded} FPS`;
  }

  dispose(): void {
    this.root.remove();
  }
}

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.obby-fps {
  position: fixed;
  top: calc(10px * var(--obby-ui-scale, 1));
  right: calc(10px * var(--obby-ui-scale, 1));
  padding: calc(3px * var(--obby-ui-scale, 1)) calc(8px * var(--obby-ui-scale, 1));
  border-radius: calc(7px * var(--obby-ui-scale, 1));
  background: rgba(10, 16, 28, 0.6);
  color: #9ff5b5;
  font: 700 calc(12px * var(--obby-ui-scale, 1))/1.4 ui-monospace, Menlo, Consolas, monospace;
  pointer-events: none;
  z-index: 24;
}
`;
  document.head.appendChild(style);
};
