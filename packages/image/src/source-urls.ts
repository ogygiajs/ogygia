/**
 * THE URL KIT'S `read()` TAKES FOR AN ORIGINAL, BY TAIL. Every reader of an original at the
 * endpoint goes through it (a recipe's original, a card's image), so a URL written with a query or
 * a prefix (`?no-inline` in dev) reads the same file: the asset URL the server imported it under,
 * or, for one it did not list (dev), the tail under `paths.base`.
 *
 * @packageDocumentation
 */
import { dev } from '$app/environment';
import config from 'virtual:ogygia-image/config';
import sources from 'virtual:ogygia-image/sources';
import { encode_tail, source_tail } from './recipe.ts';

const { base: BASE, assets: ASSETS } = config.paths;

/** The prefixes a source's URL can start with: `paths.assets`, then `paths.base`. */
export const SOURCE_PREFIXES: readonly string[] = [ASSETS, BASE];

/** Each original under `src/` the server lists, by its tail: the asset URL it imported. */
export const SOURCE_URLS: ReadonlyMap<string, string> = new Map(
	Object.values(sources).map((url) => [source_tail(url, SOURCE_PREFIXES), url])
);

/** The URL Kit's `read()` takes for the original `tail` names. */
export function source_url(tail: string): string {
	return SOURCE_URLS.get(tail) ?? `${dev ? BASE : ASSETS || BASE}/${encode_tail(tail)}`;
}
