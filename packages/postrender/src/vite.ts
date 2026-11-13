import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import type { PostrenderServerOptions } from './server.ts';

export interface PostrenderOptions {
	/** TTL backstop in seconds (default 86400, clamped to [1, 86400]): nothing is stale forever. */
	ttl?: number;
	/** The app-wide opt-in (default true). */
	default?: boolean;
}

/**
 * `postrender()`: pages stored at request time, listed beside `ogygia()` in vite.config. The
 * switch and serializable policy, nothing else: a page whose render observed no personalization is
 * stored whole on its first request and served as bytes until `postrender.invalidate(url)` /
 * `postrender.invalidateWhere({ prefix })` or the TTL backstop. Live adapters (a store client, CDN
 * purge credentials) are the argument of `postrender.handle({ store, edge })` in hooks.server.ts.
 *
 * `default` sets the app-wide opt-in: `true` (the default) stores every eligible page, and a route
 * opts out in Kit's own config (`export const config = { postrender: false }`). `false` makes the
 * app opt-in: nothing is stored unless a page or a layout above it sets
 * `config = { postrender: true }`. `config` merges from the layouts into the page, the page's own
 * key winning, as Kit merges it.
 *
 * Needs `dataShake()` from `@ogygia/data-shake/vite` listed beside it: a deferred region whose code reads
 * no `page.data` then skips the page look-up, which would render the stored page again.
 */
export function postrender(options: PostrenderOptions = {}): OgygiaPlugin<PostrenderServerOptions> {
	return definePlugin<PostrenderServerOptions>({
		name: '@ogygia/postrender',
		server: import.meta.resolve('./server.ts'),
		options: {
			ttl: Math.min(86400, Math.max(1, Math.floor(options.ttl ?? 86400))),
			default: options.default ?? true
		},
		needs: [{ name: '@ogygia/data-shake', call: 'dataShake()', from: '@ogygia/data-shake/vite' }],
		build(b) {
			b.routeConfig('postrender');
		}
	});
}
