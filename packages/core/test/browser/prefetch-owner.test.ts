// A PREFETCH CLEANS UP ONLY ITS OWN ENTRY (runtime/router-nav.ts `fetch_page`). A prefetch waits in
// the load scheduler's queue (a guess shares the small background window), and the router keeps it
// by address so a click on that page can lift it to the visitor's class. Clearing the page cache (a
// remote mutation landed) forgets the prefetch in flight, and the next prefetch of the same address
// takes its place. When the OLD one's slot then comes up, it must not forget the NEW one: a click
// that joins it has to find it, or the click waits behind every other guess.
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
/** Answers the first request (the old prefetch: it keeps its slot while it is out). */
let answer_first: () => void = () => {};

beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
	link_boot();
	asked.length = 0;
	window.fetch = async (input) => {
		asked.push(String(input));
		if (asked.length === 1) await new Promise<void>((r) => (answer_first = r));
		return new Response('<!doctype html><title>next</title><p>next</p>', {
			status: 200,
			headers: { 'content-type': 'text/html', 'cache-control': 'private, max-age=60' }
		});
	};
});
afterEach(() => {
	window.fetch = real_fetch;
});

test('an old prefetch whose slot comes up after a cache clear leaves the newer prefetch for a click to lift', async () => {
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
	nav.bust_page_cache(); // a mutation landed: the cache, and the prefetch in flight, are forgotten
	void nav.fetch_page(href, undefined, 'prefetch'); // the next prefetch of the page: queued behind
	expect(asked).toEqual([]);
	held[0](); // a slot frees: the FIRST prefetch goes (the window is full again)
	await expect.poll(() => asked.length, { timeout: 2_000 }).toBe(1);
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
	expect(asked.length, 'the newer prefetch was the click’s fetch').toBe(2);
	answer_first();
	for (const release of held.slice(1)) release();
});
