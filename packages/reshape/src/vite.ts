/**
 * `reshape()` — the reshape plugin, listed beside `ogygia()` in vite.config `plugins`. Turns on the
 * support for the app's own pass over the HTML ogygia sends (`reshape.handle(transform)`): its
 * server realm runs the pass, its browser realm puts back what the pass moved.
 */
import { definePlugin, type OgygiaPlugin } from '@ogygia/core/vite';

export function reshape(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/reshape',
		server: import.meta.resolve('./server.ts'),
		client: import.meta.resolve('./client.ts')
	});
}
