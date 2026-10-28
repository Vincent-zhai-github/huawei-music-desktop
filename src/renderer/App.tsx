import { useEffect, useRef, useState } from 'react';
import {
  Heart, Headphones, History, ListMusic, LogIn, LogOut, Search, Settings as SettingsIcon,
} from 'lucide-react';
import { LyricsPanel, LyricsStage, PlayerBar, QueuePanel } from './components';
import {
  AlbumPage, ArtistPage, HistoryPage, PlaylistsPage, PlaylistDetailPage, SearchPage,
  SettingsPage, type LibraryContext,
} from './pages';
import { FavoritesPage } from './favorites-page';
import { APP_BRAND_LABEL } from '../shared/app-name.mjs';
import { QUALITY_LABELS, fallbackQuality } from '../shared/qualities.mjs';
import { musicSessionExpired } from '../shared/session-expiry.mjs';
import {
  autosaveDelay, buildShuffleOrder, historyReportDecision, onEndedAction, planPlayNext, popPlayHistory, pushPlayHistory, stepCursor,
} from './player.mjs';
import { activeLyricIndex } from '../lyrics.mjs';
import { fontStackFor, tintFromHex } from './theme.mjs';
import { canRetryMediaFailure, mediaFailureResumeAt, reconcileTrackIndexes } from './track-reconcile.mjs';
import type {
  AccentName, AppSettings, AuthStatus, AppearanceSettings, FontChoice, LyricsDoc, Playback, PlayerCommand, Playlist, Quality, Result, SavedQueue, Track, TrackQuality,
} from '../shared/types';

type View =
  | { name: 'favorites' } | { name: 'playlists' } | { name: 'search' } | { name: 'history' } | { name: 'settings' }
  | { name: 'playlist'; playlist: Playlist }
  | { name: 'album'; albumId: string }
  | { name: 'artist'; artistId: string };

const VIEW_TITLES: Record<View['name'], string> = {
  favorites: '我的收藏', playlists: '我的歌单', playlist: '歌单详情', search: '搜索',
  history: '播放历史', settings: '设置', album: '专辑', artist: '歌手',
};

const VIEW_EYEBROWS: Record<View['name'], string> = {
  favorites: 'Library', playlists: 'Collections', playlist: 'Collection', search: 'Search',
  history: 'History', settings: 'Preferences', album: 'Album', artist: 'Artist',
};

const NAV_ICONS = {
  favorites: Heart, playlists: ListMusic, search: Search, history: History, settings: SettingsIcon,
};

// Runtime tint map: the CSS keeps red as its default so the first paint is already correct.
const ACCENTS: Record<Exclude<AccentName, 'custom'>, { accent: string; light: string; deep: string; soft: string; line: string; shadow: string }> = {
  red: { accent: '#c8202e', light: '#e0364a', deep: '#a51724', soft: 'rgba(200, 32, 46, 0.09)', line: 'rgba(200, 32, 46, 0.28)', shadow: 'rgba(200, 32, 46, 0.28)' },
  blue: { accent: '#2563eb', light: '#3b82f6', deep: '#1d4ed8', soft: 'rgba(37, 99, 235, 0.10)', line: 'rgba(37, 99, 235, 0.30)', shadow: 'rgba(37, 99, 235, 0.26)' },
  green: { accent: '#15803d', light: '#22a05a', deep: '#166534', soft: 'rgba(21, 128, 61, 0.10)', line: 'rgba(21, 128, 61, 0.28)', shadow: 'rgba(21, 128, 61, 0.24)' },
  amber: { accent: '#b45309', light: '#d97706', deep: '#92400e', soft: 'rgba(180, 83, 9, 0.11)', line: 'rgba(180, 83, 9, 0.30)', shadow: 'rgba(180, 83, 9, 0.24)' },
  violet: { accent: '#6d28d9', light: '#8b5cf6', deep: '#5b21b6', soft: 'rgba(109, 40, 217, 0.10)', line: 'rgba(109, 40, 217, 0.28)', shadow: 'rgba(109, 40, 217, 0.24)' },
};

const FONT_STACKS: Record<Exclude<FontChoice, 'custom'>, string> = {
  sans: "'Inter', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif",
  serif: "'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC', 'AR PL UMing CN', 'Songti SC', STSong, SimSun, Georgia, serif",
  mono: "ui-monospace, 'JetBrains Mono', 'Noto Sans Mono CJK SC', 'Sarasa Mono SC', Consolas, monospace",
};

function applyAppearance(appearance: AppearanceSettings | undefined) {
  if (!appearance) return;
  const root = document.documentElement.style;
  const tint = appearance.accent === 'custom'
    ? tintFromHex(appearance.customAccent)
    : ACCENTS[appearance.accent] ?? ACCENTS.red;
  root.setProperty('--accent', tint.accent);
  root.setProperty('--accent-light', tint.light);
  root.setProperty('--accent-deep', tint.deep);
  root.setProperty('--accent-soft', tint.soft);
  root.setProperty('--accent-line', tint.line);
  root.setProperty('--accent-shadow', tint.shadow);
  root.setProperty('--panel-alpha', String(appearance.panelOpacity));
  root.setProperty('--radius-unit', `${appearance.cornerRadius}px`);
  root.setProperty('--fs-scale', String(appearance.fontScale));
  root.setProperty('--font-ui', appearance.fontFamily === 'custom'
    ? fontStackFor(appearance.customFont, FONT_STACKS.sans)
    : FONT_STACKS[appearance.fontFamily] ?? FONT_STACKS.sans);
}

const HISTORY_KEY = 'local-play-history';
const HISTORY_LIMIT = 200;
const LYRIC_OFFSET_KEY = 'lyric-offset';
const LYRIC_OFFSET_LIMIT = 10;

