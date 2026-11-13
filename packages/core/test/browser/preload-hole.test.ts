// `preload(region)` WARMS A HOLE THROUGH THE HOLE'S OWN FETCH. It fetches the hole's address now so
// its element paints the moment it binds; whatever it stores, the element applies as its answer. So it
// must read the answer the way the element does: a 204 is `keepFallback()` (the fallback stays), and
// a redirected or whole-document answer is not the region's (refused, the fallback stays).
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { preload } from '../../src/preload.ts';
import { REGION_BRAND } from '../../src/region-brand.ts';

const real_fetch = window.fetch;
afterEach(() => {
	window.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

const region_value = (url: string) => ({ [REGION_BRAND]: true, url });

async function preload_then_mount(endpoint: string, answer: () => Response) {
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return answer();
	};
	preload(region_value(endpoint));
	await expect.poll(() => calls.length, { timeout: 5_000 }).toBe(1);
	await new Promise((r) => setTimeout(r, 50)); // (the warm landed in the store)
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${endpoint}"><p data-testid="fallback">fallback</p></ogygia-region>`;
	const el = document.querySelector('ogygia-region')!;
	bootDev();
	return { el, calls };
}

test('a preloaded hole that answers keepFallback() (204) keeps its fallback', async () => {
	const ENDPOINT = '/__ogygia__?id=preload00001&props=W3t9XQ&exp=9999999999&sig=stub';
	const { el } = await preload_then_mount(ENDPOINT, () => new Response(null, { status: 204 }));
	await expect.poll(() => el.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	expect(el.querySelector('[data-testid="fallback"]'), 'the fallback stands').not.toBeNull();
	expect(el.hasAttribute('data-og-kept')).toBe(true);
});

test('a preloaded hole answered by a whole page (something in front of the handle) is refused', async () => {
	const ENDPOINT = '/__ogygia__?id=preload00002&props=W3t9XQ&exp=9999999999&sig=stub';
	const page = () =>
		new Response('<!doctype html><html><body><p data-testid="page">a page</p></body></html>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	const { el } = await preload_then_mount(ENDPOINT, page);
	await new Promise((r) => setTimeout(r, 300));
	expect(el.querySelector('[data-testid="page"]'), 'the page was not swapped in').toBeNull();
	expect(el.querySelector('[data-testid="fallback"]'), 'the fallback stands').not.toBeNull();
});

test('a region whose address is another origin is not preloaded: no request goes out', async () => {
	const calls: string[] = [];
	window.fetch = async (input) => {
		calls.push(String(input));
		return new Response('<p>foreign</p>', { status: 200 });
	};
	for (const url of [
		'https://other.example/__ogygia__?id=preload00003&props=W3t9XQ&exp=9999999999&sig=stub',
		'//other.example/__ogygia__?id=preload00004&props=W3t9XQ&exp=9999999999&sig=stub'
	])
		preload(region_value(url));
	await new Promise((r) => setTimeout(r, 100));
	expect(calls).toEqual([]);
});

test('a preload whose fetch fails is quiet: no unhandled rejection reaches the page', async () => {
	const ENDPOINT = '/__ogygia__?id=preload00005&props=W3t9XQ&exp=9999999999&sig=stub';
	const unhandled: unknown[] = [];
	const on = (e: PromiseRejectionEvent) => {
		unhandled.push(e.reason);
		e.preventDefault();
	};
	window.addEventListener('unhandledrejection', on);
	let asked = 0;
	window.fetch = async () => {
		asked++;
		throw new TypeError('Failed to fetch');
	};
	try {
		preload(region_value(ENDPOINT));
		await expect.poll(() => asked, { timeout: 5_000 }).toBeGreaterThan(0);
		await new Promise((r) => setTimeout(r, 100));
	} finally {
		window.removeEventListener('unhandledrejection', on);
	}
	expect(unhandled).toEqual([]);
});
