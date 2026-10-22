import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cacheLibraryPage, clearMusicSession, clearPersonalData, loadCachedLibraryPage, loadMusicSession, loadWriteIntent, persistenceMode, saveMusicSession, saveWriteIntent, type StoredMusicSession } from './storage';
import { createWriteController } from './writes.mjs';
import { createFavoritesCatalog } from './favorites-catalog.mjs';
import { createMemoryCache } from './memory-cache.mjs';
import { sessionSaveOutcome } from './session-transition.mjs';
import { createSessionEpoch } from './session-epoch.mjs';
import {
  album, artist, createPlaylist, createRecentPlay, deletePlaylist, favoriteExist, favorites, favoritesPage, history,
  lyrics, openLogin, playlistDetail, playlists, resolvePlayback, search, setFavorite, updatePlaylistDescription,
} from './huawei';
import { thirdPartyLyrics } from './lyrics-fallback';
import { readCachedLyrics, readLocalLyrics, writeCachedLyrics } from './lyrics-cache';
import { isTrustedRendererUrl } from './renderer-origin.mjs';
import { errorFrom, fail, ok } from '../shared/result';
import type {
  AlbumDetail, ArtistDetail, AuthStatus, FavoritesPage, HistoryPage, LyricsDoc, Playback, Playlist,
  PlaylistDetail, PlaylistList, Result, SearchPage,
} from '../shared/types';

// Playlists change far less often than they are viewed; a short in-process cache keeps page
// switches instant while explicit refresh and every playlist write still bypass it.
export const PLAYLIST_CACHE_TTL_MS = 5 * 60_000;

export class AuthManager {
  private session: StoredMusicSession['music'] | null = null;
  private persistence: 'secure' | 'memory-only' = persistenceMode();
  private loginPromise: Promise<StoredMusicSession['music']> | null = null;
  private readonly sessionEpoch = createSessionEpoch();
  private writer: ReturnType<typeof createWriteController> | null = null;
  private catalog: ReturnType<typeof createFavoritesCatalog> | null = null;
  private readonly memory = createMemoryCache({ ttlMs: PLAYLIST_CACHE_TTL_MS });
  private cancelLoginRef: (() => void) | null = null;
  constructor(private readonly progress: (message: string) => void,
    private readonly clearRendererData: () => Promise<void> = async () => undefined,
    private readonly loginHost: () => Electron.BrowserWindow | null = () => null) {}

