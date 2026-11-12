// A HOLE THAT FAILED FOR THE NETWORK WAITS FOR THE NETWORK (#891). A deferred region whose fetch
// fails while the browser is offline used to try three times over a few seconds, then give up for
// the life of the page: the fallback stayed after the network came back. A failure the network
// caused, while the browser says it is offline, waits for the `online` event and asks again. A
// failure the server caused (an error status, a refusal) gives up as before.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const hole = (endpoint: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;

const real_fetch = window.fetch;
let online = true;
beforeEach(() => {
	document.body.innerHTML = '';
	online = true;
	Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
});
afterEach(() => {
	window.fetch = real_fetch;
	delete (navigator as unknown as Record<string, unknown>).onLine;
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

const answer = () =>
	new Response('<p data-answer>hello</p>', {
		status: 200,
		headers: { 'content-type': 'text/html' }
	});

test('a hole whose fetch failed while offline loads once the browser is back online', async () => {
	let calls = 0;
	window.fetch = async () => {
		calls++;
		if (!online) throw new TypeError('Failed to fetch');
		return answer();
	};
	online = false;
	const el = insert(hole(ep('offline0001')));
	bootDev();
	await expect.poll(() => calls, { timeout: 5_000 }).toBeGreaterThan(0);
	// well past every retry it would have made
	await new Promise((r) => setTimeout(r, 2_500));
	expect(el.querySelector('[data-fallback]'), 'the fallback stands while offline').not.toBeNull();
	const asked_offline = calls;

	online = true;
	window.dispatchEvent(new Event('online'));
	await expect
		.poll(() => el.querySelector('[data-answer]') !== null, {
			timeout: 5_000,
			message: 'the hole asked again once the network was back'
		})
		.toBe(true);
	expect(calls).toBeGreaterThan(asked_offline);
});

test('a hole the server failed still gives up, and the network coming back asks nothing', async () => {
	let calls = 0;
	window.fetch = async () => {
		calls++;
		return new Response('', { status: 500 });
	};
	const el = insert(hole(ep('offline0002')));
	bootDev();
	// its tries: three, half a second then a second apart
	await new Promise((r) => setTimeout(r, 2_500));
	const tried = calls;
	expect(tried).toBe(3);
	window.dispatchEvent(new Event('online'));
	await new Promise((r) => setTimeout(r, 300));
	expect(calls, 'a server failure is not the network').toBe(tried);
	expect(el.querySelector('[data-fallback]')).not.toBeNull();
});
