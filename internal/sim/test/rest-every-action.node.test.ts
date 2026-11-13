// What the world owes at rest is judged at every rest, not only the run's last: a page the visitor
// left before the end was never judged at rest (an island in its margin band that never woke, core.ts
// `#on_visible` dropping the margin, survived every run). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/cli.ts';

const APP = fileURLToPath(new URL('../../../apps/palaestra', import.meta.url));
const built = existsSync(`${APP}/.svelte-kit/output/server/index.js`);

describe.skipIf(!built)('the at-rest oracles', () => {
	it('judge a page the visitor leaves before the end, once the world is at rest on it', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'goto', tab: 0, path: '/' },
				{ kind: 'goto', tab: 0, path: '/context/lake' }
			]
		};
		const res = await run(1, 2, Infinity, undefined, plan);
		// (the first page, left by the second action)
		expect(res.log.some((l) => l.endsWith('at rest after tab 0: go to /'))).toBe(true);
	}, 300_000);

	it('do not judge a world a tab is offline in: what it owes waits for the network', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'offline', tab: 0 },
				{ kind: 'goto', tab: 0, path: '/' }
			]
		};
		const res = await run(1, 2, Infinity, undefined, plan);
		expect(res.log.some((l) => l.includes('at rest after'))).toBe(false);
	}, 300_000);
});
