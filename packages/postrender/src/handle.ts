import type { Handle } from '@ogygia/core/plugin';
import type { PostrenderHandleOptions } from './types.ts';
import { install, mark_handled } from './registry.ts';
import { postrender_app } from './app.ts';
import { warn } from './messages.ts';
import { say } from '@ogygia/machine';

const unlisted = say({ max: 1 });

/**
 * The live half of postrender, a Kit handle that goes BEFORE ogygia's:
 *
 * ```ts
 * export const handle = sequence(
 * 	postrender.handle({ store: new ValkeyStore(client), edge: [new CloudflareEdge({ … })] }),
 * 	ogygia.handle()
 * );
 * ```
 *
 * Made once, when hooks.server.ts evaluates: its settings become this server's runtime, the one
 * `postrender.invalidate()` reaches. Per request it hands the request those settings, so ogygia's
 * handle serves the stored page before anything renders. Placed after ogygia's (or outside the
 * sequence), that is an error in dev and one warning in production; with no `postrender()` in
 * vite.config, nothing is ever stored, and it warns once.
 */
export function handle(options: PostrenderHandleOptions = {}): Handle {
	const runtime = install(options);
	return ({ event, resolve }) => {
		mark_handled(event, runtime);
		if (!postrender_app())
			unlisted.once('postrender_handle_unlisted', () => warn('postrender_handle_unlisted'));
		return resolve(event);
	};
}
