// Pure payload sanitation for the desktop lyrics bridge. Kept free of Electron imports so it
// can run in node:test: only the main window's renderer may push updates, but the payload is
// still treated as untrusted input before it reaches the lyrics window.

const MAX_TEXT = 500;

function lineFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const text = typeof value.text === 'string' ? value.text.slice(0, MAX_TEXT) : '';
  const translation = typeof value.translation === 'string' ? value.translation.slice(0, MAX_TEXT) : null;
  if (!text.trim() && !translation) return null;
  return { text, translation };
}

/**
 * @returns {import('../shared/types').DesktopLyricsUpdate | null}
 */
export function sanitizeDesktopLyricsUpdate(input) {
  if (!input || typeof input !== 'object') return null;
  const raw = /** @type {Record<string, unknown>} */ (input);
  const title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : '';
  const artist = typeof raw.artist === 'string' ? raw.artist.slice(0, 200) : '';
  const current = lineFrom(raw.current);
  const next = lineFrom(raw.next);
  // A track/title-only payload is valid: it clears the overlay between tracks or
  // represents unsynced lyrics; only a completely empty push is dropped.
  if (!current && !next && !title && !artist) return null;
  return { title, artist, synced: raw.synced === true, current, next };
}
