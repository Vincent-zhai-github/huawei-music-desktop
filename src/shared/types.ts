export type ErrorKind = 'auth' | 'permission' | 'network' | 'unsupported' | 'invalid' | 'unknown';
export type AppError = { kind: ErrorKind; message: string; retryable: boolean; code?: string };
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export type AuthStatus = {
  authenticated: boolean;
  displayName?: string;
  musicExpireTime?: string;
  persistence: 'secure' | 'memory-only' | 'unavailable';
  notice?: string;
};

export type Track = {
  id: string;
  title: string;
  artists: { id?: string; name: string }[];
  album?: { id: string; title: string };
  coverUrl?: string;
  durationSeconds?: number;
  available: boolean;
};

export type FavoritesPage = {
  total?: number;
  cacheHint?: string;
  tracks: Track[];
  nextStart: number;
  hasMore: boolean;
};

export type Playlist = {
  id: string;
  title: string;
  coverUrl?: string;
  count?: number;
  kind: 'owned' | 'collected' | 'chart' | 'unknown';
  description?: string;
};

export type PlaylistList = { playlists: Playlist[]; truncated: boolean; cacheHint?: string; cached?: boolean; cachedAt?: number };
export type PlaylistDetail = { playlist: Playlist; tracks: Track[]; nextStart: number; hasMore: boolean; cacheHint?: string; cached?: boolean; cachedAt?: number };
export type SearchPage = { tracks: Track[]; nextStart: number; hasMore: boolean; total?: number };
export type HistoryPage = { tracks: Track[] };
export type LyricSegment = { timeMs: number | null; text: string };
export type LyricsLine = {
  timeMs: number | null;
  text: string;
  // Second line sharing this exact timestamp (bilingual LRC layout).
  translation?: string;
  // Word level marks from <mm:ss.xx> tags, when the source provides them.
  segments?: LyricSegment[];
};
export type LyricsSource = 'huawei' | 'kugou' | 'lrclib' | 'local';
export type LyricsDoc = {
  synced: boolean;
  lines: LyricsLine[];
  // Which library answered, and what it matched, so the UI can be honest about third-party lyrics.
  source?: LyricsSource;
  matchedTitle?: string;
  matchedArtist?: string;
};
export type LyricsCacheInfo = { bytes: number; entries: number; localBytes: number; localEntries: number };
export type AlbumDetail = {
  album: { id: string; title: string; coverUrl?: string; count?: number; artists: { id?: string; name: string }[] };
  tracks: Track[];
  nextStart: number;
  hasMore: boolean;
};
export type ArtistDetail = {
  artist: { id: string; name: string; coverUrl?: string };
  tracks: Track[];
  albums: { id: string; title: string; coverUrl?: string; count?: number }[];
};

export type Playback = {
  url: string;
  actualQuality: 'standard' | 'lossless' | 'unknown';
  contentType?: string;
  durationSeconds?: number;
  expiresAt?: string;
};

export type RepeatMode = 'off' | 'all' | 'one';
export type Quality = 'standard' | 'lossless';
export type AccentName = 'red' | 'blue' | 'green' | 'amber' | 'violet' | 'custom';
export type FontChoice = 'sans' | 'serif' | 'mono' | 'custom';

// Actions the main process can request from the renderer: media keys, tray items and
// user-configured global shortcuts all arrive through the same command channel.
export type PlayerCommand = 'play-pause' | 'next' | 'previous' | 'volume-up' | 'volume-down' | 'mute' | 'like';
// A shortcut action maps to an Electron accelerator string; '' disables the binding.
export type ShortcutAction = PlayerCommand;
export type ShortcutsSettings = Record<ShortcutAction, string>;

// Desktop lyrics overlay window: enabled toggles the window, locked enables mouse pass-through,
// position persists the last dragged spot (work-area coordinates). fontColor is a #rrggbb hex
// and backgroundOpacity is the overlay capsule alpha (0 = invisible, 1 = solid).
export type DesktopLyricsSettings = {
  enabled: boolean;
  locked: boolean;
  position: { x: number; y: number } | null;
  fontColor: string;
  backgroundOpacity: number;
};

// Appearance pushed to the lyrics window on every settings apply.
export type DesktopLyricsAppearance = {
  locked: boolean;
  fontColor: string;
  backgroundOpacity: number;
};

// Payload the main window renderer pushes to the lyrics window on every line change.
export type DesktopLyricsUpdate = {
  title: string;
  artist: string;
  synced: boolean;
  current: { text: string; translation: string | null } | null;
  next: { text: string; translation: string | null } | null;
};

