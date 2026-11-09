// WHETHER A FAILED IMPORT'S FILE CAME (runtime/import-again.ts `response_of`): the loader asks a
// file again under a fresh URL only when its download got no response (a dropped connection); a
// file the server answered for (a 404) is the caller's to recover. Read from the browser's resource
// timing, which each engine fills its own way: a download dropped at the network must read as "no
// response" in every one (Firefox gives it a response start, with a status of 0).
import { afterEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { response_of } from '../../src/runtime/import-again.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

afterEach(() => commands.keep_downloads('/fixtures/entry-current.ts'));

it_with_network_routes('a download dropped at the network reads as no response', async () => {
	await commands.drop_downloads('/fixtures/entry-current.ts', 1);
	const url = new URL('./fixtures/entry-current.ts?dropped=1', import.meta.url).href;
	await expect(import(/* @vite-ignore */ url)).rejects.toBeTruthy();
	expect(response_of(url)).toBeNull();
});

it_with_network_routes('a file the server answered for reads as its status', async () => {
	const url = new URL('./fixtures/chunks/Nope9999.js', import.meta.url).href;
	await expect(import(/* @vite-ignore */ url)).rejects.toBeTruthy();
	// (WebKit reports no status: 0, "answered, status unknown")
	expect([404, 0]).toContain(response_of(url));
});
