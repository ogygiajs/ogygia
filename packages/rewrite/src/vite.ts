/**
 * `rewrite()`: the rewrite plugin, listed beside `ogygia()` in vite.config `plugins`. No options. It
 * turns on what a `rewrite()` handle needs: its server realm runs the rewrites, its browser realm
 * puts back what they moved.
 */
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

export function rewrite(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/rewrite',
		server: import.meta.resolve('./server.ts'),
		client: import.meta.resolve('./client.ts')
	});
}
