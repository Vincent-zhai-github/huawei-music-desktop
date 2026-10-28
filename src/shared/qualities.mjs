// Audio quality tiers exposed by the Huawei music API. The service identifies each
// tier by a numeric qualityType ("1" standard MP3, "2" HQ MP3, "3" lossless FLAC,
// "7" ultra FLAC); MKV-based spatial-audio entries (15/17) stay unexposed until
// playback for that container is actually verified.
export const QUALITY_ORDER = ['standard', 'hq', 'lossless', 'ultra'];

export const QUALITY_CODES = { standard: '1', hq: '2', lossless: '3', ultra: '7' };

export const QUALITY_LABELS = { standard: '标准', hq: 'HQ', lossless: '无损', ultra: '超清' };

export function qualityCodeOf(quality) {
  return QUALITY_CODES[quality] ?? null;
}

export function qualityFromCode(code) {
  const text = code === undefined || code === null ? '' : String(code);
  return QUALITY_ORDER.find(quality => QUALITY_CODES[quality] === text) ?? null;
}

// Closest available tier to the requested one, based on QUALITY_ORDER: prefer the highest
// tier at or below the request (never spend more bandwidth than asked), otherwise the lowest
// tier above it (a song with only higher tiers still plays). Returns null when the track
// exposes none of the supported tiers.
export function fallbackQuality(requested, available) {
  if (!Array.isArray(available) || !available.length) return null;
  const requestedIndex = QUALITY_ORDER.indexOf(requested);
  const capped = requestedIndex < 0 ? 0 : requestedIndex;
  for (let index = capped; index >= 0; index -= 1) {
    if (available.includes(QUALITY_ORDER[index])) return QUALITY_ORDER[index];
  }
  for (let index = capped + 1; index < QUALITY_ORDER.length; index += 1) {
    if (available.includes(QUALITY_ORDER[index])) return QUALITY_ORDER[index];
  }
  return null;
}
