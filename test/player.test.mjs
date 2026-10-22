import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autosaveDelay, buildShuffleOrder, historyReportDecision, onEndedAction, orderWithActiveFirst, planPlayNext,
  popPlayHistory, pushPlayHistory, stepCursor,
} from '../src/renderer/player.mjs';

test('sequential stepping stops at the edges when repeat is off', () => {
  assert.deepEqual(stepCursor(0, 3, 1, 'off'), { cursor: 1, stopped: false });
  assert.deepEqual(stepCursor(2, 3, 1, 'off'), { cursor: 2, stopped: true });
  assert.deepEqual(stepCursor(0, 3, -1, 'off'), { cursor: 0, stopped: true });
});

test('repeat all wraps in both directions', () => {
  assert.deepEqual(stepCursor(2, 3, 1, 'all'), { cursor: 0, stopped: false });
  assert.deepEqual(stepCursor(0, 3, -1, 'all'), { cursor: 2, stopped: false });
});

test('repeat one replays the same track and never stops', () => {
  assert.deepEqual(onEndedAction(1, 3, 'one'), { cursor: 1, stopped: false });
  assert.deepEqual(onEndedAction(2, 3, 'off'), { cursor: 2, stopped: true });
  assert.deepEqual(onEndedAction(0, 3, 'all'), { cursor: 1, stopped: false });
});

test('an empty queue never reports a playable position', () => {
  assert.deepEqual(stepCursor(0, 0, 1, 'all'), { cursor: 0, stopped: true });
  assert.deepEqual(onEndedAction(0, 0, 'one'), { cursor: 0, stopped: true });
  assert.deepEqual(buildShuffleOrder(0), []);
});

test('shuffle order keeps every index exactly once and starts on the active track', () => {
  const order = buildShuffleOrder(10, 4, () => 0.5);
  assert.equal(order.length, 10);
  assert.equal(order[0], 4);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 10 }, (_, index) => index));
});

test('shuffle order survives a start index at the edges', () => {
  assert.equal(buildShuffleOrder(5, 99, () => 0)[0], 4);
  assert.equal(buildShuffleOrder(5, -3, () => 0)[0], 0);
});

test('recalculating the order keeps the active track first', () => {
  const order = orderWithActiveFirst(6, 3, () => 0.9);
  assert.equal(order[0], 3);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(orderWithActiveFirst(0, 2), []);
});

test('shuffle mode can walk back through what was actually played', () => {
  let history = pushPlayHistory([], 3);
  history = pushPlayHistory(history, 7);
  assert.deepEqual(history, [3, 7]);
  const step = popPlayHistory(history);
  assert.equal(step.cursor, 7);
  assert.deepEqual(step.history, [3]);
  assert.deepEqual(popPlayHistory([]), { cursor: null, history: [] });
  assert.deepEqual(pushPlayHistory([], -1), [], 'an invalid cursor must not enter the history');
  assert.deepEqual(pushPlayHistory([], 0), [0]);
  assert.deepEqual(pushPlayHistory([1, 2], 3, 2), [2, 3], 'history stays bounded');
});

test('history reporting waits for a real listen and never claims more than was played', () => {
  assert.deepEqual(historyReportDecision({ listenedSeconds: 5, durationSeconds: 300, alreadyReported: false }), { report: false, seconds: 5 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: 30, durationSeconds: 300, alreadyReported: false }), { report: true, seconds: 30 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: 2, durationSeconds: 4, alreadyReported: false }), { report: true, seconds: 2 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: 99, durationSeconds: 10, alreadyReported: false }), { report: true, seconds: 10 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: 60, durationSeconds: null, alreadyReported: false }), { report: true, seconds: 60 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: 60, durationSeconds: 300, alreadyReported: true }), { report: false, seconds: 0 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: -3, durationSeconds: 300, alreadyReported: false }), { report: false, seconds: 0 });
  assert.deepEqual(historyReportDecision({ listenedSeconds: Number.NaN, durationSeconds: 300, alreadyReported: false }), { report: false, seconds: 0 });
});

