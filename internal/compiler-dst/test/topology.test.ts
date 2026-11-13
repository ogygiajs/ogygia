// TOPOLOGY: Kit 2 (a plugin instance per leg) and Kit 3 (one instance, both legs) serve each leg
// the same modules and emit the same chunks. A failure prints the shrunk app shape.
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { app_files, app_shape } from '../src/app.ts';
import { kit2, kit3 } from '../src/topology.ts';

const RUNS = (ci: number) => Number(process.env.DST_RUNS) || ci;

describe("the build's topology changes nothing", () => {
	test('Kit 2 and Kit 3 agree', async () => {
		await fc.assert(
			fc.asyncProperty(app_shape, async (shape) => {
				const files = app_files(shape);
				expect(await kit2(files)).toEqual(await kit3(files));
			}),
			{ numRuns: RUNS(60) }
		);
	});

	test('the order modules are requested in changes no byte a leg is served', async () => {
		await fc.assert(
			fc.asyncProperty(app_shape, fc.nat(), async (shape, seed) => {
				const files = app_files(shape);
				expect(await kit3(files, seed)).toEqual(await kit3(files));
			}),
			{ numRuns: RUNS(60) }
		);
	});
});
