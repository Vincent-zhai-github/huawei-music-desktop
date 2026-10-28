import test from 'node:test';
import assert from 'node:assert/strict';
import { musicExpiryBound, musicSessionExpired } from '../src/shared/session-expiry.mjs';

const SAMPLE = '20261021101354';
const asUtc = Date.parse('2026-10-21T10:13:54Z');
const asLocal = Date.parse('2026-10-21T10:13:54');

test('expiry bound is the later of the UTC and local readings of the 14-digit field', () => {
  assert.equal(musicExpiryBound(SAMPLE), Math.max(asUtc, asLocal));
});

test('expiry is only reported after even the latest possible reading has passed', () => {
  // Before the UTC reading no timezone interpretation can be expired yet.
  assert.equal(musicSessionExpired(SAMPLE, asUtc - 1), false);
  // Every real timezone offset is within ±14h, so this is past every reading.
  assert.equal(musicSessionExpired(SAMPLE, asUtc + 15 * 3600_000), true);
  assert.equal(musicSessionExpired(SAMPLE), musicSessionExpired(SAMPLE, Date.now()));
});

test('malformed expireTime never reports expiry', () => {
  for (const value of [undefined, null, '', '2026102110135', '202610211013540', 'abcdefgh', '20261321000000', '20260431000000', 20261021101354]) {
    assert.equal(musicExpiryBound(value), null, String(value));
    assert.equal(musicSessionExpired(value, Date.now()), false, String(value));
  }
});
