import { afterEach, beforeEach, expect, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { region_fragment } from './_html.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const SHEET = '/region-sheet-wait-held.css';
const answer = `<link rel="stylesheet" href="${SHEET}" data-ogygia-region-css><p>answer</p>`;
const sheets = () => document.head.querySelectorAll(`link[href="${SHEET}"]`);
const settled = (p: Promise<unknown>) => {
	let done = false;
	void p.then(() => (done = true));
	return () => done;
};

beforeEach(() => {
	vi.stubEnv('DEV', false);
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	link_boot();
});
afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	await commands.keep_downloads(SHEET);
	for (const l of sheets()) l.remove();
});

it_with_network_routes(
	'a region sheet that never loads holds its answer 5 s, then the answer paints',
	async () => {
		await commands.hold_downloads(SHEET);
		const ready = settled(region_fragment(answer).ready);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(ready()).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect.poll(ready).toBe(true);
	}
);

it_with_network_routes(
	'a region sheet’s wait ends at once when the page it was for is left',
	async () => {
		await commands.hold_downloads(SHEET);
		const ready = settled(region_fragment(answer).ready);
		await vi.advanceTimersByTimeAsync(10);
		expect(ready()).toBe(false);
		runtime_session.reset();
		await expect.poll(ready).toBe(true);
	}
);
