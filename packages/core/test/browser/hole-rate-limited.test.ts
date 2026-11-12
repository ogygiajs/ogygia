// A HOLE THE ENDPOINT RATE-LIMITED WAITS OUT THE WINDOW (#959). The region endpoint answers 429 once
// a visitor's address used its render budget, until the window resets. A hole's retries landed
// inside the same window (0.5 s, then 1 s), so each was a 429 too, and the hole gave up for the life
// of the page. A 429 says how long to wait (`Retry-After`); the hole asks again after it.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clock } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const hole = (endpoint: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;

const real_fetch = window.fetch;
beforeEach(() => {
	document.body.innerHTML = '';
});
afterEach(() => {
	window.fetch = real_fetch;
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	_reset();
});

function insert(markup: string): HTMLElement {
	const box = document.createElement('div');
	box.innerHTML = markup;
	const el = box.querySelector<HTMLElement>('ogygia-region')!;
	document.body.append(...Array.from(box.childNodes));
	return el;
}

test('a hole the endpoint rate-limited asks again once the window is over, and shows its answer', async () => {
	// the visitor's budget is spent for the next 3 s: every ask until then is a 429 that says so
	const WINDOW_S = 3;
	const until = clock.mono() + WINDOW_S * 1000;
	let asked = 0;
	window.fetch = async () => {
		asked++;
		const left = until - clock.mono();
		if (left > 0)
			return new Response('Too Many Requests', {
				status: 429,
				headers: { 'retry-after': String(Math.ceil(left / 1000)) }
			});
		return new Response('<p data-answer>hello</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	};
	const el = insert(hole(ep('ratelimit01')));
	bootDev();
	await expect
		.poll(() => el.querySelector('[data-answer]'), {
			message: 'the answer, once the window is over',
			timeout: 10_000,
			interval: 100
		})
		.not.toBeNull();
	expect(asked, 'asked again after the window, not only inside it').toBeGreaterThan(1);
});
