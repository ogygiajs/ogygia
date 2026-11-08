/**
 * A page made for ONE browser — its devtools events (hooks.ts), the profiler's beacon (profiler/), the
 * switch's Set-Cookie — must never reach a shared cache, whatever `cache-control` the app set: a CDN that
 * keeps HTML would hand that browser's page to every visitor. A response whose headers cannot be
 * changed (a fetched or redirect Response handed back as it is) is left as it is, and said.
 */
import { warn } from '../messages/server.ts';

export function mark_personal(response: Response): void {
	try {
		response.headers.set('cache-control', 'private, no-store');
		response.headers.append('vary', 'Cookie');
	} catch (error) {
		warn('personal_response_unmarked', { status: response.status }, error);
	}
}
