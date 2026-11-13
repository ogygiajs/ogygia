// A crowd's tabs are judged as the visitor's are: looked at after each action (the trace's `dom`
// line, and the per-tab oracles with it) and at rest. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/cli.ts';

const APP = fileURLToPath(new URL('../../../apps/palaestra', import.meta.url));
const built = existsSync(`${APP}/.svelte-kit/output/server/index.js`);

const PLAN: Plan = { actions: [{ kind: 'crowd', path: '/', n: 2, spread: 50 }] };

describe.skipIf(!built)("a crowd's tabs", () => {
	it("are looked at after the action, as the visitor's are", async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		let names: string[] = [];
		const res = await run(
			1,
			1,
			Infinity,
			async (world) => {
				names = world.crowd.flatMap((c) => c.tabs.map((t) => t.name));
			},
			PLAN
		);
		expect(names).toHaveLength(2);
		for (const name of names)
			expect(res.log.some((l) => l.includes(`# ${name} https://app.test/ dom `))).toBe(true);
	}, 300_000);
});
