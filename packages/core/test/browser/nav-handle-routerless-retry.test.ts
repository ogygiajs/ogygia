// A runtime WITHOUT the router (`router: false`) whose soft refresh fails to download (#238). The
// refresh code (./router-nav.ts) loads on the first `invalidateAll`; on a flaky network that
// download can fail, and the browser keeps that URL failed for the life of the page. A failed load
// must not be kept: the next refresh asks for it again and refreshes.
//
// The download fails for real, at the network (the `drop_downloads` command: Playwright's
// `route.abort`). Its own file: the refresh's load is module state.
import { afterEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { boot } from '../../src/runtime/core.ts';
import * as mpa_nav from '../../src/runtime/nav-handle.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const NAV = Symbol.for('ogygia.nav');
const scope = globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>;

afterEach(() => commands.keep_downloads('/src/runtime/router-nav.ts'));

it_with_network_routes(
	'without the router, a refresh whose code failed to download loads it on the next refresh',
	async () => {
		delete scope[NAV];
		boot([mpa_nav.install]);
		const handle = scope[NAV]!;
		const invalidate_all = handle.invalidateAll as () => Promise<void>;

		// every request the first refresh makes for its code fails
		await commands.drop_downloads('/src/runtime/router-nav.ts', 2);
		// (each engine words a failed import its own way: Chromium and Firefox name the module, WebKit
		// says "Importing a module script failed.")
		await expect(invalidate_all()).rejects.toThrow(TypeError);
		// the next refresh, the network back: it loads the code and refreshes
		await expect(invalidate_all()).resolves.toBeUndefined();
		await expect((handle.invalidate as () => Promise<void>)()).resolves.toBeUndefined();
	}
);
