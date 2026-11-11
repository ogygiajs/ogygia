// A file's first highlight pays Shiki's cold start (its import, the regex engine, the grammars and
// themes): about 0.4 s here, past 5 s on a loaded CI runner, inside one test's limit. Warming the
// highlighter a file uses before its tests leaves each test timing only its own work.
import { beforeAll } from 'vitest';
import { highlight, type MarkdownShikiOptions } from '../src/markdown/shiki.ts';

/** Before this file's tests: the highlighter `options` make, loaded (a long limit: it is the cold
 *  start, not a test). */
export function warm_shiki(options: MarkdownShikiOptions = {}, lang = 'typescript'): void {
	beforeAll(async () => {
		await highlight('', lang, options);
	}, 120_000);
}
