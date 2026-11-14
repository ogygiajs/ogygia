// THE reloadNeeded HOOK (#1900): when a chunk can load only after a reload (a static dependency the
// document keeps failed), the page says `chunk_reload_needed` once, and a plugin's `reloadNeeded`
// hears the chunk's URL, the error, and the regions whose own file it is (a retry's `og-retry`
// mark aside), so an app can offer the reload. A page where nothing failed never hears it.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boot_client_plugins } from '../../src/runtime/client-plugins.ts';
import { slots } from '../../src/runtime/slots.ts';
import { say_reload_needed } from '../../src/runtime/reload-needed.ts';
import { import_again } from '../../src/runtime/import-again.ts';
import type { ReloadNeededEvent } from '../../src/contract/runtime-hooks.ts';

let heard: ReloadNeededEvent[];
let host: HTMLElement;
beforeEach(() => {
	heard = [];
	vi.spyOn(console, 'error').mockImplementation(() => {});
	boot_client_plugins(
		[{ name: 'app', client: { hooks: { reloadNeeded: (e) => void heard.push(e) } } }],
		false
	);
	host = document.createElement('div');
	host.innerHTML = ['a', 'b']
		.map((k) => `<ogygia-region src="/_app/immutable/og-region.${k}.js"></ogygia-region>`)
		.join('');
	document.body.append(host);
});
afterEach(() => {
	host.remove();
	slots.hooks = {};
	vi.restoreAllMocks();
});

it('hears the chunk no retry can load, its error, and the region whose own file it is', () => {
	const error = new TypeError('Failed to fetch dynamically imported module');
	const url = new URL('/_app/immutable/og-region.a.js?og-retry=2', location.href).href;
	say_reload_needed(url, error);
	expect(heard).toHaveLength(1);
	expect(heard[0].url).toBe(url);
	expect(heard[0].error).toBe(error);
	expect(heard[0].regions).toEqual([host.firstElementChild]);
	expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain('chunk_reload_needed');
});

it('a chunk that is no region’s own file is heard with no regions', () => {
	say_reload_needed(new URL('/_app/immutable/chunks/dep.js', location.href).href, null);
	expect(heard).toHaveLength(1);
	expect(heard[0].regions).toEqual([]);
});

it('a page where every load lands never hears it', async () => {
	const load = import_again(() => Promise.resolve({ ok: true }));
	expect(await load()).toEqual({ ok: true });
	expect(await load()).toEqual({ ok: true });
	expect(heard).toEqual([]);
});
