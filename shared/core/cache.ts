import type { Platform } from './platform';

interface CacheEntry<T> {
  v: T;
  e: number;
}

export async function cached<T>(
  platform: Platform,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  let entry: CacheEntry<T> | null = null;
  try {
    const raw = await platform.get(key);
    if (raw && typeof raw === 'object' && 'v' in raw && 'e' in raw) {
      entry = raw as CacheEntry<T>;
    }
  } catch (error) {
    entry = null;
  }

  if (entry && typeof entry.e === 'number' && entry.e > Date.now()) {
    return entry.v;
  }

  const value = await loader();
  const next: CacheEntry<T> = { v: value, e: Date.now() + ttlMs };
  try {
    await platform.set(key, next);
  } catch (error) {
    // A failed cache write must never break the feature.
  }
  return value;
}

/*
 * Per-page cache for signed-in data. It lives in memory only: list entries can
 * change in another tab, so nothing here should outlive the page or be trusted
 * for long. A failed lookup simply refetches.
 */

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();
const pending = new Map<string, Promise<unknown>>();

export function memoryGet<T>(key: string): T | undefined {
  const entry = memory.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function memorySet<T>(key: string, value: T, ttlMs: number): void {
  memory.set(key, { value: value, expiresAt: Date.now() + ttlMs });
}

export function memoryDeletePrefix(prefix: string): void {
  const doomed: string[] = [];
  memory.forEach((_entry, key) => {
    if (key.indexOf(prefix) === 0) {
      doomed.push(key);
    }
  });
  for (let index = 0; index < doomed.length; index += 1) {
    memory.delete(doomed[index]);
  }
}

export function memoryDeleteWhere(matches: (key: string) => boolean): void {
  const doomed: string[] = [];
  memory.forEach((_entry, key) => {
    if (matches(key)) {
      doomed.push(key);
    }
  });
  for (let index = 0; index < doomed.length; index += 1) {
    memory.delete(doomed[index]);
  }
}

/** Shares one in-flight request between callers asking for the same key. */
export function dedupe<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = loader().then(
    (value) => {
      pending.delete(key);
      return value;
    },
    (error) => {
      pending.delete(key);
      throw error;
    }
  );
  pending.set(key, promise);
  return promise;
}

export function memoryCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = memoryGet<T>(key);
  if (hit !== undefined) {
    return Promise.resolve(hit);
  }
  return dedupe(key, () =>
    loader().then((value) => {
      memorySet(key, value, ttlMs);
      return value;
    })
  );
}
