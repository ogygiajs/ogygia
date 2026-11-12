// A held region that WAKES (a remote's `await region(Card)` with `wake`), whose component has a server
// island (`render: 'deferred'`) inside it (#901). The region's HTML is baked on the server
// (`render_region_html`), painted by the runtime, then the component hydrates over it. The server
// island must show either way the two legs agree: rendered inline (the nested rule, as inside any
// island) or fetched as a hole. It stayed an empty element, never fetched, nothing said.
import { afterEach, beforeEach, expect, inject, test, vi } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const CARD = '/test/browser/fixtures/HeldHoleCard.svelte';
const HOLE_URL = '/__ogygia__?id=held-hole-greeting&props=W3t9XQ&exp=9999999999&sig=stub';
const card_html = () => decodeURIComponent(escape(atob(inject('held_hole_card_b64'))));

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		hydrate?: string;
	}): Promise<void>;
};

let real_fetch: typeof fetch;
beforeEach(() => {
	real_fetch = globalThis.fetch;
	// a hole's endpoint answers its component's render (no signer in this harness: the test hands the
	// hole the address a server signs)
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (url.includes('/__ogygia__'))
			return new Response('<p data-testid="label">held greeting</p>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		return real_fetch(input, init);
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = real_fetch;
	document.body.innerHTML = '';
	_reset();
});

test('a server island inside a woken held region shows', async () => {
	const live = document.createElement('ogygia-region') as LiveRegion;
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();
	let hydrated = 0;
	live.addEventListener('ogygia:hydrated', () => hydrated++);
	await live.applyLive({
		id: 'held-hole-card',
		module: CARD,
		props: {},
		html: card_html().replace('endpoint=""', `endpoint="${HOLE_URL}"`),
		hydrate: 'load'
	});
	const warns: string[] = [];
	const real_warn = console.warn;
	console.warn = (...args: unknown[]) => {
		warns.push(args.map(String).join(' '));
		real_warn(...args);
	};
	try {
		await expect.poll(() => hydrated, { timeout: 5_000 }).toBeGreaterThan(0);
	} finally {
		console.warn = real_warn;
	}
	// the component hydrates over the server's render as it is: both legs took the same branch
	expect(warns.filter((w) => w.includes('hydration_mismatch'))).toEqual([]);
	expect(live.querySelector('[data-held-card]'), 'the card came').not.toBeNull();
	await expect
		.poll(() => live.querySelector('[data-held-card] [data-testid="label"]')?.textContent, {
			timeout: 5_000
		})
		.toBe('held greeting');
});
