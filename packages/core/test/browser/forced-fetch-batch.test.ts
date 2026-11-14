// A FORCED FETCH DOES NOT ORPHAN THE BATCH IT MEETS (runtime/frame-store.ts `ensure`, `write`,
// `release`). A navigation streams its holes in one batch request and reserves each address; a hole
// that connects meanwhile JOINS the reservation instead of fetching. A swr lake of the same call
// that revalidates (a forced fetch) at that address must not take the reservation's place: when the
// batch ends without the hole's part, the hole is let go and fetches on its own.
import { afterEach, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { streamFrames } from '../../src/runtime/frame-nav.ts';

const real_fetch = window.fetch;
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

const island = () => from_b64(inject('counter_ssr_b64'));
const ENDPOINT = '/__ogygia__?id=forcebatch01&props=W3t9XQ&exp=9999999999&sig=stub';
const lake = (inner: string) =>
	`<ogygia-region wake="none" remount="swr" when="load" entry="forced-fetch-batch" endpoint="${ENDPOINT}">${inner}</ogygia-region>`;
const hole = `<ogygia-region render="defer" when="load" endpoint="${ENDPOINT}"><p data-fallback>loading</p></ogygia-region>`;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('a hole waiting on a batch, its lake twin revalidating: the batch ends without it, and the hole fetches its own', async () => {
	let end_batch!: () => void;
	const gets: string[] = [];
	window.fetch = async (input, init) => {
		if (init?.method === 'POST') {
			// the navigation's batch: out until the test ends it, then it carries no part at all
			await new Promise<void>((r) => (end_batch = r));
			return new Response('', { status: 200, headers: { 'content-type': 'text/plain' } });
		}
		gets.push(String(init?.cache));
		// the lake's refreshes (past the browser cache) fail: a network that drops them
		if (init?.cache === 'no-store') return new Response('', { status: 500 });
		return new Response('<p data-answer>answer</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	};
	// the lake's first mount: the runtime keeps its copy; then it leaves (its host's `{#if}`)
	document.body.innerHTML = lake(island());
	bootDev();
	await tick();
	document.body.innerHTML = '';
	await tick();
	// a navigation's batch reserves the call's address; the hole connects and joins it
	const batch = streamFrames([ENDPOINT]);
	document.body.insertAdjacentHTML('beforeend', hole);
	const el = document.querySelector<HTMLElement>('ogygia-region')!;
	await tick();
	expect(gets, 'the hole joined the batch: no request of its own').toEqual([]);
	// the lake comes back vacant and revalidates at the same address (a forced fetch), and fails
	const box = document.createElement('div');
	box.innerHTML = lake('');
	document.body.append(box);
	await expect.poll(() => gets.includes('no-store'), { timeout: 5_000 }).toBe(true);
	// the batch ends without the hole's part
	end_batch();
	await batch;
	await expect
		.poll(() => el.querySelector('[data-answer]') !== null, {
			timeout: 8_000,
			message: 'the hole was let go and fetched its own answer'
		})
		.toBe(true);
	expect(gets, 'the hole’s own request').toContain('default');
});