export type AppearanceSettings = {
  accent: AccentName;
  /** 0.55 – 1: how solid the floating glass panels are. */
  panelOpacity: number;
  /** Base corner radius in px; every component radius derives from it. */
  cornerRadius: number;
  /** 0.85 – 1.2 multiplier applied to all text sizes. */
  fontScale: number;
  fontFamily: FontChoice;
  /** Used when accent === 'custom'; sanitized to #rrggbb. */
  customAccent: string;
  /** Used when fontFamily === 'custom'; an installed family name picked from queryLocalFonts(). */
  customFont: string;
};

export type AppSettings = {
  closeBehavior: 'quit' | 'tray';
  quality: Quality;
  volume: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  appearance: AppearanceSettings;
  // Report real playback to Huawei history. Endpoint shape comes from the public H5 bundle;
  // real-account acceptance is still pending, so failures stay silent and are never retried.
  syncHistory: boolean;
  // Match lyrics from public third-party libraries when the provider returns none.
  thirdPartyLyrics: boolean;
  // User-configured global shortcuts (Electron accelerator strings; '' disables an action).
  shortcuts: ShortcutsSettings;
  // Floating always-on-top desktop lyrics overlay.
  desktopLyrics: DesktopLyricsSettings;
};

export type SavedQueue = {
  tracks: Track[];
  index: number;
  positionSeconds: number;
};

export type DesktopApi = {
  auth: {
    status(): Promise<Result<AuthStatus>>;
    login(): Promise<Result<AuthStatus>>;
    logout(): Promise<Result<void>>;
    cancelLogin(): Promise<Result<void>>;
    onProgress(listener: (message: string) => void): () => void;
  };
  music: {
    favorites(input?: { start?: number; limit?: number; refresh?: boolean }): Promise<Result<FavoritesPage>>;
    favoritesSummary(): Promise<Result<{ total: number }>>;
    playlists(input?: { refresh?: boolean }): Promise<Result<PlaylistList>>;
    playlistDetail(input: { id: string; kind: Playlist['kind']; start?: number; limit?: number; refresh?: boolean }): Promise<Result<PlaylistDetail>>;
    search(input: { query: string; start?: number; limit?: number }): Promise<Result<SearchPage>>;
    history(): Promise<Result<HistoryPage>>;
    album(input: { id: string; start?: number; limit?: number }): Promise<Result<AlbumDetail>>;
    artist(input: { id: string }): Promise<Result<ArtistDetail>>;
    lyrics(input: {
      trackId: string;
      title?: string;
      artist?: string;
      album?: string;
      durationSeconds?: number;
    }): Promise<Result<LyricsDoc>>;
    resolvePlayback(input: { trackId: string; quality: 'standard' | 'lossless' }): Promise<Result<Playback>>;
    reportPlayback(input: { trackId: string; title: string; listenedSeconds: number; songDurationSeconds?: number }): Promise<Result<void>>;
    favoriteState(input: { trackId: string }): Promise<Result<{ favorite: boolean }>>;
    setFavorite(input: { trackId: string; favorite: boolean }): Promise<Result<{ favorite: boolean }>>;
    createPlaylist(input: { name: string; trackIds: string[] }): Promise<Result<{ id?: string }>>;
    updatePlaylistDescription(input: { id: string; description: string }): Promise<Result<{ id: string }>>;
    deletePlaylist(input: { id: string }): Promise<Result<{ id: string }>>;
  };
  settings: {
    get(): Promise<Result<AppSettings>>;
    update(input: Partial<AppSettings>): Promise<Result<AppSettings>>;
  };
  queue: {
    load(): Promise<Result<SavedQueue | null>>;
    save(input: SavedQueue): Promise<Result<void>>;
  };
  window: { minimize(): Promise<void>; setCloseBehavior(input: 'quit' | 'tray'): Promise<Result<AppSettings>> };
  fonts: { list(): Promise<Result<{ families: string[] }>> };
  lyrics: {
    /** Opens a picker; resolves null when the user cancels. */
    importLocal(trackId: string): Promise<Result<LyricsDoc | null>>;
    removeLocal(trackId: string): Promise<Result<{ removed: boolean }>>;
    cacheInfo(): Promise<Result<LyricsCacheInfo>>;
    clearCache(input?: { local?: boolean }): Promise<Result<LyricsCacheInfo>>;
  };
  app: { quit(): Promise<void> };
  player: { onCommand(listener: (command: PlayerCommand) => void): () => void };
  // One-way push channel for the desktop lyrics overlay (send, not invoke: high frequency).
  desktopLyrics: { update(input: DesktopLyricsUpdate): void };
  onNotice(listener: (message: string) => void): () => void;
};

declare global { interface Window { desktop: DesktopApi } }
