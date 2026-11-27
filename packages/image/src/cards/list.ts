/**
 * The endpoint's list of cards, in a built server: each card's chunk by its name, written into the
 * bundle by the build (../vite/card.ts).
 *
 * @packageDocumentation
 */
import type { CardModule } from './read.ts';

/** The card module named `name` in `list` (the build's list), or null: no such card. */
export function find_card(list: unknown, name: string): Promise<CardModule | null> {
	if (list === null || typeof list !== 'object' || !Object.hasOwn(list, name))
		return Promise.resolve(null);
	const load = (list as Record<string, unknown>)[name];
	return typeof load === 'function' ? (load as () => Promise<CardModule>)() : Promise.resolve(null);
}
