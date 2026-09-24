import type { PlayerAnimationState } from '@obby/shared';
import type { ConnectionStatus } from '../net/netTypes.js';
import type { PlayerModelReport } from '../player/PlayerModelLoader.js';

/**
 * Minimal diagnostics panel for milestone verification.
 *
 * This is NOT the game UI - it exists so the FBX skeleton, connection state
 * and remote-player count can be confirmed at a glance in a real browser.
 */
export class DebugOverlay {
  private readonly element: HTMLDivElement;

  private status: ConnectionStatus = 'idle';
  private sessionId = '-';
  private remoteCount = 0;
  private position = '0.0, 0.0, 0.0';
  private speed = 0;
  private fps = 0;
  private modelLine = 'model: loading';
  private boneLine = 'bones: -';
  private animLine = 'anim: -';
  private wins = 0;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.style.cssText = [
      'position:fixed',
      // Sits below the wins counter, which owns the top-left corner.
      'top:58px',
      'left:14px',
      'padding:8px 10px',
      'background:rgba(8,12,24,0.72)',
      'color:#cbd5f5',
      'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'border:1px solid rgba(125,211,252,0.25)',
      'border-radius:6px',
      'pointer-events:none',
      'white-space:pre',
      'max-width:min(92vw,560px)',
      'overflow:hidden',
      'z-index:10',
    ].join(';');
    parent.appendChild(this.element);
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  setRemoteCount(count: number): void {
    this.remoteCount = count;
  }

  setModelReport(report: PlayerModelReport): void {
    this.modelLine =
      `model: ${report.meshNames.length} mesh, ${report.vertexCount} verts, ` +
      `h=${report.heightWorldUnits.toFixed(2)}u, clips=${report.animationClipNames.length}`;
    this.boneLine = `bones(${report.boneNames.length}): ${report.boneNames.join(' ')}`;
  }

  /** Animation diagnostics. `flipsAvailable` and `flipsInFlight` are different
   *  pieces of state and are shown separately on purpose. */
  setAnimation(
    state: PlayerAnimationState,
    flipsAvailable: number,
    flipsInFlight: number,
    grounded: boolean,
  ): void {
    this.animLine =
      `anim: ${state.padEnd(15)} ${grounded ? 'grounded' : 'airborne'}   ` +
      `flips avail: ${flipsAvailable}  in-flight: ${flipsInFlight}`;
  }

  setWins(wins: number): void {
    this.wins = wins;
  }

  setPlayer(x: number, y: number, z: number, speed: number): void {
    this.position = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    this.speed = speed;
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  render(): void {
    this.element.textContent = [
      `net: ${this.status}   session: ${this.sessionId}   ghosts: ${this.remoteCount}   wins: ${this.wins}`,
      `pos: ${this.position}   speed: ${this.speed.toFixed(1)}   fps: ${this.fps.toFixed(0)}`,
      this.modelLine,
      this.boneLine,
    ].join('\n');
  }
}