  async restore(): Promise<void> {
    this.session = (await loadMusicSession())?.music ?? null;
    this.persistence = persistenceMode();
  }
  canSaveQueue(): boolean { return !this.loginPromise && !this.sessionEpoch.isTransitioning(); }
  status(): Result<AuthStatus> {
    return ok({ authenticated: !!this.session, musicExpireTime: this.session?.expireTime,
      persistence: this.persistence,
      notice: this.session && this.persistence === 'memory-only' ? '系统安全存储不可用，退出后需重新登录。' : undefined });
  }
  async login(): Promise<Result<AuthStatus>> {
    if (this.sessionEpoch.isTransitioning()) return fail({ kind: 'unknown', message: '退出登录正在进行，请稍后重试。', retryable: true });
    if (this.writer?.busy) return fail({ kind: 'unknown', message: '账号写操作正在核对，请稍后重新登录。', retryable: true });
    if (this.loginPromise) return fail({ kind: 'unknown', message: '登录已在进行中。', retryable: false });
    const parent = this.loginHost();
    if (!parent || parent.isDestroyed()) return fail({ kind: 'unknown', message: '应用窗口不可用，无法开始登录。', retryable: true });
    this.loginPromise = openLogin({
      onProgress: this.progress,
      host: { parent, onCancelReady: cancel => { this.cancelLoginRef = cancel; } },
    }).then(async (session) => {
      const candidate = { token: session.token, snsUserID: session.snsUserID, expireTime: session.expireTime };
      await favorites(candidate);
      const previous = this.session;
      this.sessionEpoch.beginTransition();
      this.catalog?.invalidate();
      try {
        await clearPersonalData();
        await this.clearRendererData();
        let persisted = false;
        try { persisted = await saveMusicSession({ version: 1, music: candidate }); }
        catch { persisted = false; }
        const outcome = sessionSaveOutcome(!!previous, persisted);
        if (outcome === 'preserve') throw new Error('新会话无法安全保存，已保留现有登录状态。');
        this.persistence = outcome === 'memory-only' ? 'memory-only' : 'secure';
        this.session = candidate;
        this.writer = null;
        this.memory.clear();
        this.catalog?.invalidate(); this.catalog = null;
        return candidate;
      } finally { this.sessionEpoch.endTransition(); }
    });
    try { await this.loginPromise; return this.status(); }
    catch (error) { return fail(errorFrom(error, '登录未完成。')); }
    finally { this.loginPromise = null; this.cancelLoginRef = null; }
  }
  // Lets the renderer cancel an in-progress official login without closing the app window.
  cancelLogin(): Result<void> {
    if (!this.cancelLoginRef) return fail({ kind: 'invalid', message: '当前没有进行中的登录。', retryable: false });
    this.cancelLoginRef();
    return ok(undefined);
  }
  async logout(): Promise<Result<void>> {
    if (this.loginPromise) return fail({ kind: 'unknown', message: '登录正在进行，完成后再退出。', retryable: true });
    if (this.writer?.busy) return fail({ kind: 'unknown', message: '账号写操作正在核对，请稍后退出。', retryable: true });
    if (this.sessionEpoch.isTransitioning()) return fail({ kind: 'unknown', message: '退出登录正在进行。', retryable: true });
    this.sessionEpoch.beginTransition();
    this.catalog?.invalidate();
    try {
      await clearPersonalData();
      await this.clearRendererData();
      await clearMusicSession();
      this.session = null;
      this.writer = null;
      this.memory.clear();
      this.catalog?.invalidate(); this.catalog = null;
      this.sessionEpoch.endTransition();
      return ok(undefined);
    } catch (error) {
      this.sessionEpoch.endTransition();
      return fail(errorFrom(error, '无法清除本机保存的音乐会话。'));
    }
  }
  private favoriteCatalog(): ReturnType<typeof createFavoritesCatalog> {
    if (!this.session) throw new Error('请先登录华为音乐。');
    const session = this.session;
    this.catalog ??= createFavoritesCatalog((start: number, limit: number) => favoritesPage(session, start, limit));
    return this.catalog;
  }
  async getFavoritesSummary(): Promise<Result<{ total: number }>> {
    return this.#sessionRequest(() => this.favoriteCatalog().summary(), '账号状态已更改，请重新统计收藏。');
  }
  async getFavorites(start = 0, limit = 50, refresh = false): Promise<Result<FavoritesPage>> {
    if (this.sessionEpoch.isTransitioning()) return fail({ kind: 'auth', message: '正在退出登录，请稍后重试。', retryable: true });
    if (!this.session) return fail({ kind: 'auth', message: '请先登录华为音乐。', retryable: false });
    const epoch = this.sessionEpoch.capture();
    try {
      if (refresh) this.favoriteCatalog().invalidate();
      const page = await this.favoriteCatalog().page(start, limit);
      if (!this.sessionEpoch.isCurrent(epoch)) return fail({ kind: 'auth', message: '账号状态已更改，请重新读取收藏。', retryable: true });
      await cacheLibraryPage(`favorites:${start}:${limit}`, page, () => this.sessionEpoch.isCurrent(epoch)).catch(() => undefined);
      if (!this.sessionEpoch.isCurrent(epoch)) return fail({ kind: 'auth', message: '账号状态已更改，请重新读取收藏。', retryable: true });
      return ok(page);
    } catch (error) {
      const failure = errorFrom(error);
      if (failure.kind === 'network' && this.sessionEpoch.isCurrent(epoch)) {
        const cached = await loadCachedLibraryPage(`favorites:${start}:${limit}`).catch(() => null);
        if (cached && this.sessionEpoch.isCurrent(epoch)) return ok(cached as FavoritesPage);
      }
      return fail(failure);
    }
  }
  async getPlaylists(refresh = false): Promise<Result<PlaylistList>> {
    if (!refresh) {
      const hit = this.memory.get('playlists');
      if (hit) return ok({ ...(hit.data as PlaylistList), cached: true, cachedAt: hit.savedAt });
    }
    const result = await this.#cachedRead('playlists', () => playlists(this.session!));
    if (result.ok) this.memory.set('playlists', result.data);
    return result;
  }
  async getPlaylistDetail(playlistId: string, kind: Playlist['kind'], start: number, limit: number, refresh = false): Promise<Result<PlaylistDetail>> {
    const key = `playlist:${kind}:${playlistId}:${start}:${limit}`;
    if (!refresh) {
      const hit = this.memory.get(key);
      if (hit) return ok({ ...(hit.data as PlaylistDetail), cached: true, cachedAt: hit.savedAt });
    }
    const result = await this.#cachedRead(key, () => playlistDetail(this.session!, playlistId, kind, start, limit));
    if (result.ok) this.memory.set(key, result.data);
    return result;
  }
  // Playback history sync is best effort: it must never interrupt playback or surface a provider
  // error in the player UI, and it is never retried automatically.
  async reportPlayback(input: { trackId: string; title: string; listenedSeconds: number; songDurationSeconds?: number }): Promise<Result<void>> {
    const result = await this.#sessionRequest(() => createRecentPlay(this.session!, input), '账号状态已更改，本次播放未上报。');
    return result.ok ? ok(undefined) : fail(result.error);
  }
  async getSearch(query: string, start: number, limit: number): Promise<Result<SearchPage>> {
    return this.#sessionRequest(() => search(this.session!, query, start, limit), '账号状态已更改，请重新搜索。');
  }
  async getRemoteHistory(): Promise<Result<HistoryPage>> {
    return this.#sessionRequest(() => history(this.session!), '账号状态已更改，请重新读取历史。');
  }
  async getAlbum(albumId: string, start: number, limit: number): Promise<Result<AlbumDetail>> {
    return this.#sessionRequest(() => album(this.session!, albumId, start, limit), '账号状态已更改，请重新读取专辑。');
  }
  async getArtist(artistId: string): Promise<Result<ArtistDetail>> {
    return this.#sessionRequest(() => artist(this.session!, artistId), '账号状态已更改，请重新读取歌手。');
  }
  async getLyrics(input: { trackId: string; title?: string; artist?: string; album?: string; durationSeconds?: number }, thirdParty = true): Promise<Result<LyricsDoc>> {
    // Reopening the lyric surfaces for a track that is already playing must not re-resolve a
    // playback URL and re-download the LRC. Successful documents are cached, including the
    // third-party match, so switching between panel and stage stays offline after the first hit.
    const key = `lyrics:${input.trackId}`;
    const hit = this.memory.get(key);
    if (hit) return ok(hit.data as LyricsDoc);
    // Local imports win over everything and work even without a signed-in session.
    const local = await readLocalLyrics(input.trackId).catch(() => null);
    if (local) { this.memory.set(key, local.doc); return ok(local.doc); }
    const cached = await readCachedLyrics(input.trackId).catch(() => null);
    if (cached) { this.memory.set(key, cached); return ok(cached); }
    const result = await this.#sessionRequest(() => lyrics(this.session!, input.trackId), '账号状态已更改，请重新读取歌词。');
    if (!result.ok) return result;
    if (result.data.lines.length) {
      const doc = { ...result.data, source: 'huawei' as const };
      this.memory.set(key, doc);
      await writeCachedLyrics(input.trackId, doc).catch(() => undefined);
      return ok(doc);
    }
    if (thirdParty) {
      // A missing lyric is common; a strict title+artist+duration match decides whether the public
      // libraries are allowed to answer. Failures are silent and left uncached so a retry can work.
      const fallback = await thirdPartyLyrics({ title: input.title, artist: input.artist, album: input.album, durationSeconds: input.durationSeconds })
        .catch(() => null);
      if (fallback) {
        this.memory.set(key, fallback);
        await writeCachedLyrics(input.trackId, fallback).catch(() => undefined);
        return ok(fallback);
      }
    }
    return result;
  }

