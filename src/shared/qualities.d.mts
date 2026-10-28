import type { Quality } from './types';

export const QUALITY_ORDER: Quality[];
export const QUALITY_CODES: Record<Quality, string>;
export const QUALITY_LABELS: Record<Quality, string>;
export function qualityCodeOf(quality: Quality): string | null;
export function qualityFromCode(code: unknown): Quality | null;
export function fallbackQuality(requested: Quality, available: Quality[]): Quality | null;
