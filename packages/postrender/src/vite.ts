/**
 * `postrender()` — pages stored at request time, listed beside `ogygia()` in vite.config. The
 * SWITCH + serializable policy, nothing else: a page whose render observed no personalization is
 * stored whole on its first request and served as bytes until `postrender.invalidate(url)` /
 * `postrender.invalidateWhere({ prefix })` or the TTL backstop. Live adapters (a valkey client, CDN
 * purge creds) are the argument of `postrender.handle({ store, edge })` in hooks.server.ts, from
 * `@ogygia/postrender`.
 *
 * `default` sets the app-wide opt-in: `true` (the default) keeps the auto behaviour — every eligible
 * page is stored, observed purity refuses the rest, and a route opts OUT in Kit's own config:
 * `export const config = { postrender: false }`. `false` flips the app to OPT-IN: nothing is stored
 * unless a page or a layout above it sets `config = { postrender: true }`. Kit merges `config` from
 * the layouts into the page (the page's own key wins), and so does the build that reads it.
 */
import { definePlugin, type OgygiaPlugin } from '@ogygia/core/vite';
import type { PostrenderServerOptions } from './server.ts';

export interface PostrenderOptions {
	/** TTL backstop in seconds (default 86400, clamped to [1, 86400]): nothing is stale forever. */
	ttl?: number;
	/** The app-wide opt-in (default true). */
	default?: boolean;
}

export function postrender(options: PostrenderOptions = {}): OgygiaPlugin<PostrenderServerOptions> {
	return definePlugin<PostrenderServerOptions>({
		name: '@ogygia/postrender',
		server: import.meta.resolve('./server.ts'),
		options: {
			ttl: Math.min(86400, Math.max(1, Math.floor(options.ttl ?? 86400))),
			default: options.default ?? true
		},
		build(b) {
			b.routeConfig('postrender');
		}
	});
}
