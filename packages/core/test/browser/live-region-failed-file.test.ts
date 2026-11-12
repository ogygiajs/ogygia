// A LIVE REGION WHOSE ISLAND FILE CANNOT LOAD (#942). An interactive tick swaps its HTML in and loads
// its island; the file fails. The region settles: later ticks of the same module show their HTML and
// do not load it again, nothing is thrown at the page, and the failure is said once, coded. It
// started over on every tick (hydrating, the import failed, idle): each tick threw the import's error
// out of `applyLive` (unhandled where nothing awaited it) and asked the server about the file again.
import { afterEach, expect, inject, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

/** A module the dev server does not have: every import of it fails. */
const MISSING = '/test/browser/fixtures/NoSuchIsland.svelte';
const label_html = () => decodeURIComponent(escape(atob(inject('label_render_b64'))));

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		hydrate?: string;
	}): Promise<void>;
};

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

test('a live region whose island file cannot load settles: no start per tick, nothing thrown, said once', async () => {
	const live = document.createElement('ogygia-region') as LiveRegion;
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();

	let starts = 0;
	const off = observe((name, _from, to) => {
		if (name === 'live-region' && to?.kind === 'hydrating') starts++;
	});
	const said: string[] = [];
	const real_error = console.error;
	console.error = (...args: unknown[]) => {
		said.push(args.map(String).join(' '));
		real_error(...args);
	};
	const thrown: unknown[] = [];
	try {
		for (let i = 0; i < 4; i++) {
			await live
				.applyLive({
					id: 'live-missing',
					module: MISSING,
					props: { text: `tick ${i}` },
					html: label_html().replace('one', `tick ${i}`),
					hydrate: 'load'
				})
				.catch((e: unknown) => thrown.push(e));
			await new Promise((r) => setTimeout(r, 300));
		}
	} finally {
		console.error = real_error;
		off();
	}

	expect(thrown, 'no tick throws at the page').toEqual([]);
	expect(starts, 'the island is loaded for the first tick only').toBe(1);
	expect(said.filter((s) => s.includes('island_load_failed')).length, 'said once, coded').toBe(1);
	// the latest tick's server HTML shows
	await expect.poll(() => live.querySelector('[data-testid="label"]')?.textContent).toBe('tick 3');
});
