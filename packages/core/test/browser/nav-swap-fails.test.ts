// A NAVIGATION WHOSE SWAP FAILS ENDS (#276). Anything that throws inside the swap (here an app's
// restorer, which the swap calls once the next page is in), with or without a view transition,
// must end the navigation on one path: it is not left in flight (later clicks on the link would
// join it and be swallowed), it is not finished as if the page went in (no after hooks, no
// settling), and the address goes to the browser, which loads the page whole.
//
// The view transition is the browser's own (Chromium has `startViewTransition`); the browser's
// navigation is the router's `hand_off`, heard here instead of leaving the test page.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

const real_fetch = window.fetch;
const real_report = window.reportError;
const home = location.href;
const g = globalThis as { __og_restore_adopt?: () => void };

function serve(marker: 'plain' | 'on') {
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="${marker}"><title>next</title></head><body><p>next</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
}

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.reportError = () => {};
	g.__og_restore_adopt = () => {
		throw new Error('restorer failed');
	};
});
afterEach(() => {
	window.fetch = real_fetch;
	window.reportError = real_report;
	delete g.__og_restore_adopt;
	history.replaceState(null, '', home);
});

for (const [what, marker] of [
	['without a view transition', 'plain'],
	['inside a view transition', 'on']
] as const) {
	test(`a swap that throws ${what}: the navigation ends and goes to the browser`, async () => {
		serve(marker);
		const r = new SpaRouter();
		const handed: string[] = [];
		vi.spyOn(r, 'hand_off').mockImplementation((url) => {
			handed.push(url.href);
			// (what the browser's navigation would end: the router's visit)
			if (r.nav.now.kind !== 'idle') r.nav.go('idle');
		});
		const after: string[] = [];
		r.afterNavigate((nav) => nav.type !== 'enter' && after.push(nav.to.url.pathname));
		const to = new URL('/nav-swap-fails-next', location.href);
		await r.navigate(to).catch(() => {});
		await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
		expect(handed).toEqual([to.href]);
		expect(after).toEqual([]);
	});
}
