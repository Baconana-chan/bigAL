import type { AccentName } from './palette';
import { isAccentName } from './palette';
import type { Platform } from './platform';

export interface Settings {
  studios: boolean;
  quickActions: boolean;
  studioDna: boolean;
  homePlans: boolean;
  profileColor: boolean;
  profileColorSource: 'auto' | AccentName;
  profileUsername: string;
  themes: boolean;
  showSpoilers: boolean;
  studioSummary: boolean;
  friendsProgress: boolean;
  friends: string[];
  backlogPicks: boolean;
  continueWatching: boolean;
  franchiseTracker: boolean;
}

export const SETTINGS_KEY = 'alx:settings:v1';

/** AniList caps usernames at 20 characters; six keeps the block readable. */
export const MAX_FRIENDS = 6;

export function normalizeFriendNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: string[] = [];
  const seen: Record<string, boolean> = {};
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (typeof value !== 'string') {
      continue;
    }
    const name = value.trim();
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(name)) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen[key]) {
      continue;
    }
    seen[key] = true;
    result.push(name);
    if (result.length >= MAX_FRIENDS) {
      break;
    }
  }
  return result;
}

/** Splits a comma-separated field from the settings dialog into usernames. */
export function parseFriendInput(value: string): string[] {
  return normalizeFriendNames(value.split(','));
}

export function defaultSettings(): Settings {
  return {
    studios: true,
    quickActions: true,
    studioDna: true,
    homePlans: true,
    profileColor: true,
    profileColorSource: 'auto',
    profileUsername: '',
    themes: true,
    showSpoilers: false,
    studioSummary: true,
    friendsProgress: true,
    friends: [],
    backlogPicks: true,
    continueWatching: true,
    franchiseTracker: true,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeSettings(raw: unknown): Settings {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const source = raw as Record<string, unknown>;
  const colorSource = source.profileColorSource;
  const username = typeof source.profileUsername === 'string' ? source.profileUsername.trim().slice(0, 60) : '';
  return {
    studios: asBoolean(source.studios, defaults.studios),
    quickActions: asBoolean(source.quickActions, defaults.quickActions),
    studioDna: asBoolean(source.studioDna, defaults.studioDna),
    homePlans: asBoolean(source.homePlans, defaults.homePlans),
    profileColor: asBoolean(source.profileColor, defaults.profileColor),
    profileColorSource:
      colorSource === 'auto' || isAccentName(colorSource) ? colorSource : defaults.profileColorSource,
    profileUsername: username,
    themes: asBoolean(source.themes, defaults.themes),
    showSpoilers: asBoolean(source.showSpoilers, defaults.showSpoilers),
    studioSummary: asBoolean(source.studioSummary, defaults.studioSummary),
    friendsProgress: asBoolean(source.friendsProgress, defaults.friendsProgress),
    friends: normalizeFriendNames(source.friends),
    backlogPicks: asBoolean(source.backlogPicks, defaults.backlogPicks),
    continueWatching: asBoolean(source.continueWatching, defaults.continueWatching),
    franchiseTracker: asBoolean(source.franchiseTracker, defaults.franchiseTracker),
  };
}

type Listener = (settings: Settings) => void;

export class SettingsStore {
  private value: Settings = defaultSettings();
  private listeners: Listener[] = [];

  constructor(private platform: Platform) {}

  async load(): Promise<void> {
    const stored = await this.platform.get(SETTINGS_KEY);
    this.value = normalizeSettings(stored);
    this.platform.onExternalChange(() => {
      void this.reload();
    });
  }

  get(): Settings {
    return this.value;
  }

  async update(patch: Partial<Settings>): Promise<void> {
    const next: Record<string, unknown> = {};
    const current = this.value as unknown as Record<string, unknown>;
    const keys = Object.keys(current);
    for (let index = 0; index < keys.length; index += 1) {
      next[keys[index]] = current[keys[index]];
    }
    const patchKeys = Object.keys(patch) as Array<keyof Settings>;
    for (let index = 0; index < patchKeys.length; index += 1) {
      const key = patchKeys[index];
      next[key] = patch[key];
    }
    this.value = normalizeSettings(next);
    await this.platform.set(SETTINGS_KEY, this.value);
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private async reload(): Promise<void> {
    const stored = await this.platform.get(SETTINGS_KEY);
    this.value = normalizeSettings(stored);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.value;
    const listeners = this.listeners.slice();
    for (let index = 0; index < listeners.length; index += 1) {
      listeners[index](snapshot);
    }
  }
}
