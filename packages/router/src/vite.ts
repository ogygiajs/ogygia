import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The server router's plugin, listed beside `ogygia()` in vite.config. A `routes()` table renders
 * pages outside Kit's routes, so nothing file-derived links their components' CSS: this tells the
 * build that every module importing `@ogygia/router` is a page module, and every component it can
 * reach gets its whole-tree CSS linked when it renders.
 */
export function router(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/router',
		build(b) {
			b.pageModules({ importers: ['@ogygia/router'] });
			b.files({ root: path.dirname(LIB_DIR), files: [path.join(LIB_DIR, 'LayoutChain.svelte')] });
		}
	});
}
