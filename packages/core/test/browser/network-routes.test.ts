import { expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const within = (p: Promise<unknown>, ms: number): Promise<string> =>
	Promise.race([
		p.then(
			() => 'landed',
			() => 'failed'
		),
		new Promise<string>((r) => setTimeout(() => r('stranded'), ms))
	]);

it_with_network_routes(
	'module loads in flight while a network rule goes on and comes off again all land (Chromium once stranded one, and an island waiting on its graph never woke)',
	async () => {
		let stop = false;
		let stranded = 0;
		let loads = 0;
		const load_in_turn = async (lane: number) => {
			while (!stop) {
				const batch = Array.from(
					{ length: 8 },
					() => import(/* @vite-ignore */ `/src/ref-sink.ts?lane=${lane}-${loads++}`)
				);
				const out = await Promise.all(batch.map((b) => within(b, 4000)));
				stranded += out.filter((o) => o === 'stranded').length;
			}
		};
		const lanes = [0, 1, 2, 3].map(load_in_turn);
		for (let i = 0; i < 150; i++) {
			await commands.drop_downloads('/network-routes-matches-nothing', 0);
			await commands.keep_downloads('/network-routes-matches-nothing');
		}
		stop = true;
		await Promise.all(lanes);
		expect(loads).toBeGreaterThan(0);
		expect(stranded).toBe(0);
	},
	60_000
);
