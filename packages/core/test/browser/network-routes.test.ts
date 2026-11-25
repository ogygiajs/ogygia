import { expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

it_with_network_routes(
	'module loads in flight while a network rule goes on and comes off again all land (Chromium once stranded one, and an island waiting on its graph never woke)',
	async () => {
		let stop = false;
		let started = 0;
		let open = 0;
		const load = (lane: number) => {
			started++;
			open++;
			const done = () => void open--;
			const loading = import(/* @vite-ignore */ `/src/ref-sink.ts?lane=${lane}-${started}`);
			loading.then(done, done);
			return loading;
		};
		const load_in_turn = async (lane: number) => {
			while (!stop) {
				const batch = Array.from({ length: 8 }, () => load(lane));
				await Promise.race([Promise.allSettled(batch), pause(500)]);
			}
		};
		const lanes = [0, 1, 2, 3].map(load_in_turn);
		for (let i = 0; i < 150; i++) {
			await commands.drop_downloads('/network-routes-matches-nothing', 0);
			await commands.keep_downloads('/network-routes-matches-nothing');
		}
		stop = true;
		await Promise.all(lanes);
		for (let waited = 0; open > 0 && waited < 30_000; waited += 100) await pause(100);
		expect(started).toBeGreaterThan(0);
		expect({ never_landed: open }).toEqual({ never_landed: 0 });
	},
	120_000
);
