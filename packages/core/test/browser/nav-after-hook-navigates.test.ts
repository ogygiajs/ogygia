// AN AFTER HOOK THAT NAVIGATES (a redirect once a page is in): the hook runs while its navigation
// settles, and the navigation it starts takes over there (`settling -> claimed`). The first one
// must not end the second's visit when it finishes settling; the second lands, and the router
// ends idle on its address.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { observe } from '@ogygia/machine';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

const real_fetch = window.fetch;
const home = location.href;

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.fetch = async (input) => {
		const path = new URL(String(input instanceof Request ? input.url : input), location.href)
			.pathname;
		return new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>${path}</title></head><body><p>${path}</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
});

test('an after hook that navigates: its navigation takes over while the first settles, and lands', async () => {
	const r = new SpaRouter();
	// (a navigation the router gives the browser would leave the test page)
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.href);
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	const moves: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'navigation' && to) moves.push(`${from.kind} -> ${to.kind}`);
	});
	const after: string[] = [];
	const then = new URL('/after-hook-then', location.href);
	r.afterNavigate((nav) => {
		if (nav.type === 'enter') return;
		after.push(nav.to.url.pathname);
		if (nav.to.url.pathname === '/after-hook-first') void r.navigate(then);
	});
	try {
		await r.navigate(new URL('/after-hook-first', location.href));
		await expect
			.poll(() => after, { timeout: 2_000 })
			.toEqual(['/after-hook-first', '/after-hook-then']);
		await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
		expect(handed).toEqual([]);
		expect(location.pathname).toBe('/after-hook-then');
		expect(document.body.textContent).toContain('/after-hook-then');
		expect(moves).toContain('settling -> claimed');
	} finally {
		off();
	}
});
