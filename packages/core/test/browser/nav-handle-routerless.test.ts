// A runtime WITHOUT the router (`router: false`): island code still reaches `invalidate` and
// `invalidateAll` through the navigation handle, and both are the soft seed refresh. The router
// never loads here, so nothing the router sets up may be needed for them. (This file never imports
// ./router.ts: the router feature's install would fill what the refresh must work without.)
import { expect, test } from 'vitest';
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
