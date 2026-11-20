// FOUND BY THE SIMULATOR (palaestra with `pnpm sim:builds`, seed 940000092), shrunk to 9 actions:
// after a deploy whose old files are gone, a tab goes back to a page of the old build, and a
// region file it had asked for before (now a 404) is preloaded again. The simulator's module loader
// had already failed that file, and handed happy-dom its own words ("<url>: status 404"), which
// happy-dom's failed modulepreload said as the page's error; a failed download is said as the DOM
// library says one ("Failed to perform request"), which a deploy explains. (Skipped without the app
// built; without its two builds there is no deploy.)
//
//   1. new tab at /nav-batch                          6. tab 0: press #491, then an outage
//   2. tab 0: click link #733                            500 ms in, for 120000 ms
//   3. tab 1: follow link #647, come back 20000 ms    7. deploy the next build
//   4. new tab at /dup                                8. tab 1: forward
//   5. tab 0: click link #366                         9. tab 1: follow link #112, come back 20000 ms
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 940000092;
const PLAN: Plan = {
	actions: [
		{ kind: 'open', path: '/nav-batch' },
		{ kind: 'click', tab: 0, nth: 733, names: ['link /about'] },
		{ kind: 'away', tab: 1, nth: 647, ms: 20000, names: ['link /plain'] },
		{ kind: 'open', path: '/dup' },
		{ kind: 'click', tab: 0, nth: 366, names: ['link /data'] },
		{
			kind: 'outage',
			tab: 0,
			during: 'press',
			nth: 491,
			after: 500,
			lasts: 120000,
			names: ['button og-region "bump +1 (command → refresh)"']
		},
		{ kind: 'deploy' },
		{ kind: 'forward', tab: 1 },
		{ kind: 'away', tab: 1, nth: 112, ms: 20000, names: ['link /nested'] }
	],
	idle: true
};

describe.skipIf(!ready)('found: a region file a deploy took, preloaded again', () => {
	it('fails as a download the deploy explains (73b3398100)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === '73b3398100')).toEqual([]);
	}, 300_000);
});
