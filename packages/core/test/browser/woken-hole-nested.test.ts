// A server island that WAKES (`render: 'deferred', fetch: 'load'`), whose component has another server
// island inside it (#906). The page's hole fetches its answer after the page loads (the endpoint's
// render of the component, as its root), paints it, then the component hydrates over it. The inner
// server island must show: rendered inline, or fetched as a hole.
import { afterEach, beforeEach, expect, inject, test, vi } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const CARD = '/test/browser/fixtures/WokenHoleCard.svelte';
const OUTER_URL = '/__ogygia__?id=woken-hole-card&props=W3t9XQ&exp=9999999999&sig=stub';
const INNER_URL = '/__ogygia__?id=woken-hole-inner&props=W3t9XQ&exp=9999999999&sig=stub';
// (no signer in this harness: the inner hole gets the address a server signs)
const answer = () =>
	decodeURIComponent(escape(atob(inject('woken_hole_answer_b64')))).replace(
		'endpoint=""',
		`endpoint="${INNER_URL}"`
	);

let real_fetch: typeof fetch;
beforeEach(() => {
	real_fetch = globalThis.fetch;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const html = url.includes('id=woken-hole-inner')
			? '<p data-testid="label">inner greeting</p>'
			: url.includes('id=woken-hole-card')
				? answer()
				: null;
		if (html == null) return real_fetch(input, init);
		return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

test('a server island inside a woken server island’s answer shows', async () => {
	document.body.innerHTML = `<ogygia-region render="defer" when="load" wake="load" entry="${CARD}" endpoint="${OUTER_URL}"><p data-fallback>loading</p></ogygia-region>`;
	const hole = document.querySelector('ogygia-region') as HTMLElement;
	bootDev();
	await expect.poll(() => hole.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	expect(hole.querySelector('[data-woken-card]'), 'the answer came').not.toBeNull();
	await expect
		.poll(() => hole.querySelector('[data-woken-card] [data-testid="label"]')?.textContent, {
			timeout: 5_000
		})
		.toBe('inner greeting');
});
