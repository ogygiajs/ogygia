// A LIVE REGION (`<ogygia-region live>`, driven by `applyLive` tick by tick): an interactive tick
// swaps its HTML in and hydrates its island, a later tick of the same module pushes props into it, a
// static tick morphs HTML in from the frame store. Whatever order the ticks come in, the region has
// at most one island, and each mode lets go of the other's machinery when it takes over.
import { afterEach, expect, inject, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset, stamp, write } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';

const LABEL = '/test/browser/fixtures/Label.svelte';
const PROBE = '/test/browser/fixtures/LiveProbe.svelte';
/** `render(Label, { text: 'one' })` — LiveProbe renders the very same markup. */
const label_html = () => decodeURIComponent(escape(atob(inject('label_render_b64'))));
const LIVE_URL = (id: string) => `/__ogygia__?id=${id}&props=W3t9XQ&exp=9999999999&sig=stub`;

type LiveTick = {
	id: string;
	module: string;
	props: Record<string, unknown>;
	html: string;
	url?: string;
	hydrate?: string;
};
type LiveRegion = HTMLElement & { applyLive(desc: LiveTick): Promise<void> };

function live_region(): LiveRegion {
	const el = document.createElement('ogygia-region') as LiveRegion;
	el.setAttribute('live', '');
	document.body.append(el);
	bootDev();
	return el;
}

const label_text = (el: Element) => el.querySelector('[data-testid="label"]')?.textContent;

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
	delete (globalThis as { __og_live_disposed?: number }).__og_live_disposed;
});

test('a second interactive tick while the first one hydrates mounts no second island', async () => {
	const live = live_region();
	let hydrated = 0;
	live.addEventListener('ogygia:hydrated', () => hydrated++);
	const tick = (text: string) =>
		live.applyLive({
			id: 'live-twice',
			module: LABEL,
			props: { text },
			html: label_html(),
			hydrate: 'load'
		});
	void tick('one');
	void tick('two'); // (arrives before the first tick's island has loaded)
	await expect.poll(() => hydrated, { timeout: 5_000 }).toBeGreaterThan(0);
	await new Promise((r) => setTimeout(r, 300));
	expect(hydrated, 'one island hydrated, once').toBe(1);
	await expect.poll(() => label_text(live), { timeout: 5_000 }).toBe('two');
	expect(live.querySelectorAll('[data-testid="label"]')).toHaveLength(1);
});

test('an interactive region that turns static disposes its island', async () => {
	const live = live_region();
	await live.applyLive({
		id: 'live-to-static',
		module: PROBE,
		props: { text: 'one' },
		html: label_html(),
		hydrate: 'load'
	});
	await expect.poll(() => live.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	await live.applyLive({
		id: 'live-to-static',
		module: '',
		props: {},
		html: '<p data-testid="static">static now</p>',
		url: LIVE_URL('livestatic01')
	});
	await expect
		.poll(() => live.querySelector('[data-testid="static"]') !== null, { timeout: 5_000 })
		.toBe(true);
	await expect
		.poll(() => (globalThis as { __og_live_disposed?: number }).__og_live_disposed ?? 0, {
			timeout: 5_000,
			message: 'the island it hydrated was disposed'
		})
		.toBe(1);
});

test('a static region that turns interactive stops taking the store’s frames', async () => {
	const live = live_region();
	const url = LIVE_URL('livestatic02');
	await live.applyLive({
		id: 'static-to-live',
		module: '',
		props: {},
		html: '<p data-testid="static">static</p>',
		url
	});
	await expect
		.poll(() => live.querySelector('[data-testid="static"]') !== null, { timeout: 5_000 })
		.toBe(true);
	await live.applyLive({
		id: 'static-to-live',
		module: LABEL,
		props: { text: 'one' },
		html: label_html(),
		hydrate: 'load',
		url
	});
	await expect.poll(() => live.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	// a frame at its old address (a mutation that returned the static region) must not morph over
	// the live island
	const a = frameAddress(url);
	write({ a, v: stamp(), html: '<p data-testid="static">from the store</p>' });
	await new Promise((r) => setTimeout(r, 300));
	expect(live.querySelector('[data-testid="static"]'), 'the live island was left alone').toBeNull();
	expect(label_text(live)).toBe('one');
});
