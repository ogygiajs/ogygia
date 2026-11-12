// A HOLE'S FETCH IS AS URGENT AS THE MOST URGENT CALLER OF IT (#444). A hole's `prefetch` warm is
// background work: it waits for a turn in the load scheduler's small background window. The hole's
// own fetch, and `preload()`, join that warm through the frame store (one flight per address).
// Joined, a visitor's fetch used to wait out the guess's turn behind every other guess on the page;
// it now raises the flight it joins, so the queued fetch starts at once.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import {
	BACKGROUND_WINDOW,
	LoadSlot,
	reset_load_scheduler
} from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';
import { preload } from '../../src/preload.ts';
import { REGION_BRAND } from '../../src/region-brand.ts';

const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const real_fetch = window.fetch;
const asked: string[] = [];
let held: (() => void)[] = [];

beforeEach(async () => {
	document.body.innerHTML = '';
	// the real pointer away from the fixture: content that appears under a resting cursor gets a
	// trusted `pointerover`, and an on-demand hole would fetch before the test's own hover
	// (deferred-endpoint.test.ts `park_pointer`)
	const corner = document.createElement('div');
	corner.style.cssText = 'position:fixed;right:24px;bottom:24px;width:24px;height:24px';
	document.body.append(corner);
	await userEvent.hover(corner);
	corner.remove();
	reset_load_scheduler();
	reset_document_painted();
	asked.length = 0;
	window.fetch = async (input) => {
		asked.push(String(input));
		return new Response('<p data-answer>answer</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	};
	// the background window is full: other guesses hold every slot
	held = await Promise.all(
		Array.from(
			{ length: BACKGROUND_WINDOW },
			(_, i) => new LoadSlot({ kind: 'content', cls: 'ahead', label: 'held' + i }).ready
		)
	);
});
afterEach(() => {
	for (const release of held) release();
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

/** An on-demand hole that warms its HTML at load: the warm queues behind the full window. */
function warming_hole(endpoint: string): HTMLElement {
	document.body.innerHTML =
		`<ogygia-region render="defer" when="interaction" prefetch="load" endpoint="${endpoint}">` +
		`<p data-fallback>fallback</p></ogygia-region>`;
	return document.querySelector('ogygia-region')!;
}

test('a hover on a hole whose prefetch waits for a background turn fetches at once', async () => {
	const E = ep('prio00000001');
	const region = warming_hole(E);
	bootDev();
	await new Promise((r) => setTimeout(r, 100));
	expect(asked, 'the warm waits behind the full window').toEqual([]);
	region.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
	await expect
		.poll(() => region.querySelector('[data-answer]') !== null, {
			timeout: 2_000,
			message: 'the hover waited out the guess’s turn'
		})
		.toBe(true);
	expect(asked, 'one request: the hover joined the warm').toHaveLength(1);
});

test('preload() of a hole whose prefetch waits for a background turn fetches at once', async () => {
	const E = ep('prio00000002');
	warming_hole(E);
	bootDev();
	await new Promise((r) => setTimeout(r, 100));
	expect(asked).toEqual([]);
	preload({ [REGION_BRAND]: true, url: E });
	await expect
		.poll(() => asked.length, {
			timeout: 2_000,
			message: 'preload() waited out the guess’s turn'
		})
		.toBe(1);
});
