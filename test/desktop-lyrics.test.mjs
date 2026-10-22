import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDesktopLyricsUpdate } from '../src/main/desktop-lyrics-payload.mjs';
import { sanitizeDesktopLyrics, sanitizeSettings } from '../src/main/settings.mjs';

test('desktop lyrics payloads keep short text lines and drop junk', () => {
  const cleaned = sanitizeDesktopLyricsUpdate({
    title: '晴天', artist: '周杰伦', synced: true,
    current: { text: '刮风这天我试过握着你手', translation: '但偏偏雨渐渐大到我看你不见' },
    next: { text: '还要多久我才能在你身边', translation: null },
  });
  assert.deepEqual(cleaned, {
    title: '晴天', artist: '周杰伦', synced: true,
    current: { text: '刮风这天我试过握着你手', translation: '但偏偏雨渐渐大到我看你不见' },
    next: { text: '还要多久我才能在你身边', translation: null },
  });
  assert.equal(sanitizeDesktopLyricsUpdate(null), null);
  assert.equal(sanitizeDesktopLyricsUpdate({}), null, 'completely empty push is dropped');
  assert.deepEqual(sanitizeDesktopLyricsUpdate({ title: '晴天' }),
    { title: '晴天', artist: '', synced: false, current: null, next: null }, 'title-only clears the overlay');
});

test('desktop lyrics payloads clamp long text and strip non-string fields', () => {
  const cleaned = sanitizeDesktopLyricsUpdate({
    title: 'x'.repeat(400), artist: 42, synced: 'yes',
    current: { text: 'y'.repeat(600), translation: 7 }, next: { translation: 'z'.repeat(600) },
  });
  assert.equal(cleaned.title.length, 200);
  assert.equal(cleaned.artist, '');
  assert.equal(cleaned.synced, false);
  assert.equal(cleaned.current.text.length, 500);
  assert.equal(cleaned.current.translation, null);
  assert.equal(cleaned.next.text, '');
  assert.equal(cleaned.next.translation.length, 500);
});

test('desktop lyrics settings sanitize flags, positions and appearance', () => {
  assert.deepEqual(sanitizeDesktopLyrics(null),
    { enabled: false, locked: false, position: null, fontColor: '#ffffff', backgroundOpacity: 0.55 });
  assert.deepEqual(sanitizeDesktopLyrics({ enabled: true, locked: 'x', position: { x: 10, y: 20 } }),
    { enabled: true, locked: false, position: { x: 10, y: 20 }, fontColor: '#ffffff', backgroundOpacity: 0.55 });
  assert.equal(sanitizeDesktopLyrics({ position: { x: 1.5, y: 20 } }).position, null, 'fractional coords rejected');
  assert.equal(sanitizeDesktopLyrics({ position: { x: 999999, y: 0 } }).position, null, 'off-screen coords rejected');
  // Partial patch keeps stored fields.
  assert.deepEqual(sanitizeDesktopLyrics({ locked: true }, { enabled: true, locked: false, position: { x: 1, y: 2 } }),
    { enabled: true, locked: true, position: null, fontColor: '#ffffff', backgroundOpacity: 0.55 },
    'a malformed position in a patch resets to null');
});

test('desktop lyrics appearance fields are validated and clamped', () => {
  assert.equal(sanitizeDesktopLyrics({ fontColor: '#AbCdEf' }).fontColor, '#abcdef', 'hex normalised to lower case');
  assert.equal(sanitizeDesktopLyrics({ fontColor: 'red' }).fontColor, '#ffffff', 'named colours rejected');
  assert.equal(sanitizeDesktopLyrics({ fontColor: 'javascript:alert(1)' }).fontColor, '#ffffff');
  assert.equal(sanitizeDesktopLyrics({ backgroundOpacity: 5 }).backgroundOpacity, 1);
  assert.equal(sanitizeDesktopLyrics({ backgroundOpacity: -2 }).backgroundOpacity, 0);
  assert.equal(sanitizeDesktopLyrics({ backgroundOpacity: Number.NaN }).backgroundOpacity, 0.55);
  assert.equal(sanitizeDesktopLyrics({ backgroundOpacity: 0.3 }).backgroundOpacity, 0.3);
  // Stored settings that predate these fields still come back complete.
  const legacy = sanitizeDesktopLyrics(undefined, { enabled: true, locked: true, position: { x: 5, y: 5 } });
  assert.equal(legacy.fontColor, '#ffffff');
  assert.equal(legacy.backgroundOpacity, 0.55);
  assert.equal(legacy.enabled, true);
});

test('settings sanitize integrates the desktop lyrics block', () => {
  const next = sanitizeSettings({ desktopLyrics: { enabled: true, locked: true, position: { x: -8, y: 40 }, fontColor: '#FFE680', backgroundOpacity: 0.2 } });
  assert.deepEqual(next.desktopLyrics,
    { enabled: true, locked: true, position: { x: -8, y: 40 }, fontColor: '#ffe680', backgroundOpacity: 0.2 });
  const untouched = sanitizeSettings({ volume: 0.4 });
  assert.deepEqual(untouched.desktopLyrics,
    { enabled: false, locked: false, position: null, fontColor: '#ffffff', backgroundOpacity: 0.55 });
});
