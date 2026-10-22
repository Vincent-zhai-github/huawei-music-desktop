import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRetryMediaFailure,
  isLatestFavoritesRequest,
  mediaFailureResumeAt,
  reconcileTrackIndexes,
  shouldRestartResolvingPlayback,
} from '../src/renderer/track-reconcile.mjs';

const tracks = ids => ids.map(id => ({ id }));

test('refresh keeps current and selected tracks by ID after reorder', () => {
  assert.deepEqual(reconcileTrackIndexes(tracks(['a', 'b', 'c']), tracks(['c', 'a', 'b']), 1, 2), {
    currentIndex: 2, currentRemoved: false, selectedIndex: 0,
  });
});

test('refresh reports a removed current track and clears a removed selection', () => {
  assert.deepEqual(reconcileTrackIndexes(tracks(['a', 'b']), tracks(['b']), 0, 0), {
    currentIndex: 0, currentRemoved: true, selectedIndex: null,
  });
});

test('first load and empty lists settle on index zero without a selection', () => {
  assert.deepEqual(reconcileTrackIndexes([], tracks(['a']), 0, null), {
    currentIndex: 0, currentRemoved: false, selectedIndex: null,
  });
  assert.deepEqual(reconcileTrackIndexes(tracks(['a']), [], 0, null), {
    currentIndex: 0, currentRemoved: true, selectedIndex: null,
  });
});

test('only the newest favorites request may commit its result', () => {
  assert.equal(isLatestFavoritesRequest(3, 4), false);
  assert.equal(isLatestFavoritesRequest(4, 4), true);
});

test('refresh restarts only the playback resolve that was already active when refresh began', () => {
  const initialResolve = {
    wasResolvingAtRequestStart: true,
    requestPlaybackGeneration: 7,
    currentPlaybackGeneration: 7,
    isCurrentlyResolving: true,
  };
  assert.equal(shouldRestartResolvingPlayback(initialResolve), true);
  assert.equal(shouldRestartResolvingPlayback({ ...initialResolve, currentPlaybackGeneration: 8 }), false);
  assert.equal(shouldRestartResolvingPlayback({ ...initialResolve, wasResolvingAtRequestStart: false }), false);
  assert.equal(shouldRestartResolvingPlayback({ ...initialResolve, isCurrentlyResolving: false }), false);
});

test('media failure permits one same-quality retry and then stops', () => {
  assert.equal(canRetryMediaFailure(0), true);
  assert.equal(canRetryMediaFailure(1), false);
  assert.equal(canRetryMediaFailure(2), false);
});

test('a media failure resumes from the breakpoint, not from zero', () => {
  assert.equal(mediaFailureResumeAt(137.4), 137.4);
  assert.equal(mediaFailureResumeAt(2), 2);
  // A failure in the first second needs no seek at all; junk positions never seek.
  assert.equal(mediaFailureResumeAt(0), null);
  assert.equal(mediaFailureResumeAt(0.8), null);
  assert.equal(mediaFailureResumeAt(Number.NaN), null);
  assert.equal(mediaFailureResumeAt(Infinity), null);
});
