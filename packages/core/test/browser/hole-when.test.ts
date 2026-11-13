import { afterEach, expect, test } from 'vitest';
import { clock } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const ep = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;
const hole = (endpoint: string, when: string) =>
	`<ogygia-region render="defer" when="${when}" endpoint="${endpoint}"><p data-fallback>loading</p></ogygia-region>`;

const real_fetch = window.fetch;
const real_idle = window.requestIdleCallback;
afterEach(() => {
	window.fetch = real_fetch;
	window.requestIdleCallback = real_idle;
	document.body.innerHTML = '';
	_reset();
});

function count_fetches(): { at: number[] } {
	const at: number[] = [];
	window.fetch = async () => {
		at.push(clock.mono());
		return new Response('<p data-answer>answer</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	};
	return { at };
}

test('an idle hole on a page that never goes idle still fetches within 2 s', async () => {
	const { at } = count_fetches();
	window.requestIdleCallback = (() => 0) as typeof window.requestIdleCallback;
	const t0 = clock.mono();
	document.body.innerHTML = hole(ep('idlecap0001'), 'idle');
	bootDev();
	await expect.poll(() => at.length, { timeout: 4_000, interval: 50 }).toBe(1);
	expect(at[0] - t0).toBeLessThan(3_000);
});

test('an idle hole in a browser with no idle callback fetches after a short pause, not at once', async () => {
	const { at } = count_fetches();
	const own = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
	delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
	try {
		expect('requestIdleCallback' in window).toBe(false);
		const t0 = clock.mono();
		document.body.innerHTML = hole(ep('noidlecb001'), 'idle');
		bootDev();
		await expect.poll(() => at.length, { timeout: 1_000, interval: 20 }).toBe(1);
		expect(at[0] - t0).toBeGreaterThanOrEqual(150);
	} finally {
		if (own) Object.defineProperty(window, 'requestIdleCallback', own);
	}
});

test('a hole whose media query matches at load fetches at once', async () => {
	const { at } = count_fetches();
	document.body.innerHTML = hole(ep('medianow001'), '(min-width: 1px)');
	bootDev();
	await expect.poll(() => at.length, { timeout: 2_000, interval: 20 }).toBe(1);
});
