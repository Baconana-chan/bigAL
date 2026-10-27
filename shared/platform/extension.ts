import type { Platform } from '../core/platform';

interface StorageArea {
  get(keys: string | string[] | null, callback: (items: Record<string, unknown>) => void): void;
  set(items: Record<string, unknown>, callback?: () => void): void;
}

interface ChromeLike {
  storage?: {
    local?: StorageArea;
    onChanged?: {
      addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void;
    };
  };
  runtime?: { lastError?: { message?: string } };
}

declare const chrome: ChromeLike | undefined;

function storageArea(): StorageArea | null {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return null;
}

function lastError(): string | null {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
    return chrome.runtime.lastError.message || 'Unknown extension storage error';
  }
  return null;
}

function fallbackGet(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch (error) {
    return undefined;
  }
}

function fallbackSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage can be unavailable in private windows; the feature still works
    // for the current page, it just will not persist.
  }
}

function get(area: StorageArea | null, key: string): Promise<unknown> {
  if (!area) {
    return Promise.resolve(fallbackGet(key));
  }
  return new Promise<unknown>((resolve, reject) => {
    area.get([key], (items) => {
      const error = lastError();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(items ? items[key] : undefined);
    });
  }).catch(() => fallbackGet(key));
}

function set(area: StorageArea | null, key: string, value: unknown): Promise<void> {
  if (!area) {
    fallbackSet(key, value);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const items: Record<string, unknown> = {};
    items[key] = value;
    area.set(items, () => {
      const error = lastError();
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  }).catch(() => {
    fallbackSet(key, value);
  });
}

export function createExtensionPlatform(kind: 'extension-mv2' | 'extension-mv3'): Platform {
  const area = storageArea();
  return {
    kind,
    get(key) {
      return get(area, key);
    },
    set(key, value) {
      return set(area, key, value);
    },
    onExternalChange(listener) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(() => listener());
        return;
      }
      window.addEventListener('storage', () => listener());
    },
    addStyle(css) {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    },
  };
}
