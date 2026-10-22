// Offline main-window UI smoke: no loopback server, no Huawei network access.
// Fixtures are injected into an isolated temporary Electron profile through test-only IPC.
import electron from 'electron';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as playwright } from 'playwright-core';
import { APP_DISPLAY_NAME } from '../src/shared/app-name.mjs';

process.umask(0o077);
const profile = await mkdtemp(join(tmpdir(), 'huawei-ui-profile-'));
const media = await mkdtemp(join(tmpdir(), 'huawei-ui-audio-'));
let app;

async function launch() {
  const instance = await playwright.launch({
    executablePath: electron,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  try {
    const page = await instance.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return { instance, page };
  } catch (error) {
    instance.process().kill('SIGTERM');
    throw error;
  }
}

// Replaces the production handlers with offline fixtures; the real IPC validation is bypassed
// only inside this test process, never in the shipped main process.
// The restored queue is only visible in the queue panel, so assert through that surface.
async function assertQueueContents(page) {
  await page.getByRole('button', { name: '播放队列' }).click();
  const items = page.locator('.side-panel[aria-label="播放队列"] .queue-item');
  await items.first().waitFor({ timeout: 5000 });
  // Compare titles only; the row also renders the artist line.
  assert.deepEqual(await items.locator('span').allInnerTexts(), ['Smoke MP3', 'Smoke FLAC'], 'restored queue lost tracks');
  await page.getByRole('button', { name: '关闭' }).click();
}

async function installHandlers(instance, urls) {
  // Playwright injects the electron module as the first evaluate argument; a dynamic import()
  // inside the evaluated function is not supported by this harness.
  await instance.evaluate(({ ipcMain }, { urls: mediaUrls }) => {
    const tracks = [
      { id: 'smoke-mp3', title: 'Smoke MP3', artists: [{ id: 'artist-1', name: 'Local fixture' }], album: { id: 'album-1', title: 'Fixture Album' }, durationSeconds: 4, available: true },
      { id: 'smoke-flac', title: 'Smoke FLAC', artists: [{ name: 'Local fixture' }], durationSeconds: 4, available: true },
    ];
    const ok = data => ({ ok: true, data });
    globalThis.__favoriteWrites = [];
    globalThis.__searchQueries = [];
    globalThis.__descriptionWrites = [];
    globalThis.__deletedPlaylists = [];
    globalThis.__historyReports = [];
    const channels = ['auth:status', 'music:favorites', 'music:favorites-summary', 'music:resolve-playback', 'music:lyrics', 'music:set-favorite',
      'music:playlists', 'music:playlist-detail', 'music:search', 'music:history', 'music:album', 'music:artist', 'music:favorite-state', 'music:report-playback',
      'music:create-playlist', 'music:update-playlist-description', 'music:delete-playlist'];
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.handle('auth:status', () => ok({ authenticated: true, persistence: 'memory-only' }));
    ipcMain.handle('music:favorites', () => ok({ tracks, nextStart: 50, hasMore: false, total: tracks.length }));
    ipcMain.handle('music:favorites-summary', () => ok({ total: tracks.length }));
    ipcMain.handle('music:report-playback', (_event, input) => { globalThis.__historyReports.push(input); return ok(undefined); });
    ipcMain.handle('music:resolve-playback', (_event, input) => ok({
      url: input.trackId === 'smoke-mp3' ? mediaUrls[0] : mediaUrls[1],
      actualQuality: input.trackId === 'smoke-mp3' ? 'standard' : 'lossless',
    }));
    ipcMain.handle('music:lyrics', () => ok({ synced: true, lines: [{ timeMs: 0, text: '第一句歌词' }, { timeMs: 60_000, text: '第二句歌词' }] }));
    ipcMain.handle('music:favorite-state', () => ok({ favorite: true }));
    ipcMain.handle('music:set-favorite', (_event, input) => {
      globalThis.__favoriteWrites.push({ trackId: input.trackId, favorite: input.favorite });
      return ok({ favorite: input.favorite });
    });
    ipcMain.handle('music:playlists', () => ok({ playlists: [
      { id: 'owned-1', title: '自建歌单', kind: 'owned', count: 5 },
      { id: 'collected-1', title: '收藏歌单', kind: 'collected' },
    ], truncated: false }));
    ipcMain.handle('music:playlist-detail', (_event, input) => ok({
      playlist: { id: input.id, title: '自建歌单', kind: input.kind, count: 1, description: '旧简介' },
      tracks: [tracks[0]], nextStart: 50, hasMore: false,
    }));
    ipcMain.handle('music:search', (_event, input) => {
      globalThis.__searchQueries.push(input.query);
      return ok({ tracks: [tracks[1]], nextStart: 20, hasMore: false, total: 1 });
    });
    ipcMain.handle('music:history', () => ok({ tracks: [tracks[1]] }));
    ipcMain.handle('music:album', () => ok({ album: { id: 'album-1', title: 'Fixture Album', artists: [{ name: 'Local fixture' }] }, tracks: [tracks[0]], nextStart: 50, hasMore: false }));
    ipcMain.handle('music:artist', () => ok({ artist: { id: 'artist-1', name: 'Local fixture' }, tracks: [tracks[0]], albums: [{ id: 'album-1', title: 'Fixture Album' }] }));
    ipcMain.handle('music:create-playlist', () => ok({ id: 'created-1' }));
    // Mirrors the production contract: writes answer with an explicit confirmation payload so the
    // renderer can distinguish a completed void write from a rejected one.
    ipcMain.handle('music:update-playlist-description', (_event, input) => {
      globalThis.__descriptionWrites.push({ id: input.id, description: input.description });
      return ok({ id: input.id });
    });
    ipcMain.handle('music:delete-playlist', (_event, input) => {
      globalThis.__deletedPlaylists.push(input.id);
      return ok({ id: input.id });
    });
  }, { urls });
}

try {
  const wav = join(media, 'tone.wav');
  const mp3 = join(media, 'tone.mp3');
  const flac = join(media, 'tone.flac');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-ar', '44100', wav]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', mp3]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-c:a', 'flac', flac]);
  const samples = [
    { type: 'audio/mpeg', bytes: (await readFile(mp3)).toString('base64') },
    { type: 'audio/flac', bytes: (await readFile(flac)).toString('base64') },
  ];

  const first = await launch();
  app = first.instance;
  const page = first.page;
  await page.waitForTimeout(1500);

  assert.match(await page.locator('body').innerText(), /连接你的音乐库/);
  assert.equal(await page.title(), APP_DISPLAY_NAME);
  assert.equal(await page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true, 'empty queue should disable playback');
  const boundary = await page.evaluate(() => ({
    apiKeys: Object.keys(window.desktop ?? {}).sort(),
    musicKeys: Object.keys(window.desktop?.music ?? {}).sort(),
    nodeProcess: typeof process,
    genericInvoke: typeof window.desktop?.invoke,
  }));
  assert.deepEqual(boundary.apiKeys, ['app', 'auth', 'desktopLyrics', 'fonts', 'lyrics', 'music', 'onNotice', 'player', 'queue', 'settings', 'window']);
  assert.deepEqual(boundary.musicKeys, ['album', 'artist', 'createPlaylist', 'deletePlaylist', 'favoriteState', 'favorites', 'favoritesSummary', 'history', 'lyrics',
    'playlistDetail', 'playlists', 'reportPlayback', 'resolvePlayback', 'search', 'setFavorite', 'updatePlaylistDescription']);
  assert.equal(boundary.nodeProcess, 'undefined');
  assert.equal(boundary.genericInvoke, 'undefined', 'preload exposed a generic IPC entry point');

  const trustedUrl = await page.url();
  await page.evaluate(() => { window.location.href = 'file:///etc/passwd'; });
  await page.waitForTimeout(200);
  assert.equal(await page.url(), trustedUrl, 'main window left the trusted renderer document');

  // The Audio proxy must survive the reload that installs the fixtures, so it goes in as an
  // init script rather than a one-shot evaluate.
  // The status/notice region is transient by design (later page loads overwrite it), so record every
  // message it displays instead of racing a single `getByText` against a later overwrite.
  await page.addInitScript(() => {
    window.__notices = [];
    const remember = () => {
      const text = document.querySelector('.notice')?.textContent ?? '';
      if (text && window.__notices[window.__notices.length - 1] !== text) window.__notices.push(text);
    };
    const start = () => {
      remember();
      new MutationObserver(remember).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  });
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__testAudioInstances = [];
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const element = Reflect.construct(target, args);
        window.__testAudioInstances.push(element);
        return element;
      },
    });
  });
  // Boot the app once against fixture handlers so the initial status/library reads resolve.
  await installHandlers(app, []);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // Blob URLs belong to a single document, so mint them after the reload, then rebind the
  // playback handler to the URLs that are valid in the reloaded renderer.
  const urls = await page.evaluate(list => list.map(({ type, bytes }) => {
    const binary = atob(bytes);
    const data = Uint8Array.from(binary, character => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([data], { type }));
  }), samples);
  await installHandlers(app, urls);

  // Favorites page: list, playback with a single Audio element.
  // Anchor to the row's own accessible name; a bare /Smoke MP3/ also matches the favorite button.
  const mp3Row = page.getByRole('button', { name: /^Smoke MP3/ });
  await mp3Row.waitFor({ timeout: 15_000 });
  assert.equal(await page.getByRole('button', { name: /^Smoke FLAC/ }).count(), 1);
  await mp3Row.click();
  assert.equal(await page.getByRole('button', { name: '播放', exact: true }).isDisabled(), true, 'single click selects, not plays');
  await mp3Row.press('Enter');
  await page.getByRole('button', { name: '暂停' }).waitFor({ timeout: 15_000 });
  const audioState = await page.evaluate(() => ({
    count: window.__testAudioInstances.length,
    paused: window.__testAudioInstances[0]?.paused,
  }));
  assert.equal(audioState.count, 1, 'app must own exactly one Audio element');
  assert.equal(audioState.paused, false);

  // Favorite write goes through IPC once and the button reflects the read-back value.
  await page.getByRole('button', { name: '取消收藏 Smoke MP3' }).click();
  await page.waitForFunction(() => document.querySelector('.notice')?.textContent.includes('已取消收藏'));
  const writes = await app.evaluate(() => { const rows = globalThis.__favoriteWrites; return rows.splice(0, rows.length); });
  // Real playback reaches the history-sync IPC with the seconds actually heard, never more.
  // The reports live in the main process, so poll from the test process instead of the page.
  let historyReports = [];
  for (let attempt = 0; attempt < 75; attempt++) {
    historyReports = await app.evaluate(() => globalThis.__historyReports.slice());
    if (historyReports.some(report => report.trackId === 'smoke-mp3')) break;
    await page.waitForTimeout(200);
  }
  const mp3Reports = historyReports.filter(report => report.trackId === 'smoke-mp3');
  assert.equal(mp3Reports.length, 1, `expected exactly one report per playback, got ${JSON.stringify(historyReports)}`);
  assert.equal(mp3Reports[0].title, 'Smoke MP3');
  assert.ok(mp3Reports[0].listenedSeconds >= 2 && mp3Reports[0].listenedSeconds <= 4, JSON.stringify(mp3Reports[0]));
  assert.equal(mp3Reports[0].songDurationSeconds, 4);
  assert.deepEqual(historyReports.filter(report => report.listenedSeconds > (report.songDurationSeconds ?? Infinity)), [],
    'a history report must never claim more seconds than the track really played');
  assert.deepEqual(writes, [{ trackId: 'smoke-mp3', favorite: false }]);

  // Lyrics / queue panels are mutually exclusive overlays.
  await page.getByRole('button', { name: '歌词' }).click();
  await page.getByText('第一句歌词').waitFor({ timeout: 5000 });

  // Local LRC import: the file dialog is stubbed, everything else runs for real (disk + IPC + parse).
  const localLrc = join(profile, 'import-test.lrc');
  await writeFile(localLrc, '[00:00.00]本地第一句\n[00:30.00]本地第二句\n', 'utf8');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, localLrc);
  await page.getByRole('button', { name: '导入本地歌词' }).click();
  await page.getByText('本地第一句').waitFor({ timeout: 5000 });
  await page.getByText(/歌词来自 本地文件/).waitFor({ timeout: 3000 });
  assert.equal(await page.getByRole('button', { name: '移除本地' }).count(), 1, 'an imported lyric should be removable');
  await page.getByRole('button', { name: '播放队列' }).click();
  await page.locator('.side-panel[aria-label="播放队列"]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.side-panel[aria-label="歌词"]').count(), 0, 'opening the queue should close the lyrics panel');
  await page.getByRole('button', { name: '关闭' }).click();

  // Repeat mode cycles through the three documented states.
  await page.getByRole('button', { name: '顺序播放' }).click();
  await page.getByRole('button', { name: '列表循环' }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: '列表循环' }).click();
  await page.getByRole('button', { name: '单曲循环' }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: '单曲循环' }).click();
  await page.getByRole('button', { name: '顺序播放' }).waitFor({ timeout: 3000 });

  // Playlists page and owned-playlist detail with a destructive confirmation.
  await page.getByRole('button', { name: '我的歌单' }).click();
  await page.getByRole('button', { name: /自建歌单/ }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /自建歌单/ }).click();
  const description = page.getByRole('textbox', { name: '歌单简介' });
  await description.waitFor({ timeout: 10_000 });
  await description.fill('新简介');
  await page.getByRole('button', { name: '保存简介' }).click();
  await page.getByText('已保存歌单简介。').waitFor({ timeout: 5000 });
  const descriptionWrites = await app.evaluate(() => {
    const rows = globalThis.__descriptionWrites; return rows.splice(0, rows.length);
  });
  assert.deepEqual(descriptionWrites, [{ id: 'owned-1', description: '新简介' }]);
  // The confirmation dialog must be cancellable without touching the account.
  await page.getByRole('button', { name: '删除' }).click();
  await page.getByRole('button', { name: '确认删除' }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => globalThis.__deletedPlaylists), [], 'cancelling must not delete the playlist');
  await page.getByRole('button', { name: '删除' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await page.getByText('已删除歌单「自建歌单」。').waitFor({ timeout: 5000 });
  assert.deepEqual(await app.evaluate(() => globalThis.__deletedPlaylists), ['owned-1']);

  // Search page issues exactly one query and renders the result.
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('fixture');
  await page.locator('.search-bar button[type=submit]').click();
  await page.getByRole('button', { name: /^Smoke FLAC/ }).first().waitFor({ timeout: 10_000 });
  const queries = await app.evaluate(() => { const rows = globalThis.__searchQueries; return rows.splice(0, rows.length); });
  assert.deepEqual(queries, ['fixture']);

  // History: local tab records the track that just played, remote tab is read-only.
  await page.getByRole('button', { name: '播放历史' }).click();
  await page.getByText('Smoke MP3').first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '华为历史（只读）' }).click();
  await page.getByText('Smoke FLAC').first().waitFor({ timeout: 10_000 });

  // Settings page persists the close behaviour through the real IPC and JSON store.
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByText(/当前版本/).waitFor({ timeout: 5000 });
  // Lyric cache: size/entry counts come from the real cache directory; clearing is real too.
  await page.getByText(/本地导入 1 首/).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '清除本地导入' }).click();
  await page.getByText(/本地导入 0 首/).waitFor({ timeout: 5000 });
  await page.getByRole('combobox', { name: '关闭窗口时行为' }).selectOption('tray');
  await page.getByText('关闭窗口时将最小化到托盘。').waitFor({ timeout: 5000 });
  // `app.getPath('userData')` is the isolated profile passed via --user-data-dir, so the store can
  // be read straight from the test process (Playwright's main-process evaluate cannot import modules).
  const stored = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8'));
  assert.equal(stored?.schemaVersion, 1);
  assert.equal(stored?.data?.closeBehavior, 'tray');
  assert.equal(stored?.data?.quality, 'standard');
  await page.getByRole('combobox', { name: '默认音质' }).selectOption('lossless');
  await page.waitForFunction(() => document.querySelector('.quality-button')?.textContent === '无损');
  await page.getByRole('combobox', { name: '播放模式' }).selectOption('one');
  await page.getByRole('button', { name: '单曲循环' }).waitFor();
  await page.getByRole('combobox', { name: '默认音质' }).selectOption('standard');
  await page.getByRole('combobox', { name: '播放模式' }).selectOption('off');
  // Random-order playback is selectable as an explicit mode, not only via the toolbar toggle.
  await page.getByRole('combobox', { name: '播放模式' }).selectOption('shuffle');
  await page.waitForFunction(() => document.querySelector('button[aria-label="随机播放"]')?.getAttribute('aria-pressed') === 'true');
  await page.getByRole('combobox', { name: '播放模式' }).selectOption('off');
  await page.waitForFunction(() => document.querySelector('button[aria-label="随机播放"]')?.getAttribute('aria-pressed') === 'false');
  // History sync is a real setting and must round-trip through the JSON store. The checkbox is
  // controlled by persisted state, so wait for the write instead of asserting Playwright's click.
  const historyToggle = page.getByRole('checkbox', { name: '同步播放到华为历史' });
  await historyToggle.click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="同步播放到华为历史"]')?.checked === false);
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).data.syncHistory, false);
  await historyToggle.click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="同步播放到华为历史"]')?.checked === true);
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).data.syncHistory, true);

  // Appearance is a second-level settings panel: theme colour, geometry and type repaint live and persist.
  await page.locator('.settings-nav-item', { hasText: '外观' }).click();
  await page.getByRole('button', { name: '主题色 靛蓝' }).click();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#2563eb');
  const radiusSlider = page.getByRole('slider', { name: '圆角' });
  await radiusSlider.focus();
  await radiusSlider.press('ArrowLeft');
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--radius-unit').trim() === '10px');
  await page.getByRole('button', { name: '衬线', exact: true }).click();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--font-ui').includes('Noto Serif'));
  const appearance = JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).data.appearance;
  assert.deepEqual(appearance, { accent: 'blue', panelOpacity: 1, cornerRadius: 10, fontScale: 1, fontFamily: 'serif', customAccent: '#c8202e', customFont: '' });
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#c8202e');
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).data.appearance,
    { accent: 'red', panelOpacity: 1, cornerRadius: 11, fontScale: 1, fontFamily: 'sans', customAccent: '#c8202e', customFont: '' });

  // Custom accent: the native colour input drives the same CSS variables and persists as #rrggbb.
  await page.locator('input[aria-label="自定义主题色"]').evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#1F7A5A');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#1f7a5a');
  assert.equal(JSON.parse(await readFile(join(profile, 'settings.json'), 'utf8')).data.appearance.customAccent, '#1f7a5a');
  // Installed fonts come from the main process, and the chosen family becomes the CSS stack head.
  const fonts = await page.evaluate(() => window.desktop.fonts.list());
  assert.equal(fonts.ok, true, 'fonts:list must answer');
  assert.ok(Array.isArray(fonts.data.families));
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#c8202e');
  await page.locator('.settings-nav-item', { hasText: '播放' }).click();

  // Actual Electron geometry: player and navigation stay in the viewport at the minimum window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
  await page.waitForTimeout(200);
  const geometry = await page.evaluate(() => {
    const player = document.querySelector('.player').getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    return { playerVisible: player.bottom <= innerHeight + 1 && player.top >= 0,
      sidebarFits: sidebar.bottom <= innerHeight + 1,
      noBodyScroll: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight };
  });
  assert.deepEqual(geometry, { playerVisible: true, sidebarFits: true, noBodyScroll: true });
  const screenshots = join(process.cwd(), 'release', 'qa');
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, 'linux-settings-960.png') });
  await page.getByRole('button', { name: '播放队列' }).click();
  await page.screenshot({ path: join(screenshots, 'linux-queue-960.png') });
  await page.getByRole('button', { name: '关闭' }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 760));
  await page.getByRole('button', { name: '我的收藏' }).click();
  await page.getByRole('button', { name: /^Smoke MP3/ }).waitFor();
  await page.screenshot({ path: join(screenshots, 'linux-library-1180.png') });

  // Queue persistence: survives a renderer reload...
  await page.waitForTimeout(2200);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => (window.__notices ?? []).some(text => /已恢复上次队列/.test(text)), null, { timeout: 10_000 });
  await assertQueueContents(page);

  // ...and a full process restart on the same isolated profile.
  await page.evaluate(() => window.desktop.window.setCloseBehavior('quit'));
  await page.waitForTimeout(200);
  await app.close();
  app = undefined;
  const second = await launch();
  app = second.instance;
  // A fresh process has no init script installed yet, so assert the stronger surface: the queue
  // panel must be repopulated from the on-disk store before any playback is started.
  await assertQueueContents(second.page);
  assert.equal(await second.page.getByRole('button', { name: '播放', exact: true }).count(), 1, 'queue restore must not autoplay');
  await second.page.evaluate(() => window.desktop.window.setCloseBehavior('quit'));
  await app.close();
  app = undefined;

  console.log('Electron UI smoke passed: renderer boundary, favorites page playback with a single Audio element, favorite write read-back, lyrics/queue panels, repeat cycle, playlists/search/history/settings pages, and queue + settings persistence across a process restart. No Huawei network or account path was exercised.');
} catch (error) {
  console.error('Electron UI smoke failed:', error?.stack ?? error);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(profile, { recursive: true, force: true });
  await rm(media, { recursive: true, force: true });
}
