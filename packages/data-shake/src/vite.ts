import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import { page_reads } from './index.ts';

/**
 * Data shaking, listed beside `ogygia()` (`plugins: [ogygia(), dataShake(), sveltekit()]`): a page
 * ships only the data its regions' code reads. Its first job is the page seed.
 *
 * An island that reads `page.data` through `$app/state` / `$app/stores` gets the page seed. Without
 * this plugin that seed is all of `page.data`, and every server hole looks it up. With it, the build
 * reads each module once for the top-level `page.data` keys it can reach; the page ships only the
 * keys its islands read, and a hole whose tree reads none skips the lookup. Any read the analysis
 * cannot pin answers `'unknown'`, and that region gets all of `page.data` as before.
 */
export function dataShake(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/data-shake',
		build(b) {
			b.pageReads(page_reads());
		}
	});
}
