// A PAGE FETCH IS ONE FLIGHT PER ADDRESS (runtime/router-nav.ts `fetch_page`). A navigation and a
// prefetch of one page share one request, whichever started it. A cache clear (a remote mutation
// landed) ends the fetches in flight: a navigation that was waiting on one fetches the page again,
// so it never shows the page as it was before the mutation.
import { beforeEach, afterEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';

const real_fetch = window.fetch;
/** Each request the page fetch made, answered when the test says. */
const asked: Array<{ href: string; answer: (body: string) => void }> = [];

beforeEach(async () => {
	reset_load_scheduler();
	reset_document_painted();
	link_boot();
	asked.length = 0;
	window.fetch = (input) =>
		new Promise<Response>((resolve) => {
			asked.push({
				href: String(input),
				answer: (body) =>
					resolve(
						new Response(`<!doctype html><title>${body}</title><p>${body}</p>`, {
							status: 200,
							headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' }
						})
					)
			});
		});
	(await import('../../src/runtime/router-nav.ts')).bust_page_cache();
});
afterEach(() => {
	window.fetch = real_fetch;
});

test('a navigation waiting on a prefetch that a mutation made stale gets the page fetched again', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	const href = new URL('/page-flights-stale', location.href).href;
	void nav.fetch_page(href, undefined, 'prefetch');
	await expect.poll(() => asked.length, { timeout: 2_000 }).toBe(1);
	const ctrl = new AbortController();
	const page = nav.fetch_page(href, ctrl.signal, 'nav'); // the click joins the prefetch
	nav.bust_page_cache(); // a mutation landed while it was out
	asked[0].answer('before');
	await expect.poll(() => asked.length, { timeout: 2_000 }).toBe(2);
	asked[1].answer('after');
	expect((await page)?.html).toContain('after');
});

test('a navigation waiting on a prefetch whose request a mutation aborted gets the page fetched again', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	const answering = window.fetch;
	let aborted = 0;
	window.fetch = (input, init) => {
		const signal = init?.signal;
		if (asked.length > 0 || !signal) return answering(input, init);
		return new Promise<Response>((_, reject) => {
			asked.push({ href: String(input), answer: () => {} });
			signal.addEventListener('abort', () => {
				aborted++;
				reject(new DOMException('The user aborted a request.', 'AbortError'));
			});
		});
	};
	const href = new URL('/page-flights-aborted', location.href).href;
	void nav.fetch_page(href, undefined, 'prefetch');
	await expect.poll(() => asked.length, { timeout: 2_000 }).toBe(1);
	const ctrl = new AbortController();
	const page = nav.fetch_page(href, ctrl.signal, 'nav');
	nav.bust_page_cache();
	await expect.poll(() => asked.length, { timeout: 2_000 }).toBe(2);
	asked[1].answer('after');
	expect(aborted).toBe(1);
	expect((await page)?.html).toContain('after');
});

test('a prefetch of a page a navigation is fetching joins it: one request', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	const href = new URL('/page-flights-join', location.href).href;
	const ctrl = new AbortController();
	const page = nav.fetch_page(href, ctrl.signal, 'nav');
	await expect.poll(() => asked.length, { timeout: 2_000 }).toBe(1);
	const ahead = nav.fetch_page(href, undefined, 'prefetch'); // a hover while it is out
	await new Promise((r) => setTimeout(r, 50));
	expect(asked).toHaveLength(1);
	asked[0].answer('one');
	expect((await page)?.html).toContain('one');
	expect((await ahead)?.html).toContain('one');
});
