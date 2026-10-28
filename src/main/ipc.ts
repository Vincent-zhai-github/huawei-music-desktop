import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { channels } from '../shared/channels';
import { AuthManager, isAllowedSender } from './auth-manager';
import { loadQueue, loadSettings, saveQueue, updateSettings } from './storage';
import { listSystemFonts } from './system-fonts';
import { clearLyricsCache, lyricsCacheInfo, readLyricsFile, removeLocalLyrics, writeLocalLyrics } from './lyrics-cache';
import { parseLyrics } from '../lyrics.mjs';
import { fail, ok } from '../shared/result';
import { QUALITY_ORDER } from '../shared/qualities.mjs';
import type { DesktopLyricsModule } from './desktop-lyrics';
import type { LyricsDoc, Quality, SavedQueue } from '../shared/types';

export function registerIpc(
  window: BrowserWindow,
  auth: AuthManager,
  hooks: {
    onCloseBehavior?: (value: 'quit' | 'tray') => void;
    onShortcuts?: (settings: import('../shared/types').AppSettings) => void;
    onDesktopLyrics?: (settings: import('../shared/types').AppSettings) => void;
    desktopLyrics?: DesktopLyricsModule;
  } = {},
): void {
  const guard = (event: Electron.IpcMainInvokeEvent) => {
    if (!isAllowedSender(window, event)) throw new Error('IPC 来源不受信任');
  };
  const idOf = (value: unknown) => (typeof value === 'string' && value.trim() && value.length <= 200 ? value.trim() : null);
  for (const channel of Object.values(channels)) ipcMain.removeHandler(channel);
  ipcMain.handle(channels.authStatus, async event => { guard(event); return auth.status(); });
  ipcMain.handle(channels.authLogin, async event => { guard(event); return auth.login(); });
  ipcMain.handle(channels.authLogout, async event => { guard(event); return auth.logout(); });
  ipcMain.handle(channels.authCancelLogin, async event => { guard(event); return auth.cancelLogin(); });
  ipcMain.handle(channels.musicFavorites, async (event, input: { start?: number; limit?: number; refresh?: boolean } = {}) => {
    guard(event);
    const start = input?.start ?? 0;
    const limit = input?.limit ?? 50;
    if (!Number.isInteger(start) || start < 0 || start > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('收藏分页参数无效');
    }
    if (input.refresh !== undefined && (typeof input.refresh !== 'boolean' || (input.refresh && start !== 0))) throw new Error('收藏刷新参数无效');
    return auth.getFavorites(start, limit, input.refresh ?? false);
  });
  ipcMain.handle(channels.musicFavoritesSummary, async event => { guard(event); return auth.getFavoritesSummary(); });
  const refreshFlag = (value: unknown) => value === undefined || typeof value === 'boolean';
  ipcMain.handle(channels.musicPlaylists, async (event, input: { refresh?: boolean } = {}) => {
    guard(event);
    if (!refreshFlag(input?.refresh)) throw new Error('歌单刷新参数无效');
    return auth.getPlaylists(input.refresh ?? false);
  });
  ipcMain.handle(channels.musicPlaylistDetail, async (event, input: { id?: string; kind?: string; start?: number; limit?: number; refresh?: boolean } = {}) => {
    guard(event);
    const playlistId = idOf(input?.id);
    const start = input?.start ?? 0;
    const limit = input?.limit ?? 50;
    if (!playlistId || !['owned', 'collected', 'chart', 'unknown'].includes(input?.kind ?? '')
      || !Number.isInteger(start) || start < 0 || start > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50
      || !refreshFlag(input?.refresh)) {
      throw new Error('歌单详情参数无效');
    }
    return auth.getPlaylistDetail(playlistId, input.kind as 'owned' | 'collected' | 'chart' | 'unknown', start, limit, input.refresh ?? false);
  });
  ipcMain.handle(channels.musicSearch, async (event, input: { query?: string; start?: number; limit?: number } = {}) => {
    guard(event);
    const query = typeof input?.query === 'string' ? input.query.trim() : '';
    const start = input?.start ?? 0;
    const limit = input?.limit ?? 20;
    if (!query || query.length > 80 || !Number.isInteger(start) || start < 0 || start > 100000
      || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('搜索参数无效');
    }
    return auth.getSearch(query, start, limit);
  });
  ipcMain.handle(channels.musicHistory, async event => { guard(event); return auth.getRemoteHistory(); });
  ipcMain.handle(channels.musicAlbum, async (event, input: { id?: string; start?: number; limit?: number } = {}) => {
    guard(event);
    const albumId = idOf(input?.id);
    const start = input?.start ?? 0;
    const limit = input?.limit ?? 50;
    if (!albumId || !Number.isInteger(start) || start < 0 || start > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('专辑参数无效');
    }
    return auth.getAlbum(albumId, start, limit);
  });
  ipcMain.handle(channels.musicArtist, async (event, input: { id?: string } = {}) => {
    guard(event);
    const artistId = idOf(input?.id);
    if (!artistId) throw new Error('歌手参数无效');
    return auth.getArtist(artistId);
  });
  ipcMain.handle(channels.musicLyrics, async (event, input: { trackId?: string; title?: string; artist?: string; album?: string; durationSeconds?: number } = {}) => {
    guard(event);
    const trackId = idOf(input?.trackId);
    if (!trackId) throw new Error('歌词参数无效');
    const settings = await loadSettings();
    const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
    const duration = Number(input?.durationSeconds);
    return auth.getLyrics({
      trackId,
      title: text(input?.title, 200),
      artist: text(input?.artist, 200),
      album: text(input?.album, 200),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
    }, settings.thirdPartyLyrics !== false);
  });
  ipcMain.handle(channels.musicReportPlayback, async (event, input: { trackId?: string; title?: string; listenedSeconds?: number; songDurationSeconds?: number } = {}) => {
    guard(event);
    const trackId = idOf(input?.trackId);
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const listened = input?.listenedSeconds;
    const songDuration = input?.songDurationSeconds;
    const validDuration = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24 * 3600);
    if (!trackId || !title || title.length > 200 || typeof listened !== 'number' || !Number.isFinite(listened)
      || listened < 0 || listened > 24 * 3600 || !validDuration(songDuration)) {
      throw new Error('播放历史上报参数无效');
    }
    return auth.reportPlayback({ trackId, title, listenedSeconds: listened, songDurationSeconds: songDuration });
  });
  ipcMain.handle(channels.musicFavoriteState, async (event, input: { trackId?: string } = {}) => {
    guard(event);
    const trackId = idOf(input?.trackId);
    if (!trackId) throw new Error('收藏状态参数无效');
    return auth.getFavoriteState(trackId);
  });
  ipcMain.handle(channels.musicSetFavorite, async (event, input: { trackId?: string; favorite?: boolean } = {}) => {
    guard(event);
    const trackId = idOf(input?.trackId);
    if (!trackId || typeof input?.favorite !== 'boolean') throw new Error('收藏参数无效');
    return auth.setFavorite(trackId, input.favorite);
  });
  ipcMain.handle(channels.musicCreatePlaylist, async (event, input: { name?: string; trackIds?: unknown } = {}) => {
    guard(event);
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const trackIds = Array.isArray(input?.trackIds) ? input.trackIds.filter((value): value is string => typeof value === 'string' && !!value && value.length <= 200).slice(0, 200) : [];
    if (!name || name.length > 60 || !trackIds.length || trackIds.length !== (Array.isArray(input?.trackIds) ? input.trackIds.length : 0)) {
      throw new Error('创建歌单参数无效');
    }
    return auth.createPlaylist(name, trackIds);
  });
  ipcMain.handle(channels.musicUpdatePlaylistDescription, async (event, input: { id?: string; description?: string } = {}) => {
    guard(event);
    const playlistId = idOf(input?.id);
    if (!playlistId || typeof input?.description !== 'string' || input.description.length > 200) throw new Error('简介参数无效');
    return auth.updatePlaylistDescription(playlistId, input.description);
  });
  ipcMain.handle(channels.musicDeletePlaylist, async (event, input: { id?: string } = {}) => {
    guard(event);
    const playlistId = idOf(input?.id);
    if (!playlistId) throw new Error('歌单 ID 无效');
    return auth.deletePlaylist(playlistId);
  });
  ipcMain.handle(channels.musicResolvePlayback, async (event, input: { trackId: string; quality: Quality }) => {
    guard(event);
    if (!input || !idOf(input.trackId) || !QUALITY_ORDER.includes(input.quality)) {
      throw new Error('播放参数无效');
    }
    return auth.getPlayback(input.trackId, input.quality);
  });
  ipcMain.handle(channels.settingsGet, async event => { guard(event); return ok(await loadSettings()); });
  ipcMain.handle(channels.settingsUpdate, async (event, input: unknown) => {
    guard(event);
    const next = await updateSettings(input);
    hooks.onShortcuts?.(next);
    hooks.onDesktopLyrics?.(next);
    return ok(next);
  });
  // One-way listeners must be idempotent: registerIpc runs again whenever the window is
  // recreated (macOS activate), and stacked listeners would double-forward every payload.
  ipcMain.removeAllListeners(channels.desktopLyricsUpdate);
  ipcMain.on(channels.desktopLyricsUpdate, (event, payload) => {
    if (!isAllowedSender(window, event)) return;
    hooks.desktopLyrics?.forwardUpdate(payload);
  });
  ipcMain.handle(channels.fontsList, async event => { guard(event); return ok({ families: await listSystemFonts() }); });
  ipcMain.handle(channels.lyricsCacheInfo, async event => { guard(event); return ok(await lyricsCacheInfo()); });
  ipcMain.handle(channels.lyricsClearCache, async (event, input: { local?: boolean } = {}) => {
    guard(event);
    return ok(await clearLyricsCache({ local: input?.local === true }));
  });
  ipcMain.handle(channels.lyricsImport, async (event, input: { trackId?: string } = {}) => {
    guard(event);
    const trackId = idOf(input?.trackId);
    if (!trackId) throw new Error('歌词参数无效');
    // The picker is a pure read of a local file; cancellation resolves to null, not an error.
    const picked = await dialog.showOpenDialog(window, {
      title: '选择歌词文件',
      buttonLabel: '导入',
      properties: ['openFile'],
      filters: [{ name: '歌词文件', extensions: ['lrc', 'txt'] }],
    });
    const filePath = picked.canceled ? undefined : picked.filePaths[0];
    if (!filePath) return ok(null);
    const { text, fileName } = await readLyricsFile(filePath);
    const doc = parseLyrics(text) as LyricsDoc;
    if (!doc.lines.length) throw new Error('这个文件里没有可识别的歌词');
    await writeLocalLyrics(trackId, text, fileName, doc);
    const stored = { ...doc, source: 'local' as const };
    auth.rememberLyrics(trackId, stored);
    return ok(stored);
  });
  ipcMain.handle(channels.lyricsRemoveLocal, async (event, input: { trackId?: string } = {}) => {
    guard(event);
    const trackId = idOf(input?.trackId);
    if (!trackId) throw new Error('歌词参数无效');
    const removed = await removeLocalLyrics(trackId);
    if (removed) auth.forgetLyrics(trackId);
    return ok({ removed });
  });
  ipcMain.handle(channels.queueLoad, async event => { guard(event); return ok(await loadQueue()); });
  ipcMain.handle(channels.queueSave, async (event, input: unknown) => {
    guard(event);
    const queue = (input ?? {}) as { tracks?: unknown };
    if (!queue || typeof queue !== 'object' || !Array.isArray(queue.tracks) || queue.tracks.length > 10000
      || JSON.stringify(queue).length > 5 * 1024 * 1024) return fail({ kind: 'invalid', message: '队列数据无效或过大。', retryable: false });
    if (!auth.canSaveQueue()) return fail({ kind: 'auth', message: '账号切换正在进行，队列未保存。', retryable: false });
    await saveQueue(queue as SavedQueue);
    return ok(undefined);
  });
  ipcMain.handle(channels.windowSetCloseBehavior, async (event, input: 'quit' | 'tray') => {
    guard(event);
    if (!['quit', 'tray'].includes(input)) throw new Error('关闭行为无效');
    const next = await updateSettings({ closeBehavior: input });
    hooks.onCloseBehavior?.(next.closeBehavior);
    return ok(next);
  });
  ipcMain.handle(channels.windowMinimize, async event => { guard(event); window.minimize(); });
  ipcMain.handle(channels.appQuit, async event => { guard(event); app.quit(); });
}
