// Kit's env reader loads its warning's chunk only when it has something to say (runtime/kit-env.ts),
// so a page that reads its env loads nothing more. Its own file: the chunk's failed download stays in
// this frame's module map.
import { afterEach, expect, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { PLAYWRIGHT, it_with_network_routes } from './_browsers.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const WARNING = '/src/messages/lazy.ts';

afterEach(async () => {
	vi.restoreAllMocks();
	if (PLAYWRIGHT) await commands.keep_downloads(WARNING);
});

it_with_network_routes(
	'a page with no env channel whose warning chunk does not load still reads an empty env, and leaves nothing unhandled',
	async () => {
		await commands.drop_downloads(WARNING, 10);
		const unhandled: unknown[] = [];
		const on = (e: PromiseRejectionEvent) => void unhandled.push(e.reason);
		window.addEventListener('unhandledrejection', on);
		try {
			const { kit_env } = await import('../../src/runtime/kit-env.ts');
			expect(kit_env('a-build')).toEqual({});
			// (the same module, asked for again: it settles once the reader's own ask failed)
			await expect(import('../../src/messages/lazy.ts')).rejects.toBeTruthy();
			await new Promise((r) => setTimeout(r, 50));
			expect(unhandled).toEqual([]);
		} finally {
			window.removeEventListener('unhandledrejection', on);
		}
	}
);
