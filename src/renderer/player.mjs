// Pure queue math so repeat/shuffle/ended behaviour can be regression tested without Electron.
export function stepCursor(cursor, count, delta, repeatMode) {
  if (count <= 0) return { cursor: 0, stopped: true };
  const next = cursor + delta;
  if (next >= 0 && next < count) return { cursor: next, stopped: false };
  if (repeatMode === 'off') return { cursor, stopped: true };
  return { cursor: ((next % count) + count) % count, stopped: false };
}

// 'one' repeats the finished track; every other mode advances through the order.
export function onEndedAction(cursor, count, repeatMode, delta = 1) {
  if (count <= 0) return { cursor: 0, stopped: true };
  if (repeatMode === 'one') return { cursor, stopped: false };
  return stepCursor(cursor, count, delta, repeatMode);
}

export function buildShuffleOrder(count, startIndex = 0, random = Math.random) {
  const order = Array.from({ length: Math.max(0, count) }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (count > 0) {
    const start = Math.min(Math.max(0, startIndex), count - 1);
    const at = order.indexOf(start);
    if (at > 0) [order[0], order[at]] = [order[at], order[0]];
  }
  return order;
}

// Keeps the active track first when the queue order is recalculated (shuffle toggled).
export function orderWithActiveFirst(count, activeIndex, random = Math.random) {
  if (count <= 0) return [];
  const order = buildShuffleOrder(count, activeIndex, random);
  if (activeIndex < 0 || activeIndex >= count) return order;
  const at = order.indexOf(activeIndex);
  if (at > 0) [order[0], order[at]] = [order[at], order[0]];
  return order;
}

// Shuffle mode: 上一首 follows what was actually played, not the shuffled index order.
export function pushPlayHistory(history, cursor, limit = 200) {
  if (!Number.isInteger(cursor) || cursor < 0) return history;
  const next = [...history, cursor];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function popPlayHistory(history) {
  if (!history.length) return { cursor: null, history };
  return { cursor: history[history.length - 1], history: history.slice(0, -1) };
}

// Report a listen only after a real, meaningful portion was heard, and never claim more seconds
// than were actually played. Short tracks (including synthetic fixtures) report proportionally earlier.
export function historyReportDecision({ listenedSeconds, durationSeconds, alreadyReported, minSeconds = 30, ratio = 0.5 }) {
  if (alreadyReported) return { report: false, seconds: 0 };
  const listened = Math.max(0, Math.floor(Number.isFinite(listenedSeconds) ? listenedSeconds : 0));
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  const threshold = duration === null ? minSeconds : Math.min(minSeconds, Math.max(1, Math.ceil(duration * ratio)));
  if (listened < threshold) return { report: false, seconds: listened };
  return { report: true, seconds: duration === null ? listened : Math.min(listened, Math.ceil(duration)) };
}

// Queue autosave must not be a pure debounce: `timeupdate` keeps firing while a track plays, so a
// debounce never settles and the queue would never reach disk during continuous playback. Wait for
// the edits to settle, but never let more than `intervalMs` pass between two writes.
export function autosaveDelay(nowMs, lastSaveMs, settleMs = 1500, intervalMs = 5000) {
  const elapsed = Math.max(0, nowMs - lastSaveMs);
  if (elapsed >= intervalMs) return 0;
  return Math.min(settleMs, intervalMs - elapsed);
}

// "Play next": put a track right after the current one. Queue rows keep physical order (the
// queue panel reads it) while `order` decides what actually plays next; both are updated
// consistently and the returned cursor keeps pointing at the still-playing track.
// Outcomes: 'inserted' (new row), 'moved' (requeued row), 'current' (already playing),
// 'queued' (no track playing: it lands at the head, ready to start), null (unusable input).
export function planPlayNext(queue, order, cursor, track) {
  if (!Array.isArray(queue) || !Array.isArray(order) || !track || typeof track.id !== 'string') return null;
  const activeIndex = Number.isInteger(cursor) && cursor >= 0 && cursor < order.length ? order[cursor] : -1;
  if (activeIndex >= 0 && queue[activeIndex]?.id === track.id) return { queue, order, cursor, outcome: 'current' };
  // The physical insert slot sits right after the current row; with nothing playing it is the head.
  const at = activeIndex + 1;
  const existing = queue.findIndex(item => item.id === track.id);
  if (existing === -1) {
    const nextQueue = [...queue];
    nextQueue.splice(at, 0, track);
    // Every queue row at or after the slot shifts by one; the new row joins the order right
    // after the cursor (or at position 0 when nothing is playing, so it becomes the next up).
    const nextOrder = order.map(value => (value >= at ? value + 1 : value));
    nextOrder.splice(cursor + 1, 0, at);
    return { queue: nextQueue, order: nextOrder, cursor, outcome: cursor < 0 ? 'queued' : 'inserted' };
  }
  // Requeue an existing row: move it physically to the slot and pull its order slot to cursor+1.
  const target = existing < at ? at - 1 : at;
  const nextQueue = [...queue];
  nextQueue.splice(existing, 1);
  nextQueue.splice(target, 0, track);
  // Map every old queue index to its new position (a bijection, so order stays a permutation).
  const remap = index => {
    if (index === existing) return target;
    if (index < existing) return index < target ? index : index + 1;
    return index - 1 < target ? index - 1 : index;
  };
  const nextOrder = order.map(remap);
  const activeRemapped = remap(activeIndex);
  const position = nextOrder.indexOf(target);
  nextOrder.splice(position, 1);
  // After removing that slot the active row may have shifted left, so recompute the cursor
  // before inserting; otherwise the pick would land one slot too late.
  const insertAtOrder = activeIndex < 0 ? 0 : nextOrder.indexOf(activeRemapped) + 1;
  nextOrder.splice(insertAtOrder, 0, target);
  const nextCursor = activeIndex < 0 ? -1 : nextOrder.indexOf(activeRemapped);
  return { queue: nextQueue, order: nextOrder, cursor: nextCursor, outcome: 'moved' };
}
