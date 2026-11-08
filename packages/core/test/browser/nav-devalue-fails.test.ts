// A NAVIGATION WHOSE DEVALUE FAILS TO LOAD ENDS (#276). The next page holds a script only devalue
// reads, so the navigation loads devalue before its preflight. When that download fails (a dropped
// connection, for real: the `drop_downloads` command), the navigation must not stay in flight,
// where every later click on the link joins it and is swallowed: it ends, and the address goes to
// the browser, which loads the page whole.
//
// Its own file: whether devalue is loaded is module state shared by a file's tests.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { SpaRouter } from '../../src/runtime/router.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(): Promise<void>;
	}
}

const real_fetch = window.fetch;
const home = location.href;

beforeEach(() => {
	link_boot();
	window.fetch = async () =>
		new Response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>next</title>' +
				'</head><body><p>next</p><script type="application/ogygia-page">[{}]</script></body></html>',
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(async () => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	await commands.keep_downloads();
});

test('devalue that fails to load ends the navigation and gives the address to the browser', async () => {
	await commands.drop_downloads('devalue.js', 10);
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
