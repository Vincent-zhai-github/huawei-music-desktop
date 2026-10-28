import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_CODES, QUALITY_LABELS, QUALITY_ORDER, fallbackQuality, qualityCodeOf, qualityFromCode } from '../src/shared/qualities.mjs';

test('every tier has a code and a label, and code mapping round-trips', () => {
  for (const quality of QUALITY_ORDER) {
    assert.equal(typeof QUALITY_CODES[quality], 'string');
    assert.equal(typeof QUALITY_LABELS[quality], 'string');
    assert.equal(qualityFromCode(qualityCodeOf(quality)), quality);
  }
  assert.deepEqual(QUALITY_ORDER, ['standard', 'hq', 'lossless', 'ultra']);
});

test('qualityFromCode rejects unknown codes without throwing', () => {
  assert.equal(qualityFromCode('15'), null);
  assert.equal(qualityFromCode(undefined), null);
  assert.equal(qualityFromCode('audio/flac'), null);
});

test('fallbackQuality picks the closest available tier, preferring at-or-below the request', () => {
  assert.equal(fallbackQuality('ultra', ['standard', 'hq', 'lossless', 'ultra']), 'ultra');
  assert.equal(fallbackQuality('ultra', ['standard', 'lossless']), 'lossless');
  assert.equal(fallbackQuality('lossless', ['standard', 'hq']), 'hq');
  // Only higher tiers available: play at the lowest one above the request instead of failing.
  assert.equal(fallbackQuality('standard', ['hq', 'lossless']), 'hq');
  assert.equal(fallbackQuality('lossless', ['ultra']), 'ultra');
  assert.equal(fallbackQuality('standard', []), null);
  assert.equal(fallbackQuality('hq', undefined), null);
});
