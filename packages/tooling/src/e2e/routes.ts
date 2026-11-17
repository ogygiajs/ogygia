/**
 * Route handlers for specs that read or rewrite what the network answers (`page.route` with
 * `route.fetch()`).
 *
 * @packageDocumentation
 */
import type { Request, Route } from '@playwright/test';
import { ROUTE_GONE_RE } from './re.ts';

/**
 * A `page.route` handler that ends quietly when its request is gone: the test ended and its page
 * closed while the handler was still on its way (fetching, reading the body, answering). There is
 * nothing left to answer, so that is not a failure. Any other error still fails the test.
 *
 * Playwright disposes a `route.fetch()` response when its context closes, and a handler still
 * reading it then throws `Response has been disposed`, which fails a test whose own checks all
 * passed.
 */
export function while_open(
	handler: (route: Route, request: Request) => Promise<unknown>
): (route: Route, request: Request) => Promise<void> {
	return async (route, request) => {
		try {
			await handler(route, request);
		} catch (e) {
			if (!(e instanceof Error) || !ROUTE_GONE_RE.test(e.message)) throw e;
		}
	};
}
