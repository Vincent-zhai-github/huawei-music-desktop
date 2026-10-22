export function reconcileTrackIndexes(previousTracks, nextTracks, currentIndex, selectedIndex) {
  const currentId = previousTracks[currentIndex]?.id;
  const selectedId = selectedIndex === null ? undefined : previousTracks[selectedIndex]?.id;
  const nextCurrentIndex = currentId ? nextTracks.findIndex(track => track.id === currentId) : -1;
  const nextSelectedIndex = selectedId ? nextTracks.findIndex(track => track.id === selectedId) : -1;
  return {
    currentIndex: nextCurrentIndex >= 0 ? nextCurrentIndex : 0,
    currentRemoved: !!currentId && nextCurrentIndex < 0,
    selectedIndex: nextSelectedIndex >= 0 ? nextSelectedIndex : null,
  };
}

export function isLatestFavoritesRequest(requestId, latestRequestId) {
  return requestId === latestRequestId;
}

export function shouldRestartResolvingPlayback({
  wasResolvingAtRequestStart,
  requestPlaybackGeneration,
  currentPlaybackGeneration,
  isCurrentlyResolving,
}) {
  return wasResolvingAtRequestStart
    && isCurrentlyResolving
    && requestPlaybackGeneration === currentPlaybackGeneration;
}

export function canRetryMediaFailure(retryCount) {
  return retryCount < 1;
}

// Where a failed load should resume from: the audio element keeps its last position through an
// error, but retrying a track that barely started does not need a seek at all.
export function mediaFailureResumeAt(currentTime) {
  return Number.isFinite(currentTime) && currentTime > 1 ? currentTime : null;
}
