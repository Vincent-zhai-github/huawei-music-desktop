// Floating always-on-top desktop lyrics window. Security mirrors the main window: sandboxed,
// context-isolated, no node integration, its own minimal preload with only the lyrics bridge.
// The window itself carries no credentials and renders only sanitized text payloads.
import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { channels } from '../shared/channels';
import { sanitizeDesktopLyricsUpdate } from './desktop-lyrics-payload.mjs';
import { updateSettings } from './storage';
import type { AppSettings, DesktopLyricsAppearance, DesktopLyricsSettings, DesktopLyricsUpdate } from '../shared/types';

const WINDOW_SIZE = { width: 760, height: 128 };

export type DesktopLyricsModule = {
  applySettings(settings: AppSettings): void;
  forwardUpdate(payload: unknown): void;
  destroy(): void;
};

function appearanceOf(settings: DesktopLyricsSettings): DesktopLyricsAppearance {
  return { locked: settings.locked, fontColor: settings.fontColor, backgroundOpacity: settings.backgroundOpacity };
}

export function createDesktopLyricsModule(): DesktopLyricsModule {
  let lyricsWindow: BrowserWindow | null = null;
  let latest: DesktopLyricsSettings = { enabled: false, locked: false, position: null, fontColor: '#ffffff', backgroundOpacity: 0.55 };
  let pendingPayload: DesktopLyricsUpdate | null = null;
  let moveSaveTimer: NodeJS.Timeout | undefined;

  function isLyricsSender(event: Electron.IpcMainEvent): boolean {
    return !!lyricsWindow && !lyricsWindow.isDestroyed() && event.sender === lyricsWindow.webContents;
  }

  // Settings written from inside this module (lock/close/move) do not pass the IPC hooks,
  // so the apply step runs right after the write to keep the window in sync.
  function writeSettings(patch: Partial<DesktopLyricsSettings>): void {
    void updateSettings({ desktopLyrics: { ...latest, ...patch } }).then(next => apply(next.desktopLyrics));
  }

  function apply(settings: DesktopLyricsSettings): void {
    latest = settings;
    if (!settings.enabled) {
      if (lyricsWindow && !lyricsWindow.isDestroyed()) { clearTimeout(moveSaveTimer); lyricsWindow.destroy(); }
      lyricsWindow = null;
      return;
    }
    if (!lyricsWindow || lyricsWindow.isDestroyed()) { createWindow(settings); return; }
    lyricsWindow.setIgnoreMouseEvents(settings.locked, { forward: true });
    if (settings.locked && lyricsWindow.isFocused()) lyricsWindow.blur();
    try { lyricsWindow.webContents.send(channels.desktopLyricsState, appearanceOf(settings)); } catch { /* Window closing. */ }
  }

  function createWindow(settings: DesktopLyricsSettings): void {
    const primary = screen.getPrimaryDisplay().workArea;
    const x = settings.position ? settings.position.x : Math.round(primary.x + (primary.width - WINDOW_SIZE.width) / 2);
    const y = settings.position ? settings.position.y : Math.round(primary.y + primary.height - WINDOW_SIZE.height - 72);
    lyricsWindow = new BrowserWindow({
      ...WINDOW_SIZE,
      x, y,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: !settings.locked,
      show: false,
      title: '桌面歌词',
      webPreferences: {
        preload: join(__dirname, '../preload/lyrics.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      },
    });
    lyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    lyricsWindow.setIgnoreMouseEvents(settings.locked, { forward: true });
    lyricsWindow.once('closed', () => { lyricsWindow = null; });
    // Dragging uses -webkit-app-region; persist the resting spot (debounced) in settings.
    lyricsWindow.on('moved', () => {
      if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
      const window = lyricsWindow;
      clearTimeout(moveSaveTimer);
      moveSaveTimer = setTimeout(() => {
        if (!window || window.isDestroyed()) return;
        const [px, py] = window.getPosition();
        writeSettings({ position: { x: px, y: py } });
      }, 800);
    });
    void lyricsWindow.loadFile(join(__dirname, '../renderer/lyrics.html')).then(() => {
      if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
      lyricsWindow.showInactive();
      lyricsWindow.webContents.send(channels.desktopLyricsState, appearanceOf(settings));
      if (pendingPayload) {
        lyricsWindow.webContents.send(channels.desktopLyricsRender, pendingPayload);
        pendingPayload = null;
      }
    }).catch(() => { if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.close(); });
  }

  // Module-level one-way listeners: idempotent registration so a second module instance
  // (or repeated init) can never stack duplicate handlers.
  for (const channel of [channels.desktopLyricsSetLocked, channels.desktopLyricsRequestClose, channels.desktopLyricsSavePosition]) {
    ipcMain.removeAllListeners(channel);
  }
  ipcMain.on(channels.desktopLyricsSetLocked, (event, locked: unknown) => {
    if (!isLyricsSender(event) || typeof locked !== 'boolean') return;
    writeSettings({ locked });
  });
  ipcMain.on(channels.desktopLyricsRequestClose, event => {
    if (!isLyricsSender(event)) return;
    writeSettings({ enabled: false });
  });
  ipcMain.on(channels.desktopLyricsSavePosition, (event, position: unknown) => {
    if (!isLyricsSender(event)) return;
    const value = position as { x?: unknown; y?: unknown };
    if (!Number.isInteger(value?.x) || !Number.isInteger(value?.y)) return;
    writeSettings({ position: { x: value.x as number, y: value.y as number } });
  });

  return {
    applySettings(settings: AppSettings): void { apply(settings.desktopLyrics); },
    forwardUpdate(payload: unknown): void {
      const sanitized = sanitizeDesktopLyricsUpdate(payload);
      if (!sanitized) return;
      if (lyricsWindow && !lyricsWindow.isDestroyed()) {
        try { lyricsWindow.webContents.send(channels.desktopLyricsRender, sanitized); } catch { /* Window closing. */ }
      } else pendingPayload = sanitized;
    },
    destroy(): void {
      clearTimeout(moveSaveTimer);
      if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.destroy();
      lyricsWindow = null;
    },
  };
}
