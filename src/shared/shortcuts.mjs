// Pure shortcut logic shared by settings sanitation and the settings UI.
// An accelerator is an Electron combo string like 'Control+Alt+Left'; '' disables the binding.
export const SHORTCUT_ACTIONS = ['play-pause', 'next', 'previous', 'volume-up', 'volume-down', 'mute', 'like'];

export const SHORTCUT_ACTION_LABELS = {
  'play-pause': '播放 / 暂停',
  next: '下一首',
  previous: '上一首',
  'volume-up': '增大音量',
  'volume-down': '减小音量',
  mute: '静音 / 取消静音',
  like: '收藏当前歌曲',
};

// Default bindings follow the common Ctrl+Alt+ scheme used by desktop music players,
// so every global shortcut needs a real modifier and stays out of plain typing's way.
export const DEFAULT_SHORTCUTS = Object.freeze({
  'play-pause': 'Control+Alt+P',
  next: 'Control+Alt+Right',
  previous: 'Control+Alt+Left',
  'volume-up': 'Control+Alt+Up',
  'volume-down': 'Control+Alt+Down',
  mute: 'Control+Alt+M',
  like: 'Control+Alt+L',
});

// Modifier keys Electron accepts; Shift alone is deliberately not enough for a global binding.
const MODIFIERS = new Set(['Control', 'Ctrl', 'Command', 'Cmd', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta']);
const MAIN_KEYS = new Set([
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(i)),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Space', 'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Enter', 'Tab', 'Backspace', 'Plus', 'Minus',
]);

/** True when the string is a well-formed accelerator with at least one non-Shift modifier. */
export function isValidAccelerator(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator) return false;
  const tokens = accelerator.split('+').map(token => token.trim()).filter(token => !!token);
  if (tokens.length < 2) return false;
  const main = tokens[tokens.length - 1];
  if (!MAIN_KEYS.has(main)) return false;
  const modifiers = tokens.slice(0, -1);
  if (!modifiers.every(token => MODIFIERS.has(token))) return false;
  return modifiers.some(token => token !== 'Shift');
}

/**
 * Sanitizes a shortcuts map: known actions only, valid accelerators (or '' to disable),
 * and one accelerator may only drive one action — the first action keeps it.
 * @returns {import('../shared/types').ShortcutsSettings}
 */
export function sanitizeShortcuts(input, fallback = DEFAULT_SHORTCUTS) {
  const base = { ...DEFAULT_SHORTCUTS, ...(fallback ?? {}) };
  const source = (input && typeof input === 'object') ? input : {};
  const result = {};
  const taken = new Map();
  // Input wins for every action it mentions (including explicit disables); uncovered
  // actions fall back to the stored/defaults, and a fallback that would collide with an
  // input binding stays disabled instead of double-firing.
  for (const action of SHORTCUT_ACTIONS) {
    const raw = source[action];
    if (raw === '') { result[action] = ''; continue; }
    if (typeof raw === 'string' && isValidAccelerator(raw)) {
      if (!taken.has(raw)) { taken.set(raw, action); result[action] = raw; }
      else result[action] = ''; // duplicate inside one input: the first action keeps it
      continue;
    }
    result[action] = undefined; // not covered by this input: fall back
  }
  for (const action of SHORTCUT_ACTIONS) {
    if (result[action] !== undefined) continue;
    const raw = base[action];
    if (typeof raw === 'string' && isValidAccelerator(raw) && !taken.has(raw)) { taken.set(raw, action); result[action] = raw; }
    else result[action] = '';
  }
  return result;
}

/** Registered bindings as [accelerator, command] pairs, media keys excluded, disabled skipped. */
export function shortcutCommands(shortcuts) {
  const list = [];
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = shortcuts?.[action];
    if (typeof accelerator === 'string' && accelerator && isValidAccelerator(accelerator)) {
      list.push([accelerator, action]);
    }
  }
  return list;
}

/** Human-readable form for the settings list, e.g. 'Control+Alt+Left' → 'Ctrl+Alt+←'. */
export function describeAccelerator(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator) return '未设置';
  const pretty = {
    Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrControl: 'Ctrl', Command: 'Cmd', Cmd: 'Cmd',
    Alt: 'Alt', Option: 'Alt', AltGr: 'AltGr', Shift: 'Shift', Super: 'Win', Meta: 'Win',
    Left: '←', Right: '→', Up: '↑', Down: '↓', Space: '空格', Enter: 'Enter', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Plus: '+', Minus: '-',
  };
  return accelerator.split('+').map(token => pretty[token.trim()] ?? token.trim()).join(' + ');
}
