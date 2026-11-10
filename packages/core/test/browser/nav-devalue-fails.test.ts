// A NAVIGATION WHOSE DEVALUE FAILS TO LOAD ENDS (#276). The next page holds a script only devalue
// reads, so the navigation loads devalue before its preflight. When that load fails (its download
// dropped, every retry too), the navigation must not stay in flight, where every later click on the
// link joins it and is swallowed: it ends, and the address goes to the browser, which loads the page
// whole.
//
// The load's failure is the boot's own `load_devalue` rejecting, as it does once its retries are
// spent. (Dropping devalue's download at the network would also drop it for the test files running
// beside this one in the same browser page.)
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { boot_link } from '../../src/runtime/slots.ts';

const real_fetch = window.fetch;
const real_report = window.reportError;
const home = location.href;

beforeEach(() => {
	link_boot();
	window.reportError = () => {};
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>next</title></head><body><p>next</p><script type="application/ogygia-page">[{}]\x3C/script></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	window.reportError = real_report;
	history.replaceState(null, '', home);
	vi.restoreAllMocks();
});

test('devalue that fails to load ends the navigation and gives the address to the browser', async () => {
	vi.spyOn(boot_link(), 'load_devalue').mockRejectedValue(
		new TypeError('Failed to fetch dynamically imported module: /devalue.js?og-retry=1')
	);
	const r = new SpaRouter();
	const handed: string[] = [];
	vi.spyOn(r, 'hand_off').mockImplementation((url) => {
		handed.push(url.href);
		// (what the browser's navigation would end: the router's visit)
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	const to = new URL('/nav-devalue-fails-next', location.href);
	await r.navigate(to).catch(() => {});
	await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	expect(handed).toEqual([to.href]);
	expect(document.querySelector('p')?.textContent).not.toBe('next');
});
