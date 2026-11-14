// An interaction island whose replay code cannot load: the wake's failure is said, the replay is asked
// for once more, and when that fails too the clicks are lost and said so, never left as an unhandled
// rejection. Its own file: the replay chunk's failed download stays in this frame's module map.
import { afterEach, expect, inject, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { PLAYWRIGHT, it_with_network_routes } from './_browsers.ts';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const REPLAY = '/src/runtime/interaction-replay.ts';

afterEach(async () => {
	vi.restoreAllMocks();
	if (PLAYWRIGHT) await commands.keep_downloads(REPLAY);
});

it_with_network_routes(
	'a replay that fails to load twice is said twice, and nothing is left unhandled',
	async () => {
		await commands.drop_downloads(REPLAY, 10);
		const errors: string[] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			errors.push(a.map(String).join(' '));
		});
		document.body.innerHTML = from_b64(inject('counter_ssr_b64')).replace(
			'wake="load"',
			'wake="interaction"'
		);
		bootDev();
		document
			.querySelector('ogygia-region button')!
			.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await expect
			.poll(() => errors.filter((e) => e.includes('interaction_hydrate_failed')).length, {
				timeout: 10_000
			})
			.toBe(2);
	}
);
