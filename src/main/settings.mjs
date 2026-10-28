// Pure settings/queue sanitation so persisted JSON can never widen the IPC contract.
/** @type {import('../shared/types').AppSettings} */
export const DEFAULT_SETTINGS = Object.freeze({
  closeBehavior: 'quit',
  quality: 'standard',
  volume: 0.85,
  repeatMode: 'off',
  shuffle: false,
  syncHistory: true,
  thirdPartyLyrics: true,
  appearance: Object.freeze({
    accent: 'red',
    panelOpacity: 1,
    cornerRadius: 11,
    fontScale: 1,
    fontFamily: 'sans',
    customAccent: '#c8202e',
    customFont: '',
  }),
  shortcuts: Object.freeze({
    'play-pause': 'Control+Alt+P',
    next: 'Control+Alt+Right',
    previous: 'Control+Alt+Left',
    'volume-up': 'Control+Alt+Up',
    'volume-down': 'Control+Alt+Down',
    mute: 'Control+Alt+M',
    like: 'Control+Alt+L',
  }),
  desktopLyrics: Object.freeze({ enabled: false, locked: false, position: null, fontColor: '#ffffff', backgroundOpacity: 0.55 }),
});

import { isSafeResourceUrl } from '../safe-media-url.mjs';
import { sanitizeShortcuts } from '../shared/shortcuts.mjs';
import { QUALITY_ORDER } from '../shared/qualities.mjs';
const CLOSE_BEHAVIORS = new Set(['quit', 'tray']);
const QUALITIES = new Set(QUALITY_ORDER);
const REPEAT_MODES = new Set(['off', 'all', 'one']);
const ACCENTS = new Set(['red', 'blue', 'green', 'amber', 'violet', 'custom']);
const FONT_CHOICES = new Set(['sans', 'serif', 'mono', 'custom']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function clampNumber(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** @returns {import('../shared/types').AppearanceSettings} */
export function sanitizeAppearance(input, fallback = DEFAULT_SETTINGS.appearance) {
  const base = { ...DEFAULT_SETTINGS.appearance, ...(fallback ?? {}) };
  if (!input || typeof input !== 'object') return base;
  const raw = /** @type {Record<string, unknown>} */ (input);
  return {
    accent: ACCENTS.has(raw.accent) ? /** @type {import('../shared/types').AccentName} */ (raw.accent) : base.accent,
    panelOpacity: clampNumber(raw.panelOpacity, 0.55, 1, base.panelOpacity),
    cornerRadius: clampNumber(raw.cornerRadius, 0, 18, base.cornerRadius),
    fontScale: clampNumber(raw.fontScale, 0.85, 1.2, base.fontScale),
    fontFamily: FONT_CHOICES.has(raw.fontFamily) ? /** @type {import('../shared/types').FontChoice} */ (raw.fontFamily) : base.fontFamily,
    customAccent: typeof raw.customAccent === 'string' && HEX_COLOR.test(raw.customAccent) ? raw.customAccent.toLowerCase() : base.customAccent,
    // A font family name is only ever injected into a CSS font-family list, so strip anything that
    // could break out of the quoted string and cap the length.
    customFont: typeof raw.customFont === 'string'
      ? raw.customFont.replace(/["'\\;{}<>]/g, '').trim().slice(0, 80)
      : base.customFont,
  };
}

/**
 * @template {import('../shared/types').AppSettings} T
 * @param {unknown} input
 * @param {T} [fallback]
 * @returns {T}
 */
export function sanitizeSettings(input, fallback = DEFAULT_SETTINGS) {
  const base = { ...DEFAULT_SETTINGS, ...(fallback ?? {}) };
  if (!input || typeof input !== 'object') return base;
  const raw = /** @type {Record<string, unknown>} */ (input);
  const next = { ...base };
  if (CLOSE_BEHAVIORS.has(raw.closeBehavior)) next.closeBehavior = /** @type {'quit' | 'tray'} */ (raw.closeBehavior);
  if (QUALITIES.has(raw.quality)) next.quality = /** @type {'standard' | 'lossless'} */ (raw.quality);
  if (REPEAT_MODES.has(raw.repeatMode)) next.repeatMode = /** @type {'off' | 'all' | 'one'} */ (raw.repeatMode);
  if (typeof raw.shuffle === 'boolean') next.shuffle = raw.shuffle;
  if (typeof raw.syncHistory === 'boolean') next.syncHistory = raw.syncHistory;
  if (typeof raw.thirdPartyLyrics === 'boolean') next.thirdPartyLyrics = raw.thirdPartyLyrics;
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) {
    next.volume = Math.min(1, Math.max(0, raw.volume));
  }
  if (raw.appearance && typeof raw.appearance === 'object') {
    next.appearance = sanitizeAppearance(raw.appearance, base.appearance);
  }
  if (raw.shortcuts !== undefined) {
    next.shortcuts = sanitizeShortcuts(raw.shortcuts, base.shortcuts);
  }
  if (raw.desktopLyrics !== undefined) {
    next.desktopLyrics = sanitizeDesktopLyrics(raw.desktopLyrics, base.desktopLyrics);
  }
  return next;
}

/** @returns {import('../shared/types').DesktopLyricsSettings} */
export function sanitizeDesktopLyrics(input, fallback = DEFAULT_SETTINGS.desktopLyrics) {
  // Defaults first: settings stored before a field existed must still yield a complete object.
  const base = { ...DEFAULT_SETTINGS.desktopLyrics, ...(fallback ?? {}) };
  if (!input || typeof input !== 'object') return base;
  const raw = /** @type {Record<string, unknown>} */ (input);
  const position = raw.position && typeof raw.position === 'object' && Number.isInteger(raw.position.x)
    && Number.isInteger(raw.position.y) && Math.abs(raw.position.x) <= 32768 && Math.abs(raw.position.y) <= 32768
    ? { x: raw.position.x, y: raw.position.y } : null;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    locked: typeof raw.locked === 'boolean' ? raw.locked : base.locked,
    position,
    fontColor: typeof raw.fontColor === 'string' && HEX_COLOR.test(raw.fontColor) ? raw.fontColor.toLowerCase() : base.fontColor,
    backgroundOpacity: clampNumber(raw.backgroundOpacity, 0, 1, base.backgroundOpacity),
  };
}

const MAX_QUEUE_TRACKS = 10000;

function sanitizeQualities(value) {
  if (!Array.isArray(value)) return undefined;
  const byQuality = new Map();
  for (const item of value) {
    const quality = item && typeof item === 'object' ? item.quality : undefined;
    if (typeof quality !== 'string' || !QUALITIES.has(quality) || byQuality.has(quality)) continue;
    byQuality.set(quality, {
      quality,
      format: typeof item.format === 'string' && item.format ? item.format : undefined,
      fileSize: typeof item.fileSize === 'number' && Number.isFinite(item.fileSize) && item.fileSize >= 0 ? item.fileSize : undefined,
    });
  }
  if (!byQuality.size) return undefined;
  return QUALITY_ORDER.filter(quality => byQuality.has(quality)).map(quality => byQuality.get(quality));
}

function sanitizeTrack(value) {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const title = typeof value.title === 'string' ? value.title : '';
  if (!id || !title || id.length > 200) return null;
  const artists = Array.isArray(value.artists)
    ? value.artists.map(artist => {
      const name = typeof artist?.name === 'string' ? artist.name : '';
      if (!name) return null;
      return typeof artist?.id === 'string' ? { id: artist.id, name } : { name };
    }).filter(artist => !!artist).slice(0, 10)
    : [];
  const album = value.album && typeof value.album.id === 'string' && typeof value.album.title === 'string'
    ? { id: value.album.id, title: value.album.title } : undefined;
  const track = {
    id, title, artists, album,
    coverUrl: typeof value.coverUrl === 'string' && isSafeResourceUrl(value.coverUrl) ? value.coverUrl : undefined,
    durationSeconds: typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds)
      ? value.durationSeconds : undefined,
    available: value.available !== false,
  };
  const qualities = sanitizeQualities(value.qualities);
  if (qualities) track.qualities = qualities;
  return track;
}

/** @returns {import('../shared/types').SavedQueue | null} */
export function sanitizeQueue(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tracks)) return null;
  const tracks = input.tracks.map(sanitizeTrack).filter(track => !!track).slice(0, MAX_QUEUE_TRACKS);
  if (!tracks.length) return null;
  const index = Number.isInteger(input.index) && input.index >= 0 && input.index < tracks.length ? input.index : 0;
  const positionSeconds = typeof input.positionSeconds === 'number' && Number.isFinite(input.positionSeconds) && input.positionSeconds >= 0
    ? input.positionSeconds : 0;
  return { tracks, index, positionSeconds };
}
