import { fetchProfileColor } from '../api/anilist';
import type { AppContext } from '../core/context';
import type { AccentName } from '../core/palette';
import { accentLabel, accentPalette, isDarkTheme, rgbTriplet, SHADE_STEPS } from '../core/palette';

const LAST_USER_KEY = 'alx:last-user';
const OVERLAY_NOTE = ' (set in settings)';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isGuestHeader(): boolean {
  return Boolean(document.querySelector('.nav a[href="/login"], .nav a[href="/signup"], .mobile-nav a[href="/login"]'));
}

function findHeaderUsername(): string | null {
  const anchors = document.querySelectorAll('a[href^="/user/"]');
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as HTMLAnchorElement;
    if (anchor.closest('.user-page-unscoped')) {
      continue;
    }
    const path = anchor.getAttribute('href') || '';
    const match = /^\/user\/([^/?#]+)\/?$/.exec(path);
    if (!match) {
      continue;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 || rect.top > 220) {
      continue;
    }
    try {
      return decodeURIComponent(match[1]);
    } catch (error) {
      return match[1];
    }
  }
  return null;
}

function applyAccent(color: AccentName): void {
  const palette = accentPalette(color, isDarkTheme());
  const root = document.documentElement;
  root.style.setProperty('--color-blue', rgbTriplet(palette.base));
  root.style.setProperty('--color-blue-dim', rgbTriplet(palette.dim));
  for (let index = 0; index < SHADE_STEPS.length; index += 1) {
    root.style.setProperty('--color-blue-' + SHADE_STEPS[index], rgbTriplet(palette.shades[index]));
  }
  root.classList.add('alx-accent-applied');
}

function clearAccent(): void {
  const root = document.documentElement;
  root.style.removeProperty('--color-blue');
  root.style.removeProperty('--color-blue-dim');
  for (let index = 0; index < SHADE_STEPS.length; index += 1) {
    root.style.removeProperty('--color-blue-' + SHADE_STEPS[index]);
  }
  root.classList.remove('alx-accent-applied');
}

export function mountProfileColor(ctx: AppContext): () => void {
  let active = true;
  let currentColor: AccentName | null = null;
  let themeObserver: MutationObserver | null = null;

  const applyCurrent = (): void => {
    if (!currentColor) {
      return;
    }
    if (currentColor === 'blue') {
      clearAccent();
      return;
    }
    applyAccent(currentColor);
  };

  const watchTheme = (): void => {
    if (themeObserver || !document.body) {
      return;
    }
    themeObserver = new MutationObserver(() => {
      if (active) {
        applyCurrent();
      }
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  };

  const readUsername = async (): Promise<string | null> => {
    const settings = ctx.settings.get();
    const configured = settings.profileUsername.trim();
    if (configured) {
      return configured;
    }
    let fromHeader = findHeaderUsername();
    if (!fromHeader && !isGuestHeader()) {
      // The content script can start before Vue has rendered the nav.
      for (let attempt = 0; attempt < 12 && active && !fromHeader; attempt += 1) {
        await delay(400);
        fromHeader = findHeaderUsername();
      }
    }
    if (fromHeader) {
      return fromHeader;
    }
    const stored = await ctx.platform.get(LAST_USER_KEY);
    return typeof stored === 'string' && stored ? stored : null;
  };

  const run = async (): Promise<void> => {
    const settings = ctx.settings.get();
    if (!settings.profileColor) {
      currentColor = null;
      clearAccent();
      ctx.status.set('');
      return;
    }

    watchTheme();

    if (settings.profileColorSource !== 'auto') {
      currentColor = settings.profileColorSource;
      applyCurrent();
      ctx.status.set('Profile accent: ' + accentLabel(settings.profileColorSource) + OVERLAY_NOTE);
      return;
    }

    const username = await readUsername();
    if (!active) {
      return;
    }
    if (!username) {
      currentColor = null;
      clearAccent();
      ctx.status.set('Profile accent: set your AniList username in the settings to detect it.');
      return;
    }

    try {
      const color = await fetchProfileColor(ctx.platform, username);
      if (!active) {
        return;
      }
      void ctx.platform.set(LAST_USER_KEY, username);
      if (!color) {
        currentColor = null;
        clearAccent();
        ctx.status.set('Profile accent: no profile color found for ' + username + '.');
        return;
      }
      currentColor = color;
      applyCurrent();
      if (color === 'blue') {
        ctx.status.set('Profile accent: Blue is the AniList default, nothing to override (' + username + ').');
      } else {
        ctx.status.set('Profile accent: ' + accentLabel(color) + ' (' + username + ').');
      }
    } catch (error) {
      if (!active) {
        return;
      }
      currentColor = null;
      clearAccent();
      ctx.status.set('Profile accent: could not load the color for ' + username + '.');
    }
  };

  void run();

  return () => {
    active = false;
    if (themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
    clearAccent();
  };
}
