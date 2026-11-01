/**
 * `postrender.handle({ store, edge })` — the live half of postrender, a SvelteKit `Handle` the app
 * composes with Kit's `sequence()`, BEFORE ogygia's:
 *
 *   export const handle = sequence(
 *     postrender.handle({ store: valkey(client), edge: [cloudflare({ … })] }),
 *     ogygia.handle()
 *   );
 *
 * Made once, when hooks.server.ts evaluates: its settings become this server's runtime (what
 * `postrender.invalidate()` reaches). Per request it marks the request as seen with those settings and
 * resolves. The server half, inside `ogygia.handle()`, serves the stored page from that runtime before
 * anything renders — and finds a request NOT marked when this handle sits after ogygia's (or outside
 * the sequence): a clear error in dev, one warning in production.
 */
import type { Handle } from '@sveltejs/kit';
import type { PostrenderHandleOptions } from './types.ts';
import { install, mark_handled } from './registry.ts';
import { postrender_app } from './app.ts';

let warned_unlisted = false;

export function handle(options: PostrenderHandleOptions = {}): Handle {
	const runtime = install(options);
	return ({ event, resolve }) => {
		mark_handled(event, runtime);
		// The plugin's server half starts when ogygia's hooks module loads, before any request: none
		// by now means vite.config never listed `postrender()`, and nothing would ever be stored.
		if (!postrender_app() && !warned_unlisted) {
			warned_unlisted = true;
			console.warn(
				'[@ogygia/postrender] postrender.handle() runs, but `postrender()` is not listed in ' +
					'vite.config, so no page is stored. Add it: `plugins: [ogygia(), postrender(), sveltekit()]` ' +
					"(from '@ogygia/postrender/vite')."
			);
		}
		return resolve(event);
	};
}
