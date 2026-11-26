/**
 * THE ORIGINALS UNDER `src/`, BY TAIL: the asset URL the server imported for each, which Kit's
 * `read()` takes. Every reader of an original at the endpoint goes through it (a recipe's original,
 * a card's image), so a URL written with a query or a prefix (`?no-inline` in dev) reads the same
 * file.
 *
 * @packageDocumentation
 */
import config from 'virtual:ogygia-image/config';
import sources from 'virtual:ogygia-image/sources';
import { source_tail } from './recipe.ts';

/** The prefixes a source's URL can start with: `paths.assets`, then `paths.base`. */
export const SOURCE_PREFIXES: readonly string[] = [config.paths.assets, config.paths.base];

/** Each original under `src/` by its tail: the asset URL Kit's `read()` takes. */
export const SOURCE_URLS: ReadonlyMap<string, string> = new Map(
	Object.values(sources).map((url) => [source_tail(url, SOURCE_PREFIXES), url])
);
