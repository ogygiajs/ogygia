// A PRESS THAT CLICKED NOTHING IS NO PRESS (#1038): a `press` drawn on a page with no region button
// clicks nothing, so the document is still the server's, and its at-rest checks (the MPA check,
// the leak check) still judge it. Before, every `press` marked the visitor's tabs as pressed, and a
// divergence on that document went unreported. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/cli.ts';
import { World } from '../src/world.ts';
import { act, buttons } from '../src/workload.ts';

const APP = fileURLToPath(new URL('../../../apps/palaestra', import.meta.url));
const OUTPUT = `${APP}/.svelte-kit/output`;
const built = existsSync(`${OUTPUT}/server/index.js`);
const ORIGIN = 'https://app.test';
/** A palaestra page with no region button (checked below), and one with. */
const NO_BUTTON = '/element-order';
const A_BUTTON = '/hole-css';

describe.skipIf(!built)('a press that clicked nothing', () => {
	it('says it pressed nothing on a page with no region button, and that it pressed on one with', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('v');
			const tab = world.tab(v);
			await world.go(tab, 'goto', NO_BUTTON);
			expect(buttons(tab), `${NO_BUTTON} has no region button`).toEqual([]);
			const none = await act(world, v, { kind: 'press', tab: 0, nth: 0 }, ORIGIN);
			expect(none.pressed).toBe(false);
			await world.go(tab, 'goto', A_BUTTON);
			expect(buttons(tab).length, `${A_BUTTON} has a region button`).toBeGreaterThan(0);
			const one = await act(world, v, { kind: 'press', tab: 0, nth: 0 }, ORIGIN);
			expect(one.pressed).toBe(true);
		} finally {
			await world.end();
		}
	});

	it('leaves the document judged at rest: the MPA check runs on it (#1038)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'goto', tab: 0, path: NO_BUTTON },
				{ kind: 'press', tab: 0, nth: 0 }
			]
		};
		const res = await run(1, 2, Infinity, undefined, plan);
		expect(
			res.log.some((l) => l.endsWith(`${ORIGIN}${NO_BUTTON} judged against a fresh load`))
		).toBe(true);
	}, 300_000);
});
