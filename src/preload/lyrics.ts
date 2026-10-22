import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopLyricsAppearance, DesktopLyricsUpdate } from '../shared/types';

// Channel names are inlined on purpose: a sandboxed preload cannot require sibling chunks,
// so this entry must stay free of shared imports (keep names in sync with shared/channels.ts).
const RENDER_CHANNEL = 'desktop-lyrics:render';
const STATE_CHANNEL = 'desktop-lyrics:state';
const SET_LOCKED_CHANNEL = 'desktop-lyrics:set-locked';
const REQUEST_CLOSE_CHANNEL = 'desktop-lyrics:request-close';

// Minimal bridge for the lyrics overlay: subscribe to sanitized render payloads and request
// lock/close. No auth, no music, no settings surface is reachable from this window.
const api = {
  onUpdate: (listener: (payload: DesktopLyricsUpdate) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: DesktopLyricsUpdate) => listener(payload);
    ipcRenderer.on(RENDER_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(RENDER_CHANNEL, wrapped);
  },
  onState: (listener: (state: DesktopLyricsAppearance) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DesktopLyricsAppearance) => listener(state);
    ipcRenderer.on(STATE_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(STATE_CHANNEL, wrapped);
  },
  setLocked: (locked: boolean) => { ipcRenderer.send(SET_LOCKED_CHANNEL, locked); },
  requestClose: () => { ipcRenderer.send(REQUEST_CLOSE_CHANNEL); },
};

contextBridge.exposeInMainWorld('desktopLyricsWindow', api);
