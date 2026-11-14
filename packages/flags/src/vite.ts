/**
 * `flags()` — the flags plugin, listed beside `ogygia()` in vite.config `plugins`. Turns on the
 * per-request source priming and exposure flushing (its server realm); `flag()` itself works without
 * it (native, sticky decisions), but a `decide({ source, exposure })` needs it. A `vite build` with
 * it writes the flag inventory to `node_modules/.ogygia/flags-manifest.json` (./inventory.ts).
 */
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import { Inventory } from './prescan.ts';

export function flags(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/flags',
		server: import.meta.resolve('./server.ts'),
		build(b) {
			// each flag() call is owned by the run of the module that makes it (dev: core marks it), so
			// a flag deleted from the code leaves when its module reloads
			b.definers('@ogygia/flags', ['flag']);
			b.prescan(new Inventory(b.root));
		}
	});
}
