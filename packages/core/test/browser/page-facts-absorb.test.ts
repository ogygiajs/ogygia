// Its own file: whether devalue and the hydrate core are loaded is module state its tests share, in order.
import { afterEach, expect, inject, test, vi } from 'vitest';
import { stringify } from 'devalue';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { region_fragment } from './_html.ts';

const HOLE = '/__ogygia__?id=facts-later&props=W3t9XQ&exp=9999999999&sig=stub';
const facts = (who: string) =>
	`<script type="application/ogygia-page-facts">${stringify({ who })}\x3C/script>`;
const who = () => (page_state.data as { who?: string }).who;

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

test('facts an answer queued on a page of JSON-lane scripts load devalue for the next wake, and reach page.data', async () => {
	document.body.innerHTML = decodeURIComponent(escape(atob(inject('counter_json_lane_ssr_b64'))));
	region_fragment(`${facts('first')}<p>hole</p>`);
	bootDev();
	await expect
		.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
			timeout: 10_000
		})
		.toBe(true);
	expect(who()).toBe('first');
});

test('facts a hole’s answer brings once islands are awake join page.data at once, with no wake', async () => {
	const real_fetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (!url.includes('id=facts-later')) return real_fetch(input, init);
		return new Response(`${facts('later')}<p data-later>answer</p>`, {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	});
	const hole = document.createElement('div');
	hole.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${HOLE}"><p>loading</p></ogygia-region>`;
	document.body.append(hole);
	await expect
		.poll(() => document.querySelector('[data-later]') !== null, { timeout: 5_000 })
		.toBe(true);
	await expect.poll(who, { timeout: 2_000 }).toBe('later');
});
