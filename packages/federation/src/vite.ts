import type { Plugin as VitePlugin } from 'vite';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

/**
 * `federation()`: fragment federation, listed beside `ogygia()` in vite.config `plugins`.
 * Its server realm serves the federation protocol from the handle; `federate({ … })` in
 * hooks.server.ts declares the app's identity and peers. This app's island entries keep their
 * foreign-hydrate exports, so a peer's page can host and wake them.
 */
export function federation(): [OgygiaPlugin, VitePlugin] {
	return [
		definePlugin({
			name: '@ogygia/federation',
			server: import.meta.resolve('./server.ts'),
			build(b) {
				b.foreignHydrate();
			}
		}),
		// @why Vite's server build leaves a dependency external unless told, and Node cannot import the `.svelte` files @ogygia/router ships (test: test/vite.test.ts › inlines @ogygia/router in the server build, as it ships .svelte files, even when the app does not list router())
		{ name: 'ogygia:federation', config: () => ({ ssr: { noExternal: ['@ogygia/router'] } }) }
	];
}
