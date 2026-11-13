import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

/** The rewrite plugin, listed beside `ogygia()` in vite.config `plugins`. No options: it turns on
 *  what a `rewrite()` handle needs (its server realm runs the rewrites, its browser realm puts back
 *  what they moved). */
export function rewrite(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/rewrite',
		server: import.meta.resolve('./server.ts'),
		client: import.meta.resolve('./client.ts')
	});
}
