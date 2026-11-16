/**
 * Region's grid: every combination of its inputs, server, client and hydration, in full. Core's
 * `e2e` task runs these files (scripts/region-grid.ts, an e2e slice per part in CI); the unit run
 * (`check`, and the browser jobs in the other engines) leaves them out unless OGYGIA_REGION_GRID is
 * `full`, so a whole grid never shares a runner with every other package's unit tests.
 */
export const REGION_GRID_FILES: readonly string[] = [
	'test/region-grid.test.ts',
	'test/browser/region-grid-client.test.ts',
	'test/browser/region-grid-hydrate.test.ts'
];

/** Whether this run is the grid's: OGYGIA_REGION_GRID=full. */
export const region_grid_run = (env: NodeJS.ProcessEnv): boolean =>
	env.OGYGIA_REGION_GRID === 'full';
