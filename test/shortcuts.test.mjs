import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, describeAccelerator, isValidAccelerator, sanitizeShortcuts, shortcutCommands,
} from '../src/shared/shortcuts.mjs';

test('accelerators need a main key and one non-shift modifier', () => {
  assert.equal(isValidAccelerator('Control+Alt+P'), true);
  assert.equal(isValidAccelerator('Control+Alt+Left'), true);
  assert.equal(isValidAccelerator('Shift+A'), false, 'Shift alone is not a global binding');
  assert.equal(isValidAccelerator('A'), false, 'bare keys would hijack typing');
  assert.equal(isValidAccelerator(''), false);
  assert.equal(isValidAccelerator('Control+Alt+'), false);
  assert.equal(isValidAccelerator('Control+Alt+Pause'), false, 'unknown main key');
  assert.equal(isValidAccelerator('Nonsense+P'), false, 'unknown modifier');
  assert.equal(isValidAccelerator('Control+Control+P'), true, 'repeated modifier is odd but well formed');
});

test('sanitize keeps known actions, drops junk and resolves duplicates', () => {
  assert.deepEqual(sanitizeShortcuts(null), { ...DEFAULT_SHORTCUTS });
  const cleaned = sanitizeShortcuts({
    'play-pause': 'Control+Alt+9', next: 'garbage', previous: '', mute: 'Alt+F4',
    bogus: 'Control+Alt+B', like: 42,
  });
  assert.equal(cleaned['play-pause'], 'Control+Alt+9');
  assert.equal(cleaned.next, 'Control+Alt+Right', 'invalid input falls back to default');
  assert.equal(cleaned.previous, '', 'empty string explicitly disables');
  assert.equal(cleaned.mute, 'Alt+F4');
  assert.equal(cleaned.like, 'Control+Alt+L', 'non-string input falls back to default');
  assert.equal('bogus' in cleaned, false, 'unknown actions never enter the map');
});

test('one accelerator drives at most one action', () => {
  const cleaned = sanitizeShortcuts({ next: DEFAULT_SHORTCUTS['play-pause'] });
  assert.equal(cleaned.next, DEFAULT_SHORTCUTS['play-pause'], 'the input action keeps the binding');
  assert.equal(cleaned['play-pause'], '', 'a fallback that would collide stays disabled');
  // A settings UI patch that frees the old owner first is respected end to end.
  const moved = sanitizeShortcuts({ 'play-pause': '', next: DEFAULT_SHORTCUTS['play-pause'] });
  assert.equal(moved['play-pause'], '');
  assert.equal(moved.next, DEFAULT_SHORTCUTS['play-pause']);
});

test('shortcut commands list only valid non-empty bindings', () => {
  const commands = shortcutCommands(sanitizeShortcuts({ mute: '', next: 'not a key' }));
  const accelerators = commands.map(([accelerator]) => accelerator);
  assert.equal(accelerators.includes(''), false);
  assert.equal(accelerators.includes('Control+Alt+M'), false, 'disabled action skipped');
  // mute is disabled; the invalid next input falls back to its default binding.
  assert.equal(commands.length, SHORTCUT_ACTIONS.length - 1);
  for (const [, command] of commands) assert.ok(SHORTCUT_ACTIONS.includes(command));
});

test('describeAccelerator renders readable labels', () => {
  assert.equal(describeAccelerator('Control+Alt+Left'), 'Ctrl + Alt + ←');
  assert.equal(describeAccelerator('Control+Alt+P'), 'Ctrl + Alt + P');
  assert.equal(describeAccelerator(''), '未设置');
});
