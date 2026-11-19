// FOUND BY THE SIMULATOR (palaestra, seed 346199490; #2116), shrunk to 7 actions: the visitor goes
// to /frame-batch, and one of its holes' answers comes with a changed byte, `data-ogygia-region-css`
// as `data ogygia-region-css`. The hole's sheet is then no longer ogygia's to lift into the head, and
// stays as a `<style>` in the body. Bytes no server wrote are the network's, as a changed byte in
// the document's own HTML is: html-kept sets the document aside. (Skipped without the app built.)
//
//   1. new tab at /island-children    5. tab 2: click link #36
//   2. new tab at /router-links       6. tab 2: click link #876
//   3. tab 2: click link #3           7. tab 2: go to /frame-batch
//   4. tab 2: click link #428
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 346199490;
const PLAN: Plan = {
	actions: [
		{ kind: 'open', path: '/island-children' },
		{ kind: 'open', path: '/router-links' },
		{ kind: 'click', tab: 2, nth: 3, names: ['link /about @1'] },
		{ kind: 'click', tab: 2, nth: 428, names: ['link / @1'] },
		{ kind: 'click', tab: 2, nth: 36, names: ['link /'] },
		{ kind: 'click', tab: 2, nth: 876, names: ['link /'] },
		{ kind: 'goto', tab: 2, path: '/frame-batch' }
	],
	idle: true
};

describe.skipIf(!ready)('found: a hole answer a changed byte reached', () => {
	it('puts no finding of the page’s HTML on the page (6ac8849d58)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === '6ac8849d58')).toEqual([]);
	}, 300_000);
});