test('queue autosave settles when idle but still writes during continuous playback', () => {
  const last = 1000;
  assert.equal(autosaveDelay(last, last), 1500, 'a fresh edit waits for the settle window');
  // A long-playback stream of edits reschedules every 1500ms; the capped wait guarantees a write.
  assert.equal(autosaveDelay(last + 4000, last), 1000, 'wait is capped by the remaining interval');
  assert.equal(autosaveDelay(last + 5000, last), 0, 'a stale save writes immediately');
  assert.equal(autosaveDelay(last + 60_000, last), 0);
  assert.equal(autosaveDelay(last - 5000, last), 1500, 'a future timestamp cannot go negative');
});

test('play next inserts a new track right after the current one', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, x = { id: 'x' };
  const plan = planPlayNext([a, b, c], [0, 1, 2], 0, x);
  assert.deepEqual(plan.queue.map(t => t.id), ['a', 'x', 'b', 'c']);
  assert.deepEqual(plan.order, [0, 1, 2, 3]);
  assert.equal(plan.cursor, 0);
  assert.equal(plan.outcome, 'inserted');
});

test('play next moves an existing track and keeps the cursor on the playing row', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' };
  const plan = planPlayNext([a, b, c, d], [0, 1, 2, 3], 0, c);
  assert.deepEqual(plan.queue.map(t => t.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(plan.order, [0, 1, 2, 3]);
  assert.equal(plan.cursor, 0);
  assert.equal(plan.outcome, 'moved');
});

test('play next inside a shuffled order keeps the remaining shuffle intact', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' }, x = { id: 'x' };
  const order = [1, 3, 0, 2]; // playing b (queue index 1)
  const plan = planPlayNext([a, b, c, d], order, 0, x);
  assert.deepEqual(plan.queue.map(t => t.id), ['a', 'b', 'x', 'c', 'd']);
  // x joins right after the cursor; the shuffled rest only shifts by the insertion offset.
  assert.deepEqual(plan.order, [1, 2, 4, 0, 3]);
  assert.equal(plan.cursor, 0);
});

test('play next with nothing playing queues the track at the head', () => {
  const a = { id: 'a' }, b = { id: 'b' }, x = { id: 'x' };
  const plan = planPlayNext([a, b], [0, 1], -1, x);
  assert.deepEqual(plan.queue.map(t => t.id), ['x', 'a', 'b']);
  assert.deepEqual(plan.order, [0, 1, 2]);
  assert.equal(plan.outcome, 'queued');
});

test('play next refuses junk input and reports the current track', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  assert.equal(planPlayNext(null, [0], 0, a), null);
  assert.equal(planPlayNext([a], [0], 0, null), null);
  assert.equal(planPlayNext([a, b], [0, 1], 0, a).outcome, 'current');
});

test('play next moving an earlier row keeps the cursor aligned to the same track', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
  // Shuffled: order plays b (1) first, then a (0), then c (2); cursor points at a.
  const order = [1, 0, 2];
  const plan = planPlayNext([a, b, c], order, 1, b);
  // b physically lands right after a; the play order becomes a -> b -> c.
  assert.deepEqual(plan.queue.map(t => t.id), ['a', 'b', 'c']);
  assert.deepEqual(plan.order, [0, 1, 2]);
  assert.equal(plan.order[plan.cursor], 0);
  assert.equal(plan.order[plan.cursor + 1], 1);
  assert.equal(plan.outcome, 'moved');
});

test('two consecutive play-next requests stack newest first', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, x = { id: 'x' }, y = { id: 'y' };
  let queue = [a, b, c], order = [0, 1, 2], cursor = 0;
  ({ queue, order, cursor } = planPlayNext(queue, order, cursor, x));
  ({ queue, order, cursor } = planPlayNext(queue, order, cursor, y));
  // Each request lands directly after the current track, so the newer pick plays first.
  assert.deepEqual(queue.map(t => t.id), ['a', 'y', 'x', 'b', 'c']);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
});
