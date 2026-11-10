/**
 * The head's early start (./early-holes.ts), as tags: written by the handle and `document()`, and
 * read by the tests that run it. Kept apart from ./early-holes.ts so the runtime, which only reads
 * the global, never loads `script()`.
 */
import { EARLY_HOLES_ID, EARLY_HOLES_KEY, start_early_holes } from './early-holes.ts';
import { script } from './script.ts';

/** The early start's script tag, the same bytes on every page (its CSP hash is computed from it). */
export const EARLY_HOLES_TAG: string = script(start_early_holes, EARLY_HOLES_ID, EARLY_HOLES_KEY);

/** The head's early start for `endpoints` (the request's `load` holes, each once): the data block,
 *  then the script that reads it. Nothing for none. */
export function early_holes_head(endpoints: readonly string[]): string {
	if (endpoints.length === 0) return '';
	return script({ json: [...endpoints], id: EARLY_HOLES_ID }) + EARLY_HOLES_TAG;
}
