/**
 * Keyboard shortcuts for the player-facing panels.
 *
 * ONE list, so a binding is declared once and read by both the key handler and
 * the button that advertises it. Scattering `event.code === 'Digit1'` through
 * the UI is how two panels end up on the same key without anyone noticing.
 *
 * Digits rather than letters on purpose: the movement bindings already own
 * WASD, the arrows, Space and Shift, and a digit row cannot collide with any
 * of them however the movement set grows. They also map to the rail's order
 * top to bottom, which is what the labels show.
 */

/** A panel that a shortcut can open and close. */
export interface MenuTarget {
  readonly isOpen: boolean;
  toggle(): void;
}

export interface MenuBinding {
  /** Identifies the panel this opens. */
  readonly id: 'rebirth' | 'trails' | 'auras' | 'bloxity';
  /** `KeyboardEvent.code`, so the binding is layout-independent. */
  readonly code: string;
  /** Shown on the panel's rail button. */
  readonly label: string;
}

export const MENU_KEYS: readonly MenuBinding[] = [
  { id: 'rebirth', code: 'Digit1', label: '1' },
  { id: 'trails', code: 'Digit2', label: '2' },
  { id: 'auras', code: 'Digit3', label: '3' },
  { id: 'bloxity', code: 'Digit4', label: '4' },
];

/**
 * Keyboard actions that are not panels.
 *
 * These exist because the cursor never leaves gameplay: the pointer is locked
 * while playing, and while a panel IS open the rail sits behind that panel's
 * backdrop - so a rail control that only responds to a click can never be
 * reached. Anything on the rail therefore needs a key, and every key in the
 * game is declared in this one file so two of them cannot quietly collide.
 *
 * M, minus and equals are free: movement owns WASD, the arrows, Space and
 * Shift, and the digit row opens the panels.
 */
export type ActionId = 'muteToggle' | 'volumeDown' | 'volumeUp';

export interface ActionBinding {
  readonly id: ActionId;
  /** `KeyboardEvent.code`, so the binding is layout-independent. */
  readonly code: string;
  /** Shown on the control this drives. */
  readonly label: string;
  /** Whether holding the key should repeat - a volume ramp, not a toggle. */
  readonly repeatable: boolean;
}

export const ACTION_KEYS: readonly ActionBinding[] = [
  { id: 'muteToggle', code: 'KeyM', label: 'M', repeatable: false },
  { id: 'volumeDown', code: 'Minus', label: '\u2212', repeatable: true },
  { id: 'volumeUp', code: 'Equal', label: '+', repeatable: true },
];

/** The binding for an action, for the control that advertises it. */
export const actionKeyFor = (id: ActionId): ActionBinding | undefined =>
  ACTION_KEYS.find((binding) => binding.id === id);

/** The binding for a panel, for the button that advertises it. */
export const menuKeyFor = (id: MenuBinding['id']): MenuBinding | undefined =>
  MENU_KEYS.find((binding) => binding.id === id);

/**
 * True when a keystroke belongs to something the player is typing into.
 *
 * There are no text fields in the game today, but the audio volume slider is a
 * real `<input>` and anything added later would be too. A shortcut that fires
 * while a control has focus is the classic way a hotkey eats a keystroke that
 * was meant for something else.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};
