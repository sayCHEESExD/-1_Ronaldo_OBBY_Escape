import { actionKeyFor } from '../config/menuKeys.js';
import type { AudioEngine } from '../audio/AudioEngine.js';

/**
 * The mute toggle and volume slider, in the left rail.
 *
 * A view over `AudioEngine` and nothing more - it never touches the audio
 * graph, and the engine tells it when to repaint so the two can never show
 * different states.
 */
export class AudioControls {
  private readonly root: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  /** The speaker glyph. Its own node so the key badge survives a repaint. */
  private readonly icon: HTMLSpanElement;
  private readonly slider: HTMLInputElement;
  private readonly audio: AudioEngine;

  constructor(parent: HTMLElement, audio: AudioEngine, top: number) {
    injectStyles();
    this.audio = audio;

    this.root = document.createElement('div');
    this.root.className = 'obby-audio';
    // See CosmeticShop: a custom property so the mobile stylesheet can move it.
    this.root.style.setProperty('--obby-rail-top', `${top}px`);

    this.button = document.createElement('button');
    this.button.className = 'obby-audio__btn';
    this.button.type = 'button';
    this.button.addEventListener('click', () => audio.toggleMuted());

    this.icon = document.createElement('span');
    this.button.appendChild(this.icon);

    // The tile is only clickable where there is a cursor - on touch, or with
    // a panel open over the top. A key is the way in the rest of the time, so
    // it is advertised on the control rather than left to be discovered.
    const muteKey = actionKeyFor('muteToggle');
    if (muteKey) {
      const badge = document.createElement('span');
      badge.className = 'obby-menu-key';
      badge.textContent = muteKey.label;
      this.button.appendChild(badge);
    }

    this.slider = document.createElement('input');
    this.slider.className = 'obby-audio__slider';
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '100';
    this.slider.step = '1';
    this.slider.addEventListener('input', () => {
      audio.setVolume(Number(this.slider.value) / 100);
      // Dragging the slider is a clear signal the player wants sound back.
      if (audio.muted && Number(this.slider.value) > 0) audio.setMuted(false);
    });

    this.root.append(this.button, this.slider);

    const down = actionKeyFor('volumeDown');
    const up = actionKeyFor('volumeUp');
    if (down && up) {
      const hint = document.createElement('div');
      hint.className = 'obby-audio__hint';
      hint.textContent = `${down.label} / ${up.label}`;
      this.root.appendChild(hint);
    }

    parent.appendChild(this.root);

    audio.onChange(() => this.render());
    this.render();
  }

  dispose(): void {
    this.root.remove();
  }

  private render(): void {
    // Only the glyph: writing to the button's own textContent would take the
    // key badge with it.
    this.icon.textContent = this.audio.muted ? '🔇' : '🔊';
    this.button.title = this.audio.muted ? 'Unmute' : 'Mute';
    this.root.classList.toggle('obby-audio--muted', this.audio.muted);
    const percent = Math.round(this.audio.volume * 100);
    if (this.slider.value !== String(percent)) this.slider.value = String(percent);
  }
}

let stylesInjected = false;

const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.obby-audio {
  position: fixed;
  left: calc(var(--obby-safe-l, 0px) + 12px * var(--obby-ui-scale, 1));
  top: calc(50% + (var(--obby-rail-top, 298px) - var(--obby-rail-center, 262px)) * var(--obby-ui-scale, 1));
  width: calc(68px * var(--obby-ui-scale, 1));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(5px * var(--obby-ui-scale, 1));
  z-index: 21;
}
/* Same rail tile as the other launchers - see CosmeticShop for the pattern. */
.obby-audio__btn {
  position: relative;
  width: calc(68px * var(--obby-ui-scale, 1));
  height: calc(44px * var(--obby-ui-scale, 1));
  padding: 0;
  border: calc(3px * var(--obby-ui-scale, 1)) solid #ffffff;
  border-radius: calc(13px * var(--obby-ui-scale, 1));
  background-color: #2f7fd0;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(0, 0, 0, 0.3));
  color: #ffffff;
  font: 900 calc(20px * var(--obby-ui-scale, 1))/1 system-ui, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.45);
  cursor: pointer;
}
.obby-audio__btn:hover { filter: brightness(1.1); }
.obby-audio__btn:active { transform: translateY(3px); box-shadow: none; }
.obby-audio--muted .obby-audio__btn { background-color: #5b6a86; }

/* Which keys move the slider. Hidden on touch, where it can just be dragged. */
.obby-audio__hint {
  margin-top: calc(-2px * var(--obby-ui-scale, 1));
  color: #cfe0f5;
  font: 800 calc(10px * var(--obby-ui-scale, 1))/1 system-ui, "Segoe UI", Roboto, sans-serif;
  text-shadow: 0 1px 0 #16202e;
  letter-spacing: 0.14em;
  pointer-events: none;
}
body.obby-touch-mode .obby-audio__hint { display: none; }

.obby-audio__slider {
  width: calc(66px * var(--obby-ui-scale, 1));
  height: calc(14px * var(--obby-ui-scale, 1));
  margin: 0;
  cursor: pointer;
  accent-color: #3aa8ff;
}
`;
  document.head.append(style);
};
