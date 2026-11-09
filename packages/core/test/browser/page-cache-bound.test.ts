// THE ROUTER'S PAGE CACHE STAYS BOUNDED (runtime/router-nav.ts `pages`): kept pages are a flights
// with `max` = PAGE_CACHE_MAX_BYTES and each entry weighing at least 1/32 of it, so at most 32 small
// pages are kept, and fewer big ones; the oldest go first. Seen through the requests a second ask of
// a page makes: a kept page answers with none, a page that went fetches again.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';

const real_fetch = window.fetch;
/** Each address the page fetch asked the network for. */
const asked: string[] = [];
/** The body length of each page, by path (default: a small page). */
const sizes = new Map<string, number>();

beforeEach(async () => {
	reset_load_scheduler();
	reset_document_painted();
	link_boot();
	asked.length = 0;
	sizes.clear();
	window.fetch = async (input) => {
		const url = new URL(String(input));
		asked.push(url.pathname);
		const body = 'x'.repeat(sizes.get(url.pathname) ?? 100);
		return new Response(`<!doctype html><title>${url.pathname}</title><p>${body}</p>`, {
			status: 200,
			headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' }
		});
	};
	(await import('../../src/runtime/router-nav.ts')).bust_page_cache();
});
afterEach(() => {
	window.fetch = real_fetch;
});

const at = (path: string) => new URL(path, location.href).href;

test('at most 32 small pages are kept: the oldest goes, the newest stays', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	for (let i = 0; i < 40; i++) await nav.fetch_page(at(`/bound-small-${i}`), undefined, 'prefetch');
	expect(asked).toHaveLength(40);
	// the newest 32 answer from the cache: no request
	for (let i = 8; i < 40; i++) await nav.fetch_page(at(`/bound-small-${i}`), undefined, 'nav');
	expect(asked).toHaveLength(40);
	// the oldest went: asked again, it fetches
	await nav.fetch_page(at('/bound-small-0'), undefined, 'nav');
	expect(asked).toHaveLength(41);
	expect(asked.at(-1)).toBe('/bound-small-0');
});

test('big pages count by their bytes: two of 1.5 MB do not fit beside a third', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	// (each weighs 3 MB: two chars a byte pair, against a 4 MB cap)
	for (const p of ['/bound-big-a', '/bound-big-b', '/bound-big-c']) sizes.set(p, 1_500_000);
	for (const p of ['/bound-big-a', '/bound-big-b', '/bound-big-c'])
		await nav.fetch_page(at(p), undefined, 'prefetch');
	expect(asked).toHaveLength(3);
	await nav.fetch_page(at('/bound-big-c'), undefined, 'nav');
	expect(asked).toHaveLength(3); // the newest is kept
	await nav.fetch_page(at('/bound-big-a'), undefined, 'nav');
	await nav.fetch_page(at('/bound-big-b'), undefined, 'nav');
	expect(asked).toHaveLength(5); // the older two went
});
