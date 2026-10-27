import type { Platform } from '../shared/core/platform';

declare const GM_getValue: ((key: string, defaultValue?: unknown) => unknown) | undefined;
declare const GM_setValue: ((key: string, value: unknown) => void) | undefined;
declare const GM_addStyle: ((css: string) => unknown) | undefined;

function hasGm(): boolean {
  return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
}

function localGet(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch (error) {
    return undefined;
  }
}

function localSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // localStorage can be disabled; ignore so the page keeps working.
  }
}

export function createUserscriptPlatform(): Platform {
  return {
    kind: 'userscript',
    get(key) {
      try {
        if (hasGm()) {
          const raw = GM_getValue!(key, null);
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw);
            } catch (error) {
              return raw;
            }
          }
          return raw;
        }
        return localGet(key);
      } catch (error) {
        return undefined;
      }
    },
    set(key, value) {
      try {
        if (hasGm()) {
          GM_setValue!(key, JSON.stringify(value));
        } else {
          localSet(key, value);
        }
      } catch (error) {
        // Ignore quota / permission errors.
      }
      return Promise.resolve();
    },
    onExternalChange(listener) {
      window.addEventListener('storage', () => listener());
    },
    addStyle(css) {
      if (typeof GM_addStyle === 'function') {
        GM_addStyle(css);
        return;
      }
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    },
  };
}
