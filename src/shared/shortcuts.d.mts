import type { PlayerCommand, ShortcutsSettings } from './types';

export const SHORTCUT_ACTIONS: PlayerCommand[];
export const SHORTCUT_ACTION_LABELS: Record<PlayerCommand, string>;
export const DEFAULT_SHORTCUTS: Readonly<ShortcutsSettings>;
export function isValidAccelerator(accelerator: unknown): boolean;
export function sanitizeShortcuts(input: unknown, fallback?: ShortcutsSettings): ShortcutsSettings;
export function shortcutCommands(shortcuts: ShortcutsSettings | undefined): [string, PlayerCommand][];
export function describeAccelerator(accelerator: string): string;
