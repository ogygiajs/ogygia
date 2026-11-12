/**
 * `flags()` — the flags plugin, listed beside `ogygia()` in vite.config `plugins`. Turns on the
 * per-request source priming and exposure flushing (its server realm); `flag()` itself works without
 * it (native, sticky decisions), but a `decide({ source, exposure })` needs it.
 */
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

export function flags(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/flags',
		server: import.meta.resolve('./server.ts'),
		// each flag() call is owned by the run of the module that makes it (dev: core marks it), so a
		// flag deleted from the code leaves when its module reloads
		build(b) {
			b.definers('@ogygia/flags', ['flag']);
		}
	});
}
