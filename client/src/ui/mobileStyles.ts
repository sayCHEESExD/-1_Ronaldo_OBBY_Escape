/**
 * Responsive overrides for small and touch screens.
 *
 * ONE stylesheet rather than edits spread across seven components, and every
 * rule lives inside a media query - so the desktop layout is not merely
 * "mostly" preserved, it is literally the same cascade it always was. Nothing
 * here changes what a panel does; it changes where it sits and how big it is.
 *
 * HUD SIZE is not decided here. It comes from the one responsive scale in
 * `ui/uiScale.ts`, which every component multiplies its design px by - this
 * file used to swap in a separate set of fixed pixel sizes for phones, and
 * any phone that missed the breakpoint got the full desktop column instead.
 *
 * Every override here requires BOTH a small screen and `body.obby-touch-mode`
 * - the class the input layer adds when the on-screen controls actually
 * appear - because all it does is keep things clear of those controls.
 *
 * The `body.obby-touch-mode` prefix (specificity 0,2,1) also beats the
 * components' own single-class rules regardless of which stylesheet the
 * browser parsed first - injection order depends on construction order, which
 * is not something layout should rely on.
 */

let injected = false;

/** Phone-sized in either orientation. */
const SMALL = '(max-width: 900px), (max-height: 560px)';

/** Short and wide: a phone held sideways, where vertical room is the scarce axis. */
const LANDSCAPE = '(max-height: 560px) and (orientation: landscape)';

export const injectMobileStyles = (): void => {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.textContent = `
/*
 * Safe areas, published once as variables so every panel can respect the
 * notch and the home indicator without repeating env() everywhere.
 */
:root {
  /*
   * The touch stick's radius. TouchControls writes the live value here; this
   * is the same rule (15% of the short axis, 46-84px) for before it runs.
   */
  --obby-stick-r: clamp(46px, 15vmin, 84px);
  /* Where the resting stick ends on the right: rail clearance + its diameter. */
  --obby-stick-right: calc(max(26px, 92px * var(--obby-ui-scale, 1)) + 2 * var(--obby-stick-r) + 6px);
  --obby-safe-t: env(safe-area-inset-top, 0px);
  --obby-safe-r: env(safe-area-inset-right, 0px);
  --obby-safe-b: env(safe-area-inset-bottom, 0px);
  --obby-safe-l: env(safe-area-inset-left, 0px);
}

@media ${SMALL} {
  /* ---- Panels: fill the small screen and scroll inside. ---- */
  body.obby-touch-mode .obby-cos__card,
  body.obby-touch-mode .obby-rebirth__card {
    width: min(540px, calc(100vw - 16px));
    max-height: calc(100dvh - var(--obby-safe-t) - var(--obby-safe-b) - 16px);
  }
  body.obby-touch-mode .obby-cos__title { font-size: 22px; }
  body.obby-touch-mode .obby-cos__header { padding: 8px 9px 7px; }
  /*
   * A close control has to stay inside the viewport on a phone. The rebirth
   * card hangs its button outside the card corner, which is off-screen once
   * the card is as wide as the screen.
   */
  body.obby-touch-mode .obby-cos__close,
  body.obby-touch-mode .obby-rebirth__close {
    min-width: 44px;
    min-height: 44px;
  }
  body.obby-touch-mode .obby-rebirth__close { top: 6px; right: 6px; }
  body.obby-touch-mode .obby-rebirth__card { padding: 16px 14px 18px; }

  /* Touch targets: the platform minimum is 44px in the shorter axis. */
  body.obby-touch-mode .obby-cos__row { min-height: 52px; }
  body.obby-touch-mode .obby-cos__action,
  body.obby-touch-mode .obby-rebirth__confirm { min-height: 44px; }
  /* Capped above, so it has to be able to scroll or the confirm is unreachable. */
  body.obby-touch-mode .obby-rebirth__card { overflow-y: auto; }
}

@media ${LANDSCAPE} {
  body.obby-touch-mode .obby-cos__card,
  body.obby-touch-mode .obby-rebirth__card {
    max-height: calc(100dvh - var(--obby-safe-t) - var(--obby-safe-b) - 8px);
  }
}

/*
 * Touch controls on screen, on ANY device - phone or tablet: the HUD must
 * stay clear of them. Sizes are not touched: every HUD metric already scales
 * with the viewport through --obby-ui-scale (ui/uiScale.ts), and the left
 * rail stays anchored left-middle exactly as everywhere else.
 *
 * Default: the progress bar rises to sit just ABOVE the resting stick, since
 * a narrow screen has no room beside it.
 */
body.obby-touch-mode {
  --obby-hud-bottom: calc(var(--obby-safe-b) + 26px + 2 * var(--obby-stick-r) + 18px);
  /* Portal chat lines rise from just above the stick too. */
  --obby-chat-bottom: calc(var(--obby-safe-b) + 26px + 2 * var(--obby-stick-r) + 18px);
}
/*
 * Wide enough for the bar to fit BETWEEN the stick and the jump button: it
 * stays on the bottom edge, narrowed to the gap. Centred, so clearing the
 * stick (the wider of the two zones) clears the jump button as well.
 */
@media (min-width: 560px) {
  body.obby-touch-mode {
    --obby-hud-bottom: calc(var(--obby-safe-b) + 10px);
  }
  body.obby-touch-mode .obby-hud {
    width: clamp(
      180px,
      calc(100vw - 2 * (var(--obby-stick-right) + 18px)),
      calc(523px * var(--obby-ui-scale, 1))
    );
  }
}

/*
 * Touch mode, whatever the screen size: nothing may sit under a thumb, and no
 * gesture may scroll, select or zoom the page behind the game.
 */
body.obby-touch-mode {
  touch-action: none;
  overscroll-behavior: none;
}
/* Keyboard shortcut badges mean nothing without a keyboard. */
body.obby-touch-mode .obby-menu-key { display: none; }
body.obby-touch-mode .obby-cos__list,
body.obby-touch-mode .obby-rebirth__card {
  /* Panels are the ONE place a drag should scroll, and only along one axis. */
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}
`;
  document.head.append(style);
};
