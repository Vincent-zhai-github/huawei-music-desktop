// Desktop lyrics overlay: plain DOM (no React) so the floating window stays tiny. Locked mode
// is click-through; unlocked shows the control bar for locking/closing and dragging.
import type { DesktopLyricsAppearance, DesktopLyricsUpdate } from '../shared/types';

declare global {
  interface Window {
    desktopLyricsWindow: {
      onUpdate(listener: (payload: DesktopLyricsUpdate) => void): () => void;
      onState(listener: (state: DesktopLyricsAppearance) => void): () => void;
      setLocked(locked: boolean): void;
      requestClose(): void;
    };
  }
}

const root = document.getElementById('lyrics')!;
const trackLabel = document.getElementById('lyrics-track')!;
const currentLine = document.getElementById('lyrics-current')!;
const nextLine = document.getElementById('lyrics-next')!;
const lockButton = document.getElementById('lyrics-lock')!;
const closeButton = document.getElementById('lyrics-close')!;
let locked = true;

function setLockedClass(next: boolean): void {
  locked = next;
  root.classList.toggle('locked', next);
  lockButton.textContent = next ? '🔒' : '🔓';
  lockButton.title = next ? '已锁定：鼠标穿透下面的窗口' : '解锁：可拖动';
}

lockButton.addEventListener('click', () => {
  // Compute the next value once: setLockedClass already flips the module flag, so reading
  // !locked again afterwards would send the old value back and cancel the toggle.
  const next = !locked;
  setLockedClass(next);
  window.desktopLyricsWindow.setLocked(next);
});
closeButton.addEventListener('click', () => { window.desktopLyricsWindow.requestClose(); });

window.desktopLyricsWindow.onUpdate(payload => {
  const label = [payload.title, payload.artist].filter(Boolean).join(' · ');
  trackLabel.textContent = label || '桌面歌词';
  if (!payload.current && !payload.next) {
    currentLine.textContent = payload.synced ? '♪' : (payload.title ? `${payload.title}（纯文本歌词）` : '暂无歌词');
    currentLine.classList.add('empty');
    nextLine.textContent = '';
    return;
  }
  currentLine.classList.remove('empty');
  if (payload.current) {
    currentLine.textContent = payload.current.text || '♪';
    nextLine.textContent = payload.current.translation
      ? `${payload.current.translation}${payload.next?.text ? ' · ' + payload.next.text : ''}`
      : (payload.next?.text ?? '');
  } else {
    // Between tracks or before the first line: show what is coming.
    currentLine.textContent = payload.next?.text || '♪';
    nextLine.textContent = payload.next?.translation ?? '';
  }
});

window.desktopLyricsWindow.onState(state => {
  setLockedClass(state.locked);
  // User-chosen text colour and capsule opacity, applied as CSS variables so the stylesheet
  // stays the single source of layout while settings only drive the two tunable values.
  document.documentElement.style.setProperty('--lyrics-font-color', state.fontColor);
  document.documentElement.style.setProperty('--lyrics-bg-opacity', String(state.backgroundOpacity));
});

// Start as locked-looking; the main process pushes the real state right after load.
setLockedClass(true);
