// A SWR LAKE REMOUNTED VACANT (its host's `{#if}` came back, a navigation back): the lake repaints
// from the copy the runtime kept of it, then refreshes from its endpoint. The islands inside that copy
// wait for the lake to settle; the refresh settles it and morphs them in place — the same nodes, so
// nothing reconnects them. Settling the lake must wake them, whichever way it settles.
import { afterEach, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const real_fetch = window.fetch;
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

/** The Counter island as a page carries it (shell + props sidecar). */
const island = () => from_b64(inject('counter_ssr_b64'));
const ENDPOINT = '/__ogygia__?id=lakeswr00001&props=W3t9XQ&exp=9999999999&sig=stub';
const lake = (inner: string) =>
	`<ogygia-region wake="none" remount="swr" when="load" entry="lake-swr-remount" endpoint="${ENDPOINT}">${inner}</ogygia-region>`;
const ISLAND = 'ogygia-region[entry$="Counter.svelte"]';

test('the islands inside a remounted swr lake wake once its refresh lands', async () => {
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return new Response(island(), { status: 200, headers: { 'content-type': 'text/html' } });
	};
	// first mount: the server's lake, its island wakes, the runtime keeps a copy of the lake
	document.body.innerHTML = lake(island());
	bootDev();
	await expect
		.poll(() => document.querySelector(`${ISLAND}[data-hydrated]`) !== null, { timeout: 5_000 })
		.toBe(true);
	document.body.innerHTML = '';
	await new Promise((r) => setTimeout(r, 50));
	// the remount: the lake comes back EMPTY (a lake is server HTML, the client has none to render)
	const box = document.createElement('div');
	box.innerHTML = lake('');
	document.body.append(box);
	const remounted = box.querySelector('ogygia-region')!;
	await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(1);
	await expect
		.poll(() => remounted.hasAttribute('data-revalidated'), { timeout: 5_000 })
		.toBe(true);
	const inner = remounted.querySelector(ISLAND)!;
	expect(inner, 'the remounted lake shows its island').not.toBeNull();
	await expect
		.poll(() => inner.hasAttribute('data-hydrated'), {
			timeout: 5_000,
			message: 'the island inside woke once the refresh settled the lake'
		})
		.toBe(true);
});