  /** Stores a freshly imported local lyric in the in-process cache. */
  rememberLyrics(trackId: string, doc: LyricsDoc): void {
    this.memory.set(`lyrics:${trackId}`, doc);
  }

  /** Drops the in-process lyric so the next read re-resolves from disk/providers. */
  forgetLyrics(trackId: string): void {
    this.memory.invalidate(`lyrics:${trackId}`);
  }
  async getFavoriteState(trackId: string): Promise<Result<{ favorite: boolean }>> {
    return this.#sessionRequest(async () => ({ favorite: await favoriteExist(this.session!, trackId) }), '账号状态已更改，请重新读取收藏状态。');
  }
  private writes(): ReturnType<typeof createWriteController> {
    if (!this.session) throw new Error('请先登录华为音乐。');
    const session = this.session;
    this.writer ??= createWriteController({
      playlists: () => playlists(session),
      playlistDetail: (id: string) => playlistDetail(session, id, 'owned'),
      favoriteExist: (id: string) => favoriteExist(session, id),
      setFavorite: (id: string, target: boolean) => setFavorite(session, id, target),
      createPlaylist: (name: string, tracks: string[]) => createPlaylist(session, name, tracks),
      updateDescription: (id: string, description: string) => updatePlaylistDescription(session, id, description),
      deletePlaylist: (id: string) => deletePlaylist(session, id),
    }, { load: loadWriteIntent, save: saveWriteIntent });
    return this.writer;
  }
  async setFavorite(trackId: string, favorite: boolean): Promise<Result<{ favorite: boolean }>> {
    const result = await this.#sessionWrite(() => this.writes().setFavorite(trackId, favorite));
    if (result.ok) this.catalog?.invalidate();
    return result;
  }
  async createPlaylist(name: string, trackIds: string[]): Promise<Result<{ id?: string }>> {
    return this.#playlistWrite(() => this.writes().createPlaylist(name, trackIds));
  }
  async updatePlaylistDescription(playlistId: string, description: string): Promise<Result<{ id: string }>> {
    return this.#playlistWrite(() => this.writes().updateDescription(playlistId, description));
  }
  async deletePlaylist(playlistId: string): Promise<Result<{ id: string }>> {
    return this.#playlistWrite(() => this.writes().deletePlaylist(playlistId));
  }
  async #playlistWrite<T>(run: () => Promise<T>): Promise<Result<T>> {
    const result = await this.#sessionWrite(run);
    if (result.ok) this.memory.invalidatePrefix('playlist');
    return result;
  }
  async #sessionWrite<T>(run: () => Promise<T>): Promise<Result<T>> {
    if (this.loginPromise) return fail({ kind: 'unknown', message: '登录正在进行，请稍后再修改音乐库。', retryable: false });
    return this.#sessionRequest(run, '账号状态已更改，写操作结果未确认。');
  }
  async getPlayback(trackId: string, quality: 'standard' | 'lossless'): Promise<Result<Playback>> {
    if (this.sessionEpoch.isTransitioning()) return fail({ kind: 'auth', message: '正在退出登录，请稍后重试。', retryable: true });
    if (!this.session) return fail({ kind: 'auth', message: '请先登录华为音乐。', retryable: false });
    const epoch = this.sessionEpoch.capture();
    try {
      const playback = await resolvePlayback(this.session, trackId, quality);
      if (!this.sessionEpoch.isCurrent(epoch)) return fail({ kind: 'auth', message: '账号状态已更改，请重新请求播放资源。', retryable: true });
      return ok(playback);
    } catch (error) { return fail(errorFrom(error)); }
  }
  async #cachedRead<T>(key: string, read: () => Promise<T>): Promise<Result<T>> {
    const epoch = this.sessionEpoch.capture();
    const result = await this.#sessionRequest(read, '账号状态已更改，请刷新。');
    if (!this.sessionEpoch.isCurrent(epoch)) return fail({ kind: 'auth', message: '账号状态已更改，请刷新。', retryable: true });
    if (result.ok) {
      await cacheLibraryPage(key, result.data, () => this.sessionEpoch.isCurrent(epoch)).catch(() => undefined);
      if (!this.sessionEpoch.isCurrent(epoch)) return fail({ kind: 'auth', message: '账号状态已更改，请刷新。', retryable: true });
      return result;
    }
    if (result.error.kind === 'network') {
      const cached = await loadCachedLibraryPage(key).catch(() => null);
      if (cached && this.sessionEpoch.isCurrent(epoch)) return ok(cached as T);
    }
    return result;
  }
  // Shared guard for session-scoped calls: no session means no request is issued.
  async #sessionRequest<T>(run: () => Promise<T>, staleMessage: string): Promise<Result<T>> {
    if (this.sessionEpoch.isTransitioning()) return fail({ kind: 'auth', message: '正在退出登录，请稍后重试。', retryable: true });
    if (!this.session) return fail({ kind: 'auth', message: '请先登录华为音乐。', retryable: false });
    const epoch = this.sessionEpoch.capture();
    try {
      const data = await run();
      if (!this.sessionEpoch.isCurrent(epoch)) return fail({ kind: 'auth', message: staleMessage, retryable: true });
      return ok(data);
    } catch (error) { return fail(errorFrom(error)); }
  }
}

export function isAllowedSender(window: BrowserWindow, event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  return event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && isTrustedRendererUrl(event.senderFrame.url, pathToFileURL(join(__dirname, '../renderer/index.html')).href);
}
