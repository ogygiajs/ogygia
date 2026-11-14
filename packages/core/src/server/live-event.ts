import type { RequestEvent } from '@sveltejs/kit';
import { get_request_event } from 'ogygia:server';

/** The request being served, through Kit's public `getRequestEvent()` (`$app/server`), or null
 *  outside one: Kit throws there, and every reader here answers "no request" instead. */
export function live_event(): RequestEvent | null {
	try {
		return get_request_event() as RequestEvent;
		// oxlint-disable-next-line ogygia/no-silent-failures -- Kit throws outside a request, and outside a request there is no event to read
	} catch {
		return null;
	}
}
