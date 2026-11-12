import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

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
		}
	});
}
