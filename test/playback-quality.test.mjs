import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedPlaybackQuality } from '../src/main/track-quality.mjs';

test('maps every served qualityType code to its tier', () => {
  assert.equal(confirmedPlaybackQuality('1'), 'standard');
  assert.equal(confirmedPlaybackQuality('2'), 'hq');
  assert.equal(confirmedPlaybackQuality('3'), 'lossless');
  assert.equal(confirmedPlaybackQuality('7'), 'ultra');
});

test('numeric codes from the service are accepted too', () => {
  assert.equal(confirmedPlaybackQuality(1), 'standard');
  assert.equal(confirmedPlaybackQuality(3), 'lossless');
  assert.equal(confirmedPlaybackQuality(7), 'ultra');
});

test('unknown, missing, or unsupported codes are never advertised as a confirmed quality', () => {
  for (const value of [undefined, null, '', '0', '5', '15', '17', 'audio/flac', 'lossless']) {
    assert.equal(confirmedPlaybackQuality(value), 'unknown');
  }
});
