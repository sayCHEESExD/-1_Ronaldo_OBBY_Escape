import { logger } from '../util/logger.js';

const SCOPE = 'uiIcons';

/**
 * Custom UI art, in ONE place.
 *
 * Files live in the repo's `assets/ui/` folder, which is Vite's publicDir - so
 * its contents are served from the SITE ROOT, and `assets/ui/aura.png` is
 * fetched as `/ui/aura.png`. Never copy them into `client/`.
 *
 * Every icon keeps its original emoji as a fallback, and a missing file logs
 * a named warning. That matters more than it sounds: a wrong path here does
 * NOT 404 - the SPA redirect answers with `index.html` and HTTP 200, so the
 * browser silently receives HTML where it expected an image and draws nothing
 * at all. A blank button with no console output is very hard to read.
 */
export type UiIconName = 'trail' | 'aura' | 'rebirth' | 'trophy' | 'shoe' | 'run';

/** What each icon was before it was art, and what it falls back to. */
const EMOJI: Readonly<Record<UiIconName, string>> = {
  trail: '💫',
  aura: '🌀',
  rebirth: '🔄',
  trophy: '🏆',
  shoe: '👟',
  run: '🏃',
};

/** URL an icon is served from. */
export const uiIconUrl = (name: UiIconName): string => `/ui/${name}.png`;

let listening = false;

/**
 * Replace any icon that fails to load with its emoji, and say which one.
 *
 * Registered on the CAPTURE phase because `error` from an <img> does not
 * bubble, so a listener on `document` only ever sees it going down.
 */
const listenForFailures = (): void => {
  if (listening || typeof document === 'undefined') return;
  listening = true;

  document.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.classList.contains('obby-icon')) return;

      const name = target.dataset['icon'] as UiIconName | undefined;
      logger.warn(
        SCOPE,
        `icon "${String(name)}" did not load from ${target.getAttribute('src') ?? '?'} ` +
          '- check the filename in assets/ui/. Falling back to the emoji.',
      );

      const span = document.createElement('span');
      span.textContent = name ? EMOJI[name] : '';
      target.replaceWith(span);
    },
    true,
  );
};

/**
 * Markup for an icon, for the several places that build their UI with
 * `innerHTML`.
 *
 * `.obby-icon` sizes the image in `em`, so ONE file serves the desktop rail
 * tile, the smaller mobile tile, the modal title and an inline price label
 * without a second asset or a second size.
 */
export const iconMarkup = (name: UiIconName): string => {
  listenForFailures();
  return `<img class="obby-icon" data-icon="${name}" src="${uiIconUrl(name)}" alt="">`;
};

/** The same icon as a real element, for callers that build nodes directly. */
export const iconElement = (name: UiIconName): HTMLImageElement => {
  listenForFailures();
  const img = document.createElement('img');
  img.className = 'obby-icon';
  img.dataset['icon'] = name;
  img.src = uiIconUrl(name);
  img.alt = '';
  return img;
};

/**
 * Load an icon for drawing into a canvas, e.g. a world-space sign.
 *
 * Resolves to null rather than rejecting when the file is missing, so a caller
 * can simply keep whatever it already drew.
 */
export const loadIconImage = (name: UiIconName): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => {
      logger.warn(SCOPE, `sign icon "${name}" did not load - keeping the emoji`);
      resolve(null);
    });
    img.src = uiIconUrl(name);
  });
