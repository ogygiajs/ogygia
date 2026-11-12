// A runtime WITHOUT the router (`router: false`): island code still reaches `invalidate` and
// `invalidateAll` through the navigation handle, and both are the soft seed refresh. The router
// never loads here, so nothing the router sets up may be needed for them. (This file never imports
// ./router.ts: the router feature's install would fill what the refresh must work without.)
import { expect, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { boot } from '../../src/runtime/core.ts';
import * as mpa_nav from '../../src/runtime/nav-handle.ts';

const NAV = Symbol.for('ogygia.nav');
const scope = globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>;

test('without the router, invalidateAll and invalidate refresh (they never need the router)', async () => {
	delete scope[NAV];
	boot([mpa_nav.install]);
	const handle = scope[NAV]!;
	expect(handle, 'the MPA handle is published').toBeDefined();

	// the page here is no ogygia page, so the refresh reads it and leaves the document alone
	await expect((handle.invalidateAll as () => Promise<void>)()).resolves.toBeUndefined();
	await expect((handle.invalidate as () => Promise<void>)()).resolves.toBeUndefined();
	// and twice at once: the second takes over from the first, both settle
	const both = Promise.all([
		(handle.invalidateAll as () => Promise<void>)(),
		(handle.invalidateAll as () => Promise<void>)()
	]);
	await expect(both).resolves.toEqual([undefined, undefined]);
});

test('without the router, a refresh whose loaded code the keep let go loads it again and refreshes', async () => {
	delete scope[NAV];
	boot([mpa_nav.install]);
	const invalidate_all = scope[NAV]!.invalidateAll as () => Promise<void>;
	const moves: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'soft refresh' && to && (from.kind === 'flying' || from.kind === 'kept'))
			moves.push(`${from.kind} -> ${to.kind}`);
	});
	const platform = globalThis as { buggify?: (point: string) => boolean };
	try {
		await expect(invalidate_all()).resolves.toBeUndefined();
		// (its keep runs out at the next read, as a short keep's would: the simulator's buggify point)
		platform.buggify = (point) => point === 'flights.evicted-early';
		const again = invalidate_all();
		delete platform.buggify;
		await expect(again).resolves.toBeUndefined();
		expect(moves).toContain('kept -> gone');
		expect(moves.at(-1)).toBe('flying -> kept');
	} finally {
		delete platform.buggify;
		off();
	}
});
