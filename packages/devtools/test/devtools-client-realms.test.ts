import { describe, expect, it } from 'vitest';
import { devtools } from '../src/vite.ts';
import beacon_realm from '../src/client-beacon.ts';

const BEACON_HOOKS = [
	'criticalSettled',
	'entryFallback',
	'holeAnswered',
	'holeBatchMissed',
	'holeFailed',
	'navigated',
	'regionFailed',
	'regionHydrated',
	'warning'
];

const client_of = (options?: Parameters<typeof devtools>[0]) =>
	(devtools(options)[0] as unknown as Record<symbol, { client?: string }>)[
		Symbol.for('ogygia.plugin')
	].client;

describe("devtools' browser realms", () => {
	it('without the dock the build registers the beacon realm, which subscribes to the beacon hooks alone', () => {
		expect(client_of({ dock: false, profiler: true })).toMatch(/\/client-beacon\.(ts|js)$/);
		expect(Object.keys(beacon_realm.hooks ?? {}).sort()).toEqual(BEACON_HOOKS);
	});

	it('with the dock the build registers the dock realm', () => {
		expect(client_of()).toMatch(/\/client\.(ts|js)$/);
	});
});
