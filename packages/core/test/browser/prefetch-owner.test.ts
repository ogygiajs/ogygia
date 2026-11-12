// A PREFETCH A CACHE CLEAR ENDED GIVES ITS TURN BACK (runtime/router-nav.ts `fetch_page`). A
// prefetch waits in the load scheduler's queue (a guess shares the small background window), and the
// router keeps it by address so a click on that page can lift it to the visitor's class. Clearing
// the page cache (a remote mutation landed) ends the prefetch in flight, and the next prefetch of the
// same address takes its place. A click then lifts the NEW one, and when the OLD one's turn comes up
// it fetches nothing: its page would be the one from before the mutation.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import {
	BACKGROUND_WINDOW,
	LoadSlot,
	reset_load_scheduler
} from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';

const real_fetch = window.fetch;
const asked: string[] = [];
/** The fetch priority each request went out with. */
const priorities: (string | undefined)[] = [];

beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
	link_boot();
	asked.length = 0;
	priorities.length = 0;
	window.fetch = async (input, init) => {
		asked.push(String(input));
		priorities.push((init as { priority?: string } | undefined)?.priority);
		return new Response('<!doctype html><title>next</title><p>next</p>', {
			status: 200,
			headers: { 'content-type': 'text/html', 'cache-control': 'private, max-age=60' }
		});
	};
});
afterEach(() => {
	window.fetch = real_fetch;
});

test('a click lifts the prefetch that replaced one a cache clear ended, and the ended one fetches nothing', async () => {
	// the router's navigation chunk, loaded as the router loads it (after the fetch it wraps)
	const nav = await import('../../src/runtime/router-nav.ts');
	const href = new URL('/prefetch-owner-next', location.href).href;
	// the background window is full: other guesses hold every slot
	const held = await Promise.all(
		Array.from(
			{ length: BACKGROUND_WINDOW },
			(_, i) => new LoadSlot({ kind: 'content', cls: 'ahead', label: 'held' + i }).ready
		)
	);
	void nav.fetch_page(href, undefined, 'prefetch'); // the first prefetch: queued
	nav.bust_page_cache(); // a mutation landed: the cache, and the prefetch in flight, are ended
	void nav.fetch_page(href, undefined, 'prefetch'); // the next prefetch of the page: queued behind
	expect(asked).toEqual([]);
	// the visitor clicks the link: the navigation joins the newer prefetch and lifts it
	const ctrl = new AbortController();
	let landed = false;
	const page = nav.fetch_page(href, ctrl.signal, 'nav').then((p) => {
		landed = true;
		return p;
	});
	await expect
		.poll(() => landed, {
			timeout: 2_000,
			message: 'the click waited in the guesses’ queue'
		})
		.toBe(true);
	expect((await page)?.html).toContain('next');
	expect(asked.length, 'the newer prefetch was the click’s fetch').toBe(1);
	// the window frees: the ended prefetch's turn comes up, and it gives the turn back unfetched
	for (const release of held) release();
	await new Promise((r) => setTimeout(r, 100));
	expect(asked.length, 'the ended prefetch fetched the page from before the mutation').toBe(1);
});

test('a click on a link whose prefetch still waits sends the page at the visitor priority, not the guess', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	const href = new URL('/prefetch-owner-priority', location.href).href;
	const held = await Promise.all(
		Array.from(
			{ length: BACKGROUND_WINDOW },
			(_, i) => new LoadSlot({ kind: 'content', cls: 'ahead', label: 'held' + i }).ready
		)
	);
	void nav.fetch_page(href, undefined, 'prefetch'); // a guess: queued behind the window
	expect(asked).toEqual([]);
	const ctrl = new AbortController();
	const page = await nav.fetch_page(href, ctrl.signal, 'nav'); // the click joins it
	expect(page?.html).toContain('next');
	expect(asked, 'one request: the click joined the prefetch').toHaveLength(1);
	expect(priorities, 'the request the visitor waits on went out at high priority').toEqual([
		'high'
	]);
	for (const release of held) release();
});
