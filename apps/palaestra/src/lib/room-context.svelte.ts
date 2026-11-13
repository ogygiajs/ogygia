import { getContext } from 'svelte';
import type { SharedCounter } from './counter-object.svelte.ts';

/**
 * Cross-island context matrix, string-keyed so a plain `getContext('room')` reads the same value.
 * `room` carries a live transportable (`SharedCounter`) shared across islands; `theme` carries a
 * plain string (snapshot) and reads as 'light' when nothing provides it; `orphan` is never provided
 * anywhere, so every reader falls back to its default.
 */
export const readRoom = (): SharedCounter | undefined => getContext<SharedCounter>('room');
export const readTheme = (): string => getContext<string | undefined>('theme') ?? 'light';
export const readOrphan = (): string =>
	getContext<string | undefined>('orphan') ?? 'orphan-default';
