import { app, safeStorage } from 'electron';
import * as fs from 'node:fs/promises';
import { clearSession, loadSession, persistenceMode as getPersistenceMode, saveSession } from './session-store.cjs';
import { clearJson, loadJson, saveJson } from './json-store.cjs';
import { DEFAULT_SETTINGS, sanitizeQueue, sanitizeSettings } from './settings.mjs';
import { cachedLibraryData, updateLibraryCache } from './library-cache.mjs';
import type { AppSettings, SavedQueue } from '../shared/types';

export type StoredMusicSession = {
  version: 1;
  music: { token: string; snsUserID?: string; expireTime?: string };
  // Refresh credential from the offline OAuth grant, kept next to the music session so a
  // future renewal path can mint fresh sessions without re-scanning. Never logged; the
  // public-client refresh grant itself was rejected by the provider (see
  // docs/token-lifetimes-and-renewal.md), so today this is only collected, not used.
  oauth?: { refreshToken: string };
};

export function persistenceMode(): 'secure' | 'memory-only' {
  return getPersistenceMode(safeStorage);
}

export async function saveMusicSession(session: StoredMusicSession): Promise<boolean> {
  return saveSession(app.getPath('userData'), session, safeStorage, fs);
}

export async function loadMusicSession(): Promise<StoredMusicSession | null> {
  return loadSession(app.getPath('userData'), safeStorage, fs) as Promise<StoredMusicSession | null>;
}

export async function clearMusicSession(): Promise<void> {
  return clearSession(app.getPath('userData'), fs);
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await loadJson(app.getPath('userData'), 'settings', DEFAULT_SETTINGS, fs);
  return sanitizeSettings(stored) as AppSettings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await saveJson(app.getPath('userData'), 'settings', sanitizeSettings(settings), fs);
}

let settingsWrite: Promise<unknown> = Promise.resolve();
export function updateSettings(patch: unknown): Promise<AppSettings> {
  const update = settingsWrite.catch(() => undefined).then(async () => {
    const next = sanitizeSettings(patch, await loadSettings()) as AppSettings;
    await saveSettings(next);
    return next;
  });
  settingsWrite = update;
  return update;
}

export async function loadWriteIntent(): Promise<unknown> {
  return loadJson(app.getPath('userData'), 'write-intent', null, fs);
}
export async function saveWriteIntent(intent: unknown): Promise<void> {
  if (intent === null) await clearJson(app.getPath('userData'), 'write-intent', fs);
  else await saveJson(app.getPath('userData'), 'write-intent', intent, fs);
}

export async function loadQueue(): Promise<SavedQueue | null> {
  const stored = await loadJson(app.getPath('userData'), 'queue', null, fs);
  return sanitizeQueue(stored) as SavedQueue | null;
}

export async function saveQueue(queue: SavedQueue): Promise<void> {
  const sanitized = sanitizeQueue(queue);
  if (!sanitized) { await clearJson(app.getPath('userData'), 'queue', fs); return; }
  await saveJson(app.getPath('userData'), 'queue', sanitized, fs);
}

let cacheWrite = Promise.resolve();
export function cacheLibraryPage(key: string, data: unknown, stillCurrent: () => boolean): Promise<void> {
  cacheWrite = cacheWrite.catch(() => undefined).then(async () => {
    const directory = app.getPath('userData');
    const stored = await loadJson(directory, 'cache', {}, fs);
    // No await between the epoch check and queuing the write: account cleanup is ordered after it.
    if (!stillCurrent()) return;
    await saveJson(directory, 'cache', updateLibraryCache(stored, key, data), fs);
  });
  return cacheWrite;
}

export async function loadCachedLibraryPage(key: string): Promise<unknown> {
  const stored = await loadJson(app.getPath('userData'), 'cache', {}, fs);
  return cachedLibraryData(stored, key);
}

export async function clearPersonalData(): Promise<void> {
  for (const name of ['queue', 'cache', 'history', 'write-intent']) await clearJson(app.getPath('userData'), name, fs);
}
