import { QUALITY_CODES, QUALITY_ORDER } from '../shared/qualities.mjs';

// The playback response reports the served tier in playQuality (qualityType code). An earlier
// revision cross-checked the `type` field as a MIME codec, but live samples return type values
// like "1" (an enum, not a codec), so the code itself is the only reliable evidence. Anything
// outside the supported tier codes is reported as unknown and never advertised in the UI.
export function confirmedPlaybackQuality(playQuality) {
  const code = playQuality === undefined || playQuality === null ? '' : String(playQuality);
  return QUALITY_ORDER.find(quality => QUALITY_CODES[quality] === code) ?? 'unknown';
}
