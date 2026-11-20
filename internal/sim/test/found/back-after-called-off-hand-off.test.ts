// FOUND BY THE SIMULATOR (palaestra, seed 231920983, 40 actions; #2139): the router hands a click
// on /dashboard/orders to the browser (`router.commit-throws`), and that page's answer stalls.
// The visitor goes back meanwhile, to /forms, an entry the router made on the page it left. A
// browser calls the hand-off off and its router shows /forms; the simulator had unloaded that page,
// and only moved the address over the called-off page's blank document, then forward to
// /dashboard/orders the same (mpa-equivalence: `<html>` against `<html lang="en">`).
// test/superseded-navigation.node.test.ts holds the shrunk case. (Skipped without the app built.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

describe.skipIf(!ready)('found: back to a router entry while a hand-off is on its way', () => {
	it('shows the router entry, and forward the next one (4a8aa8124c)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(231920983, 40);
		expect(res.broken.filter((b) => b.oracle !== 'known' && signature(b) === '4a8aa8124c')).toEqual(
			[]
		);
	}, 300_000);
});
