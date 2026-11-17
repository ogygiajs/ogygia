// A route handler still at work when its page closes (#2014). Specs that read what the network
// answers (`route.fetch()`, then the body) can still be reading when the test ends and Playwright
// closes the context. Playwright then throws at the handler, and that failed a test whose own
// checks had all passed (lazy-chunk-retry on WebKit). `while_open` (@ogygia/tooling/e2e) ends such
// a handler quietly; these tests pin what Playwright throws, so a new wording turns them red.
// Usage: pnpm exec playwright test route-gone
import type { Browser, Request, Route } from '@playwright/test';
import { expect, test, while_open } from '@ogygia/tooling/e2e';
import { ROUTE_GONE_RE } from '@ogygia/tooling/e2e/re.ts';

type Handler = (route: Route, request: Request) => Promise<unknown>;

/** Routes one document request through `wrap(handler)`, and closes its context once the handler
 *  has fetched the answer, before it reads the body. Returns how the handler ended. */
async function closed_mid_read(
	browser: Browser,
	baseURL: string,
	wrap: (handler: Handler) => Handler
): Promise<PromiseSettledResult<unknown>> {
	const context = await browser.newContext({ baseURL });
	const page = await context.newPage();
	const fetched = Promise.withResolvers<void>();
	const closed = Promise.withResolvers<void>();
	const ended = Promise.withResolvers<PromiseSettledResult<unknown>>();
	const handler = wrap(async (route) => {
		const response = await route.fetch();
		fetched.resolve();
		await closed.promise;
		return route.fulfill({ response, body: await response.text() });
	});
	await page.route('**/route-gone', (route, request) =>
		handler(route, request).then(
			(value) => ended.resolve({ status: 'fulfilled', value }),
			(reason: unknown) => ended.resolve({ status: 'rejected', reason })
		)
	);
	// oxlint-disable-next-line ogygia/no-silent-failures -- the navigation dies with the context this test closes
	page.goto('/route-gone').catch(() => {});
	await fetched.promise;
	await context.close();
	closed.resolve();
	return ended.promise;
}

test.describe('a route handler whose page closed while it read the answer (#2014)', () => {
	test('Playwright throws at it, in words ROUTE_GONE_RE knows', async ({ browser, baseURL }) => {
		const ended = await closed_mid_read(browser, baseURL!, (handler) => handler);
		expect(ended.status).toBe('rejected');
		const reason = ended.status === 'rejected' ? String((ended.reason as Error).message) : '';
		expect(reason).toMatch(ROUTE_GONE_RE);
	});

	test('through while_open it ends quietly', async ({ browser, baseURL }) => {
		const ended = await closed_mid_read(browser, baseURL!, while_open);
		expect(ended).toEqual({ status: 'fulfilled', value: undefined });
	});
});