function readLyricOffset(trackId?: string): number {
  try {
    const own = Number(trackId ? localStorage.getItem(`${LYRIC_OFFSET_KEY}:${trackId}`) : null);
    if (Number.isFinite(own) && own !== 0) return Math.max(-LYRIC_OFFSET_LIMIT, Math.min(LYRIC_OFFSET_LIMIT, own));
    const shared = Number(localStorage.getItem(LYRIC_OFFSET_KEY));
    return Number.isFinite(shared) ? Math.max(-LYRIC_OFFSET_LIMIT, Math.min(LYRIC_OFFSET_LIMIT, shared)) : 0;
  } catch { return 0; }
}

function readLocalHistory(): Track[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((track: Track) => !!track?.id && !!track?.title).slice(0, HISTORY_LIMIT) : [];
  } catch { return []; }
}

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [message, setMessage] = useState('正在检查登录状态…');
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [view, setView] = useState<View>({ name: 'favorites' });
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [actualQuality, setActualQuality] = useState<Quality | 'unknown'>('unknown');
  const [lyrics, setLyrics] = useState<LyricsDoc | null>(null);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [lyricOffset, setLyricOffset] = useState(0);
  const [lyricRevision, setLyricRevision] = useState(0);
  const lyricCache = useRef(new Map<string, LyricsDoc | null>());
  const [queueOpen, setQueueOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [knownFavoriteIds, setKnownFavoriteIds] = useState<Set<string>>(new Set());
  const [accountVersion, setAccountVersion] = useState(0);
  const [favoriteChange, setFavoriteChange] = useState<LibraryContext['favoriteChange']>(null);
  const favoritePending = useRef(new Set<string>());
  const playCommand = useRef<{ [K in PlayerCommand]: () => void }>({
    'play-pause': () => {}, next: () => {}, previous: () => {}, 'volume-up': () => {},
    'volume-down': () => {}, mute: () => {}, like: () => {},
  });
  const [localHistory, setLocalHistory] = useState<Track[]>([]);
  const [volume, setVolume] = useState(0.85);
  const [quality, setQuality] = useState<Quality>('standard');
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [repeatMode, setRepeatMode] = useState<AppSettings['repeatMode']>('off');
  const [shuffle, setShuffle] = useState(false);
  const desktopLyricsRef = useRef(false);
  const [desktopLyricsEnabled, setDesktopLyricsEnabled] = useState(false);
  // expireTime is an unverified-timezone hint, so this only flips once even the latest reading
  // has passed — used for the sidebar label, while real failures stay decided by the provider.
  const sessionExpired = status?.authenticated === true && musicSessionExpired(status.musicExpireTime);

  const audio = useRef<HTMLAudioElement | null>(null);
  const playbackGeneration = useRef(0);
  const activeAudioGeneration = useRef(0);
  const activeAudioSource = useRef('');
  const mediaRetryCount = useRef(0);
  const seeking = useRef(false);
  const seekTarget = useRef<number | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const order = useRef<number[]>([]);
  const cursorRef = useRef(-1);
  const queueRef = useRef<Track[]>([]);
  const repeatRef = useRef<AppSettings['repeatMode']>('off');
  const qualityRef = useRef<Quality>('standard');
  const volumeRef = useRef(0.85);
  const syncHistoryRef = useRef(true);
  const listenSeconds = useRef(0);
  const lastListenAt = useRef(0);
  const historyReported = useRef(false);
  const playHistory = useRef<number[]>([]);
  const reportHistoryRef = useRef<() => void>(() => {});
  const isResolvingTrack = useRef(false);
  const positionRef = useRef(0);
  positionRef.current = position;
  const saveTimer = useRef<number | undefined>(undefined);
  const positionTimer = useRef<number | undefined>(undefined);
  const lastSaveAt = useRef(Date.now());
  const lastStructure = useRef<{ queue: Track[]; cursor: number }>({ queue: [], cursor: -1 });
  const playAtRef = useRef<(nextCursor: number, retryCount?: number, options?: { fromHistory?: boolean; resumeAt?: number | null }) => Promise<void>>(async () => undefined);

  const currentTrack = cursor >= 0 && cursor < order.current.length ? queue[order.current[cursor]] : undefined;

  function run<T>(action: () => Promise<Result<T>>, failure: string): Promise<T | undefined> {
    return action().then(result => {
      if (result.ok) return result.data;
      setMessage(result.error.message);
      return undefined;
    }).catch(() => { setMessage(failure); return undefined; });
  }
  const notice = (text: string) => setMessage(text);

  useEffect(() => {
    const unsubscribeProgress = window.desktop.auth.onProgress(setMessage);
    const unsubscribeNotice = window.desktop.onNotice(setMessage);
    const unsubscribeCommand = window.desktop.player.onCommand(command => {
      playCommand.current[command]();
    });
    void (async () => {
      const [authResult, settingsResult, queueResult] = await Promise.all([
        window.desktop.auth.status().catch(() => null),
        window.desktop.settings.get().catch(() => null),
        window.desktop.queue.load().catch(() => null),
      ]);
      if (authResult?.ok) {
        setStatus(authResult.data);
        if (authResult.data.authenticated) setLocalHistory(readLocalHistory());
        else { try { localStorage.removeItem(HISTORY_KEY); } catch { /* No account history on a signed-out boot. */ } }
        setMessage(authResult.data.authenticated ? '已恢复音乐会话。' : '请登录以读取个人音乐库。');
      } else setMessage('无法读取本机登录状态，请重启应用后重试。');
      if (settingsResult?.ok) applySettings(settingsResult.data);
      const saved = queueResult?.ok ? queueResult.data : null;
      if (saved?.tracks.length) {
        queueRef.current = saved.tracks;
        const activeIndex = Math.min(Math.max(0, saved.index), saved.tracks.length - 1);
        order.current = settingsResult?.ok && settingsResult.data.shuffle
          ? buildShuffleOrder(saved.tracks.length, activeIndex) : identityOrder(saved.tracks.length);
        const restoredCursor = order.current.indexOf(activeIndex);
        cursorRef.current = restoredCursor;
        setQueue(saved.tracks);
        setCursor(restoredCursor);
        setPosition(saved.positionSeconds);
        pendingSeek.current = saved.positionSeconds > 0 ? saved.positionSeconds : null;
        setMessage(`已恢复上次队列（${saved.tracks.length} 首），点击播放继续。`);
      }
      setQueueReady(true);
    })();
    return () => {
      unsubscribeProgress(); unsubscribeNotice(); unsubscribeCommand();
      window.clearTimeout(saveTimer.current); window.clearTimeout(positionTimer.current);
    };
  }, []);

  useEffect(() => {
    audio.current = new Audio();
    audio.current.volume = volumeRef.current;
    const element = audio.current;
    const isCurrentSource = () => activeAudioGeneration.current === playbackGeneration.current
      && !!activeAudioSource.current && element.src === activeAudioSource.current;
    const time = () => {
      if (!isCurrentSource() || seeking.current) return;
      setPosition(element.currentTime);
      // Count only real listening: a seek produces a large delta and is ignored here.
      const delta = element.currentTime - lastListenAt.current;
      if (delta > 0 && delta < 5) listenSeconds.current += delta;
      lastListenAt.current = element.currentTime;
      reportHistoryRef.current();
    };
    const loaded = () => {
      if (!isCurrentSource()) return;
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      lastListenAt.current = element.currentTime;
      if (pendingSeek.current !== null && Number.isFinite(element.duration) && element.duration > 0) {
        element.currentTime = Math.min(pendingSeek.current, Math.max(0, element.duration - 0.5));
        pendingSeek.current = null;
      }
    };
    const started = () => {
      if (!isCurrentSource()) return;
      setBuffering(false); setPlaying(true);
      const track = queueRef.current[order.current[cursorRef.current]];
      if (track) recordLocalHistory(track);
    };
    const waiting = () => { if (isCurrentSource() && !element.paused) { setBuffering(true); setPlaying(false); } };
    const paused = () => { if (isCurrentSource()) { setBuffering(false); setPlaying(false); } };
    const failed = () => {
      if (!isCurrentSource()) return;
      const resumeAt = mediaFailureResumeAt(element.currentTime);
      activeAudioSource.current = '';
      setDuration(0); setBuffering(false); setPlaying(false); setActualQuality('unknown');
      if (canRetryMediaFailure(mediaRetryCount.current)) {
        const retryCount = mediaRetryCount.current + 1;
        setMessage('音频资源加载失败，正在从断点重新获取一次…');
        // Resume from the failure point instead of restarting the track: an unnoticed stream
        // hiccup must never look like the song "mysteriously started over".
        void playAtRef.current(cursorRef.current, retryCount, { resumeAt });
      } else setMessage('音频重试失败，请检查网络后手动重试。');
    };
    const ended = () => {
      if (!isCurrentSource()) return;
      reportHistoryRef.current();
      activeAudioSource.current = '';
      setBuffering(false); setPlaying(false);
      const step = onEndedAction(cursorRef.current, order.current.length, repeatRef.current);
      if (!step.stopped) void playAtRef.current(step.cursor);
    };
    element.addEventListener('timeupdate', time);
    element.addEventListener('loadedmetadata', loaded);
    element.addEventListener('playing', started);
    element.addEventListener('waiting', waiting);
    element.addEventListener('pause', paused);
    element.addEventListener('error', failed);
    element.addEventListener('ended', ended);
    return () => {
      element.pause();
      element.removeEventListener('timeupdate', time);
      element.removeEventListener('loadedmetadata', loaded);
      element.removeEventListener('playing', started);
      element.removeEventListener('waiting', waiting);
      element.removeEventListener('pause', paused);
      element.removeEventListener('error', failed);
      element.removeEventListener('ended', ended);
      element.src = '';
    };
  }, []);

  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);

  useEffect(() => { applyAppearance(settings?.appearance); }, [settings?.appearance]);

  // Persist the queue without any playback URL; the renderer only stores what the IPC accepts.
  function persistQueue() {
    lastSaveAt.current = Date.now();
    const activeIndex = order.current[cursorRef.current] ?? 0;
    void window.desktop.queue.save({ tracks: queueRef.current, index: activeIndex, positionSeconds: positionRef.current }).catch(() => undefined);
  }

  // Queue contents and the active track change rarely, so persist them on their own timer. Sharing
  // one timer with the position update would let a `timeupdate` cancel the structural write.
  useEffect(() => {
    if (!queueReady) return;
    const structural = lastStructure.current.queue !== queue || lastStructure.current.cursor !== cursor;
    lastStructure.current = { queue, cursor };
    if (!structural) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(persistQueue, 0);
  }, [queue, cursor, queueReady]);

  // Position changes on every `timeupdate`, so throttle the writes instead of debouncing forever.
  useEffect(() => {
    if (!queueReady) return;
    if (positionTimer.current) window.clearTimeout(positionTimer.current);
    positionTimer.current = window.setTimeout(persistQueue, autosaveDelay(Date.now(), lastSaveAt.current));
    return () => window.clearTimeout(positionTimer.current);
  }, [position, queueReady]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = currentTrack
      ? new MediaMetadata({ title: currentTrack.title, artist: currentTrack.artists.map(artist => artist.name).join(' / '), album: currentTrack.album?.title })
      : null;
    session.playbackState = playing ? 'playing' : currentTrack ? 'paused' : 'none';
    session.setActionHandler('play', () => { if (audio.current?.paused) togglePlayback(); });
    session.setActionHandler('pause', () => audio.current?.pause());
    session.setActionHandler('nexttrack', () => goNext());
    session.setActionHandler('previoustrack', () => goPrevious());
  }, [currentTrack?.id, playing]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
    } catch { /* Position state is best effort. */ }
  }, [position, duration]);

  // Lyrics load once per track while any surface (drawer, stage or desktop overlay) needs them.
  useEffect(() => {
    if (!lyricsOpen && !stageOpen && !desktopLyricsEnabled) return;
    const trackId = currentTrack?.id;
    if (!trackId) { setLyrics(null); return; }
    setLyricOffset(readLyricOffset(trackId));
    if (lyricCache.current.has(trackId)) {
      setLyrics(lyricCache.current.get(trackId) ?? null);
      setLyricsLoading(false);
      return;
    }
    let cancelled = false;
    const track = currentTrack;
    setLyrics(null); setLyricsLoading(true);
    // Title/artist/duration are only used for the third-party fallback match, never for playback.
    void window.desktop.music.lyrics({
      trackId,
      title: track?.title,
      artist: track?.artists.map(artist => artist.name).join(' / '),
      album: track?.album?.title,
      durationSeconds: track?.durationSeconds,
    }).then(result => {
      if (cancelled) return;
      const doc = result.ok ? result.data : null;
      lyricCache.current.set(trackId, doc);
      setLyrics(doc); setLyricsLoading(false);
    }).catch(() => {
      if (cancelled) return;
      lyricCache.current.set(trackId, null);
      setLyrics(null); setLyricsLoading(false);
    });
    return () => { cancelled = true; };
  }, [lyricsOpen, stageOpen, desktopLyricsEnabled, currentTrack?.id, lyricRevision]);

  // Push the current lyric line to the desktop overlay; the key dedupes so we only send on
  // line changes (position ticks re-run this effect but exit immediately).
  const lastSentLyricKey = useRef('');
  useEffect(() => {
    if (!desktopLyricsEnabled) { lastSentLyricKey.current = ''; return; }
    const lines = lyrics?.lines ?? [];
    const index = lyrics?.synced ? activeLyricIndex(lines, (position + lyricOffset) * 1000) : -1;
    const key = `${currentTrack?.id ?? ''}|${index}|${lyricRevision}`;
    if (key === lastSentLyricKey.current) return;
    lastSentLyricKey.current = key;
    const lineAt = (at: number): { text: string; translation: string | null } | null =>
      at >= 0 && at < lines.length ? { text: lines[at].text, translation: lines[at].translation ?? null } : null;
    window.desktop.desktopLyrics.update({
      title: currentTrack?.title ?? '',
      artist: currentTrack?.artists.map(artist => artist.name).join(' / ') ?? '',
      synced: lyrics?.synced === true,
      current: index >= 0 ? lineAt(index) : null,
      next: lines.length ? lineAt(index >= 0 ? index + 1 : 0) : null,
    });
  }, [desktopLyricsEnabled, position, lyrics, currentTrack, lyricOffset, lyricRevision]);

  async function importLocalLyrics() {
    const trackId = currentTrack?.id;
    if (!trackId) return;
    const result = await window.desktop.lyrics.importLocal(trackId).catch(() => null);
    if (!result) { setMessage('导入失败，请重试。'); return; }
    if (!result.ok) { setMessage(result.error.message); return; }
    if (!result.data) return; // cancelled
    lyricCache.current.set(trackId, result.data);
    setLyrics(result.data);
    setMessage(`已导入本地歌词（${result.data.lines.length} 行）。`);
  }

  async function removeLocalLyrics() {
    const trackId = currentTrack?.id;
    if (!trackId) return;
    const result = await window.desktop.lyrics.removeLocal(trackId).catch(() => null);
    if (!result?.ok) { setMessage('移除失败，请重试。'); return; }
    lyricCache.current.delete(trackId);
    setLyrics(null);
    setMessage(result.data.removed ? '已移除本地歌词，改为读取云端歌词。' : '当前歌曲没有本地歌词。');
    setLyricRevision(value => value + 1);
  }

  function applySettings(next: AppSettings) {
    setSettings(next);
    setVolume(next.volume);
    volumeRef.current = next.volume;
    setQuality(next.quality);
    qualityRef.current = next.quality;
    setRepeatMode(next.repeatMode);
    repeatRef.current = next.repeatMode;
    setShuffle(next.shuffle);
    syncHistoryRef.current = next.syncHistory;
    desktopLyricsRef.current = next.desktopLyrics.enabled;
    setDesktopLyricsEnabled(next.desktopLyrics.enabled);
  }

  function identityOrder(count: number): number[] { return Array.from({ length: count }, (_, index) => index); }

  function recordLocalHistory(track: Track) {
    setLocalHistory(previous => {
      const next = [track, ...previous.filter(item => item.id !== track.id)].slice(0, HISTORY_LIMIT);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* Storage is best effort. */ }
      return next;
    });
  }

  async function playAt(nextCursor: number, retryCount = 0, options: { fromHistory?: boolean; resumeAt?: number | null } = {}) {
    const track = queueRef.current[order.current[nextCursor]];
    if (!track || !audio.current) return;
    if (!options.fromHistory) {
      const previous = cursorRef.current;
      if (previous >= 0 && previous !== nextCursor && previous < order.current.length) {
        playHistory.current = pushPlayHistory(playHistory.current, previous);
      }
    }
    // playAt is the single writer: a leftover pending seek from an abandoned retry must never
    // leak into a track the user picks manually, while a retry passes its breakpoint here.
    pendingSeek.current = options.resumeAt ?? null;
    listenSeconds.current = 0;
    lastListenAt.current = 0;
    historyReported.current = false;
    const generation = ++playbackGeneration.current;
    activeAudioGeneration.current = generation;
    activeAudioSource.current = '';
    mediaRetryCount.current = retryCount;
    isResolvingTrack.current = true;
    audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load();
    setPlaying(false); setBuffering(true); setPosition(0); setDuration(0); setActualQuality('unknown');
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
    setMessage(`正在获取「${track.title}」的播放资源…`);
    let result: Result<Playback>;
    // Serve the requested tier when the track offers it; otherwise fall back to the highest
    // tier at or below it. The setting itself stays untouched — this is per-request only.
    const available = (track.qualities ?? []).map(item => item.quality);
    const requested = qualityRef.current;
    const effective = available.length ? (fallbackQuality(requested, available) ?? requested) : requested;
    const substituted = available.length > 0 && effective !== requested;
    try {
      result = await window.desktop.music.resolvePlayback({ trackId: track.id, quality: effective });
    } catch {
      if (generation === playbackGeneration.current) { isResolvingTrack.current = false; setBuffering(false); setMessage('获取播放资源失败，请重试。'); }
      return;
    }
    if (generation !== playbackGeneration.current) return;
    isResolvingTrack.current = false;
    if (!result.ok) { setBuffering(false); setMessage(result.error.message); return; }
    activeAudioSource.current = new URL(result.data.url).href;
    activeAudioGeneration.current = generation;
    audio.current.src = activeAudioSource.current;
    audio.current.load();
    setActualQuality(result.data.actualQuality);
    try {
      await audio.current.play();
      if (generation !== playbackGeneration.current) return;
      const served = result.data.actualQuality === 'unknown' ? '服务端未确认音质' : QUALITY_LABELS[result.data.actualQuality];
      setMessage(`已开始 ${track.title} · ${served}${substituted ? `（该歌曲未提供${QUALITY_LABELS[requested]}，已用${QUALITY_LABELS[effective]}）` : ''}`);
    } catch {
      if (generation !== playbackGeneration.current) return;
      activeAudioSource.current = '';
      audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load();
      setBuffering(false); setPlaying(false); setDuration(0); setActualQuality('unknown');
      setMessage('浏览器未能开始播放，请检查网络或重试。');
    }
  }
  playAtRef.current = playAt;

  // Best-effort history sync: silent on failure, at most once per playback, real seconds only.
  function reportPlayback() {
    if (!syncHistoryRef.current || historyReported.current) return;
    const track = queueRef.current[order.current[cursorRef.current]];
    if (!track) return;
    const element = audio.current;
    const duration = element && Number.isFinite(element.duration) ? element.duration : 0;
    const decision = historyReportDecision({ listenedSeconds: listenSeconds.current, durationSeconds: duration, alreadyReported: false }) as { report: boolean; seconds: number };
    if (!decision.report) return;
    // Marked before the request so repeated timeupdate events cannot send twice.
    historyReported.current = true;
    void window.desktop.music.reportPlayback({
      trackId: track.id, title: track.title, listenedSeconds: decision.seconds,
      ...(duration > 0 ? { songDurationSeconds: Math.ceil(duration) } : {}),
    }).catch(() => undefined);
  }
  reportHistoryRef.current = reportPlayback;

  // "Play next": requeue one track directly after the current one without interrupting playback.
  function playNext(track: Track) {
    if (!track.available) { setMessage('该歌曲无版权，无法加入播放。'); return; }
    const plan = planPlayNext(queueRef.current, order.current, cursorRef.current, track);
    if (!plan) return;
    if (plan.outcome === 'current') { setMessage('这首歌正在播放。'); return; }
    queueRef.current = plan.queue;
    order.current = plan.order;
    cursorRef.current = plan.cursor;
    playHistory.current = [];
    setQueue(plan.queue);
    setCursor(plan.cursor);
    setMessage(plan.outcome === 'queued'
      ? `已将「${track.title}」排在队列最前，开始播放后即播放它。`
      : `已将「${track.title}」设为下一首播放。`);
  }

  function play(tracks: Track[], index: number) {
    if (!tracks.length) return;
    const target = tracks[index];
    if (target && !target.available) { setMessage('该歌曲无版权，无法播放。'); return; }
    const playable = tracks.filter(t => t.available);
    if (!playable.length) { setMessage('没有可播放的歌曲（全部无版权）。'); return; }
    const newIndex = target ? playable.indexOf(target) : 0;
    pendingSeek.current = null;
    playHistory.current = [];
    queueRef.current = playable;
    const nextOrder = shuffle ? buildShuffleOrder(playable.length, newIndex) : identityOrder(playable.length);
    order.current = nextOrder;
    const nextCursor = nextOrder.indexOf(newIndex);
    cursorRef.current = nextCursor < 0 ? 0 : nextCursor;
    setQueue(playable);
    setCursor(cursorRef.current);
    void playAt(cursorRef.current);
  }

  function togglePlayback() {
    if (!audio.current || !order.current.length) return;
    if (!audio.current.paused) audio.current.pause();
    else if (!activeAudioSource.current || audio.current.error) void playAt(cursorRef.current);
    else void audio.current.play().catch(() => setMessage('播放失败，请重新获取资源。'));
  }

  function goNext() {
    const step = stepCursor(cursorRef.current, order.current.length, 1, repeatRef.current);
    if (step.stopped) return;
    pendingSeek.current = null;
    void playAt(step.cursor);
  }
  function goPrevious() {
    // In shuffle mode 上一首 follows what was actually played instead of the shuffled index order.
    if (shuffle && playHistory.current.length) {
      const { cursor: target, history } = popPlayHistory(playHistory.current) as { cursor: number | null; history: number[] };
      playHistory.current = history;
      if (target !== null) { pendingSeek.current = null; void playAt(target, 0, { fromHistory: true }); return; }
    }
    const step = stepCursor(cursorRef.current, order.current.length, -1, repeatRef.current);
    if (step.stopped) return;
    pendingSeek.current = null;
    void playAt(step.cursor);
  }

  playCommand.current = {
    'play-pause': togglePlayback, next: goNext, previous: goPrevious,
    'volume-up': () => changeVolume(Math.min(1, Math.round((volumeRef.current + 0.1) * 10) / 10)),
    'volume-down': () => changeVolume(Math.max(0, Math.round((volumeRef.current - 0.1) * 10) / 10)),
    mute: toggleMute,
    like: () => {
      const track = currentTrack;
      if (!track) { setMessage('当前没有播放中的歌曲。'); return; }
      const favorite = favoriteOf(track.id);
      void toggleFavorite(track, favorite === undefined ? true : !favorite);
    },
  };

  function previewSeek(value: number) { seeking.current = true; seekTarget.current = value; setPosition(value); }
  function commitSeek() {
    const target = seekTarget.current;
    seeking.current = false;
    seekTarget.current = null;
    if (target !== null && audio.current && duration > 0) audio.current.currentTime = Math.min(target, duration);
  }

  // Jumping audio directly (lyric line clicks, stage scrubber) bypasses the preview/commit dance.
  function seekAudio(seconds: number) {
    if (!audio.current || !duration) return;
    const target = Math.max(0, Math.min(seconds, duration));
    seeking.current = false;
    seekTarget.current = null;
    audio.current.currentTime = target;
    lastListenAt.current = target;
    setPosition(target);
  }
  function seekToLyric(timeMs: number) { seekAudio(timeMs / 1000 - lyricOffset); }

  // Offset is a per-track preference; the shared value seeds the next unheard track.
  function changeLyricOffset(delta: number) {
    const next = Math.max(-LYRIC_OFFSET_LIMIT, Math.min(LYRIC_OFFSET_LIMIT, Math.round((lyricOffset + delta) * 10) / 10));
    setLyricOffset(next);
    try {
      const trackId = currentTrack?.id;
      if (trackId) localStorage.setItem(`${LYRIC_OFFSET_KEY}:${trackId}`, String(next));
      localStorage.setItem(LYRIC_OFFSET_KEY, String(next));
    } catch { /* Preference storage is best effort. */ }
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const result = await window.desktop.settings.update(patch).catch(() => null);
    if (result?.ok) {
      if (patch.shuffle !== undefined && patch.shuffle !== shuffle) {
        const active = order.current[cursorRef.current] ?? 0;
        order.current = patch.shuffle ? buildShuffleOrder(queueRef.current.length, active) : identityOrder(queueRef.current.length);
        cursorRef.current = Math.max(0, order.current.indexOf(active));
        setCursor(cursorRef.current);
        playHistory.current = [];
      }
      applySettings(result.data);
      return true;
    }
    setMessage('设置保存失败，请重试。');
    return false;
  }

  function toggleShuffle() {
    const next = !shuffle;
    const activeIndex = order.current[cursorRef.current] ?? 0;
    const nextOrder = next ? buildShuffleOrder(queueRef.current.length, activeIndex) : identityOrder(queueRef.current.length);
    order.current = nextOrder;
    const nextCursor = nextOrder.indexOf(activeIndex);
    cursorRef.current = nextCursor < 0 ? 0 : nextCursor;
    setCursor(cursorRef.current);
    setShuffle(next);
    playHistory.current = [];
    void updateSettings({ shuffle: next });
    setMessage(next ? '已开启随机播放。' : '已关闭随机播放。');
  }
  function toggleRepeat() {
    const next = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    setRepeatMode(next); repeatRef.current = next;
    void updateSettings({ repeatMode: next });
    setMessage(next === 'one' ? '单曲循环。' : next === 'all' ? '列表循环。' : '顺序播放。');
  }
  // Quality switch: persists the default tier immediately and, when something is already
  // playing, re-resolves the stream at the new tier while keeping the current position
  // (playAt's pendingSeek path). The per-request fallback still applies if the track
  // does not offer the chosen tier.
  function changeQuality(next: Quality) {
    setQuality(next); qualityRef.current = next;
    setQualityMenuOpen(false);
    void updateSettings({ quality: next });
    const track = currentTrack;
    if (!track || !audio.current) { setMessage(`默认音质已设为${QUALITY_LABELS[next]}。`); return; }
    const resumeAt = positionRef.current > 1 ? positionRef.current : null;
    setMessage(`已选择${QUALITY_LABELS[next]}，正在以当前进度重新取流…`);
    void playAtRef.current(cursorRef.current, 0, { resumeAt });
  }
  function toggleQualityMenu() {
    setQualityMenuOpen(open => !open);
  }
  const lastAudibleVolume = useRef(0.85);
  function changeVolume(value: number) {
    if (value > 0) lastAudibleVolume.current = value;
    setVolume(value); volumeRef.current = value;
    void window.desktop.settings.update({ volume: value }).catch(() => undefined);
  }
  function toggleMute() {
    changeVolume(volume > 0 ? 0 : (lastAudibleVolume.current || 0.85));
  }

  function favoriteOf(trackId: string): boolean | undefined { return knownFavoriteIds.has(trackId) ? favoriteIds.has(trackId) : undefined; }
  function setFavoriteState(trackId: string, favorite: boolean) {
    setKnownFavoriteIds(previous => new Set(previous).add(trackId));
    setFavoriteIds(previous => {
      const next = new Set(previous);
      if (favorite) next.add(trackId); else next.delete(trackId);
      return next;
    });
  }
  async function toggleFavorite(track: Track, favorite: boolean) {
    if (favoritePending.current.has(track.id)) return;
    favoritePending.current.add(track.id);
    try {
      if (favoriteOf(track.id) === undefined) {
        const before = await run(() => window.desktop.music.favoriteState({ trackId: track.id }), '无法核对收藏状态，请重试。');
        if (!before) return;
        setFavoriteState(track.id, before.favorite);
        favorite = !before.favorite;
      }
      const result = await run(() => window.desktop.music.setFavorite({ trackId: track.id, favorite }), '收藏结果待确认，请刷新核对，不要重复提交。');
      if (!result) return;
      setFavoriteState(track.id, result.favorite);
      setFavoriteChange(previous => ({ trackId: track.id, favorite: result.favorite, revision: (previous?.revision ?? 0) + 1 }));
      setMessage(result.favorite ? `已收藏「${track.title}」。` : `已取消收藏「${track.title}」。`);
    } finally { favoritePending.current.delete(track.id); }
  }

  useEffect(() => {
    if (!currentTrack || !status?.authenticated || knownFavoriteIds.has(currentTrack.id)) return;
    let cancelled = false;
    void window.desktop.music.favoriteState({ trackId: currentTrack.id }).then(result => {
      if (!cancelled && result.ok) setFavoriteState(currentTrack.id, result.data.favorite);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentTrack?.id, status]);

  async function login() {
    setBusy(true); setLoginOpen(true); setMessage('正在准备官方登录…');
    try {
      const result = await window.desktop.auth.login().catch(() => null);
      if (result?.ok) {
        resetPersonalState();
        setStatus(result.data); setView({ name: 'favorites' }); setMessage('登录成功。');
      }
      else if (result) setMessage(result.error.message);
      else setMessage('登录未完成，请检查应用状态后重试。');
    } finally { setLoginOpen(false); setBusy(false); }
  }

  // The official page runs inside the main window, so cancellation is an explicit app action.
  async function cancelLogin() {
    const result = await window.desktop.auth.cancelLogin().catch(() => null);
    if (result?.ok) setMessage('正在取消登录…');
    else setMessage(result?.error.message ?? '取消登录失败，请重试。');
  }

  function resetPersonalState() {
    setAccountVersion(previous => previous + 1); setFavoriteChange(null);
    playbackGeneration.current += 1;
    pendingSeek.current = null;
    listenSeconds.current = 0; lastListenAt.current = 0; historyReported.current = false; playHistory.current = [];
    window.clearTimeout(saveTimer.current); window.clearTimeout(positionTimer.current);
    positionRef.current = 0;
    activeAudioGeneration.current = playbackGeneration.current;
    activeAudioSource.current = '';
    isResolvingTrack.current = false;
    queueRef.current = []; order.current = []; cursorRef.current = -1;
    setQueue([]); setCursor(-1); setFavoriteIds(new Set()); setKnownFavoriteIds(new Set()); favoritePending.current.clear();
    audio.current?.pause(); audio.current?.removeAttribute('src'); audio.current?.load();
    setPlaying(false); setBuffering(false); setPosition(0); setDuration(0); setActualQuality('unknown');
    setLyrics(null); setLyricsOpen(false); setQueueOpen(false); setLocalHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* Do not expose storage internals. */ }
  }

  async function logout() {
    setBusy(true);
    const result = await window.desktop.auth.logout().catch(() => null);
    setBusy(false);
    if (!result?.ok) { setMessage(result?.error.message ?? '退出失败，本机登录状态未更改。请重试。'); return; }
    resetPersonalState();
    setStatus({ authenticated: false, persistence: 'unavailable' });
    setView({ name: 'favorites' });
    setMessage('已退出本机账号。');
  }

  function openPlaylist(playlist: Playlist) { setView({ name: 'playlist', playlist }); }
  function closePlaylist() { setView({ name: 'playlists' }); }

  const ctx: LibraryContext = {
    busy, setBusy, notice, run, setFavoriteState, updateSettings,
    currentTrackId: currentTrack?.id ?? null,
    playing,
    favoriteOf,
    play,
    playNext,
    toggleFavorite,
    openAlbum: albumId => setView({ name: 'album', albumId }),
    openArtist: artistId => setView({ name: 'artist', artistId }),
    openPlaylist,
    closePlaylist,
    setCloseBehavior: value => {
      void window.desktop.window.setCloseBehavior(value).then(result => {
        if (result.ok) { applySettings(result.data); setMessage(value === 'tray' ? '关闭窗口时将最小化到托盘。' : '关闭窗口时将退出程序。'); }
        else setMessage('设置保存失败，请重试。');
      }).catch(() => setMessage('设置保存失败，请重试。'));
    },
    settings, queue: { tracks: queue, index: cursor >= 0 && cursor < order.current.length ? order.current[cursor] : 0, positionSeconds: position },
    localHistory, favoriteChange,
  };

  const navItems: { key: keyof typeof NAV_ICONS; label: string }[] = [
    { key: 'favorites', label: '我的收藏' },
    { key: 'playlists', label: '我的歌单' },
    { key: 'search', label: '搜索' },
    { key: 'history', label: '播放历史' },
    { key: 'settings', label: '设置' },
  ];

  function renderPage() {
    switch (view.name) {
      case 'favorites': return null;
      case 'playlists': return <PlaylistsPage ctx={ctx} />;
      case 'playlist': return <PlaylistDetailPage ctx={ctx} playlist={view.playlist} />;
      case 'search': return <SearchPage ctx={ctx} />;
      case 'history': return <HistoryPage ctx={ctx} />;
      case 'settings': return <SettingsPage ctx={ctx} />;
      case 'album': return <AlbumPage ctx={ctx} albumId={view.albumId} />;
      case 'artist': return <ArtistPage ctx={ctx} artistId={view.artistId} />;
    }
  }

  const panelOpen = lyricsOpen || queueOpen;
  const viewHint =
    view.name === 'favorites' ? '收藏的全部歌曲，向下滚动自动加载'
      : view.name === 'playlists' ? '自建、收藏与榜单'
        : view.name === 'search' ? '按歌名或艺人查找'
          : view.name === 'history' ? '本机记录与华为服务端记录'
            : view.name === 'settings' ? '播放、界面与隐私偏好'
              : '';
  return <div className={`app-shell ${panelOpen ? 'has-panel' : ''}`}>
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Headphones size={19} /></span>
        <span>{APP_BRAND_LABEL}</span>
      </div>
      <div className="nav-label">音乐库</div>
      {navItems.map(item => {
        const Icon = NAV_ICONS[item.key];
        return <button key={item.key}
          className={`nav-item ${view.name === item.key || (item.key === 'playlists' && view.name === 'playlist') ? 'active' : ''}`}
          title={item.label}
          onClick={() => setView({ name: item.key } as View)}>
          <Icon size={16} /><span>{item.label}</span>
        </button>;
      })}
      <div className="sidebar-foot">
        <div className={`status-dot ${status?.authenticated ? (sessionExpired ? 'expired' : '') : 'off'}`} />
        <span>{status?.authenticated ? (sessionExpired ? '音乐登录已过期' : '音乐会话已连接') : '未登录'}</span>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div>
          <p className="eyebrow">{VIEW_EYEBROWS[view.name]}</p>
          <h1>{VIEW_TITLES[view.name]}</h1>
          <p className="page-sub">{status?.authenticated || view.name === 'settings' ? viewHint : '登录后即可浏览你的音乐库'}</p>
        </div>
        <div className="actions">
          {status?.authenticated
            ? <>
              <button className="ghost" onClick={login} disabled={busy}><LogIn size={14} />重新登录</button>
              <button className="ghost danger" onClick={logout} disabled={busy}><LogOut size={14} />退出</button>
            </>
            : <button className="primary" onClick={login} disabled={busy}><LogIn size={14} />扫码登录</button>}
        </div>
      </header>
      <div className="notice" role="status" aria-live="polite">{message}{status?.notice && <span> · {status.notice}</span>}</div>
      {!status?.authenticated && view.name !== 'settings'
        ? <section className="empty-state">
          <div className="empty-art"><Headphones size={30} /></div>
          <h2>连接你的音乐库</h2>
          <p>通过华为官方页面扫码登录。授权页使用公开兼容性研究中的 OAuth 应用标识，并非本项目注册身份；请先核对页面显示的应用和权限，再决定是否继续。账号令牌只在主进程处理。</p>
          <button className="primary large" onClick={login} disabled={busy}>打开官方登录</button>
        </section>
        : renderPage()}
      {status?.authenticated && <FavoritesPage key={accountVersion} ctx={ctx} active={view.name === 'favorites'} />}
    </main>
    {loginOpen && <div className="login-bar" role="status">
      <span>正在官方页面完成扫码授权，完成后自动返回。</span>
      <button className="ghost" onClick={() => void cancelLogin()}>取消登录</button>
    </div>}
    {lyricsOpen && <LyricsPanel
      doc={lyrics}
      loading={lyricsLoading}
      positionSeconds={position}
      offsetSeconds={lyricOffset}
      onSeekTo={seekToLyric}
      onOpenStage={() => setStageOpen(true)}
      onImport={() => void importLocalLyrics()}
      onRemoveLocal={() => void removeLocalLyrics()}
      onClose={() => setLyricsOpen(false)}
    />}
    {queueOpen && <QueuePanel tracks={queue} currentId={currentTrack?.id ?? null} onSelect={queueIndex => { const at = order.current.indexOf(queueIndex); void playAt(at < 0 ? 0 : at); }} onClose={() => setQueueOpen(false)} />}
    {stageOpen && <LyricsStage
      track={currentTrack}
      doc={lyrics}
      loading={lyricsLoading}
      positionSeconds={position}
      offsetSeconds={lyricOffset}
      playing={playing}
      duration={duration}
      disabled={!queue.length}
      onSeekTo={seekToLyric}
      onSeekSeconds={seekAudio}
      onToggle={togglePlayback}
      onPrevious={goPrevious}
      onNext={goNext}
      onOffset={changeLyricOffset}
      onImport={() => void importLocalLyrics()}
      onRemoveLocal={() => void removeLocalLyrics()}
      onClose={() => setStageOpen(false)}
    />}
    <PlayerBar
      track={currentTrack}
      playing={playing}
      buffering={buffering}
      position={position}
      duration={duration}
      volume={volume}
      quality={quality}
      actualQuality={actualQuality}
      repeatMode={repeatMode}
      shuffle={shuffle}
      disabled={!queue.length}
      onToggle={togglePlayback}
      onPrevious={goPrevious}
      onNext={goNext}
      onSeekPreview={previewSeek}
      onSeekCommit={commitSeek}
      onVolume={changeVolume}
      onToggleMute={toggleMute}
      onToggleQualityMenu={toggleQualityMenu}
      onChangeQuality={changeQuality}
      qualityMenuOpen={qualityMenuOpen}
      onToggleRepeat={toggleRepeat}
      onToggleShuffle={toggleShuffle}
      onToggleLyrics={() => setLyricsOpen(value => { if (!value) setQueueOpen(false); return !value; })}
      onToggleQueue={() => setQueueOpen(value => { if (!value) setLyricsOpen(false); return !value; })}
      onOpenStage={() => setStageOpen(true)}
      lyricsOpen={lyricsOpen}
      queueOpen={queueOpen}
      queueCount={queue.length}
      favorite={currentTrack ? favoriteOf(currentTrack.id) : undefined}
      onToggleFavorite={() => { if (currentTrack) void toggleFavorite(currentTrack, !favoriteOf(currentTrack.id)); }}
    />
  </div>;
}
