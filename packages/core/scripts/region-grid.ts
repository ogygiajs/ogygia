/**
 * Core's `e2e` task: Region's FULL grid (test/region-grid.test.ts and the browser grids beside it),
 * server, client and hydration, Svelte's async compile on and off, in the engines OGYGIA_BROWSERS
 * names, one part of it when E2E_SHARD says `<i>/<n>` (an e2e slice per part: .github/scripts/
 * ci-plan.ts). The unit run leaves the grid out (scripts/region-grid-files.ts).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REGION_GRID_FILES } from './region-grid-files.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const shard = process.env.E2E_SHARD || '1/1';
if (!/^\d+\/\d+$/.test(shard)) throw new Error(`E2E_SHARD is "${shard}": expected <i>/<n>`);
const started = Date.now();
const run = spawnSync(
	'pnpm',
	[
		'exec',
		'vitest',
		'run',
		'--project',
		'node',
		'--project',
		'node-no-async',
		'--project',
		'browser',
		'--project',
		'browser-no-async',
		...REGION_GRID_FILES
	],
	{
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, OGYGIA_REGION_GRID: 'full', OGYGIA_REGION_GRID_SHARD: shard }
	}
);
console.log(
	`region grid, part ${shard}, ${process.env.OGYGIA_BROWSERS || 'chromium'}: ${((Date.now() - started) / 1000).toFixed(0)} s`
);
process.exit(run.status ?? 1);
