// An interaction island whose replay code cannot load: the wake's failure is said, the replay is asked
// for once more, and when that fails too the clicks are lost and said so, never left as an unhandled
// rejection. Its own file: the replay chunk's failed download stays in this frame's module map.
import { afterEach, expect, inject, onTestFinished, vi } from 'vitest';
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
/** The dev runtime's guard against reloading a tab twice in a row (runtime/stale-deps.ts): set, an
 *  island that fails to load stays failed here instead of reloading the test's frame. */
const DEV_RELOADED_AT = 'ogygia:dev:dep-reload';

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

it_with_network_routes(
	'an island a visitor woke still comes alive when its replay code cannot load',
	async () => {
		sessionStorage.setItem(DEV_RELOADED_AT, String(Date.now()));
		onTestFinished(() => sessionStorage.removeItem(DEV_RELOADED_AT));
		await commands.drop_downloads(REPLAY, 10);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		document.body.innerHTML = from_b64(inject('counter_ssr_b64')).replace(
			'wake="load"',
			'wake="interaction"'
		);
		bootDev();
		const region = document.querySelector('ogygia-region')!;
		region
			.querySelector('button')!
			.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await expect.poll(() => region.hasAttribute('data-hydrated'), { timeout: 30_000 }).toBe(true);
		const count = region.querySelector('[data-testid="count"]')!;
		const before = Number(count.textContent);
		region.querySelector('button')!.click();
		await expect.poll(() => Number(count.textContent)).toBe(before + 1);
	},
	45_000
);
