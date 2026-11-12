// DETERMINISM: the same app compiled twice, cold, gives the same decisions and the same bytes,
// whatever order the directories list in and the modules are transformed in. A failure prints the
// shrunk app shape and the seed; it becomes a seeded test named for what differed.
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { memory_fs } from '../../../packages/compiler/src/compiler/index.ts';
import { app_files, app_shape } from '../src/app.ts';
import { modules, session, snapshot, transform, type Leg } from '../src/session.ts';
import { permute, rng, shuffled } from '../src/order.ts';

const LEGS: readonly Leg[] = ['ssr', 'client'];

/** A cold compile: prescan, then every module for both legs, in `order`. */
function cold(files: Record<string, string>, order_seed: number | null): unknown {
	const disk = memory_fs(files);
	const fs = order_seed === null ? disk : shuffled(disk, order_seed);
	const s = session(fs);
	s.compiler.prescan();
	let jobs = modules(disk).flatMap((f) => LEGS.map((leg) => [f, leg] as const));
	if (order_seed !== null) jobs = permute(jobs, rng(order_seed ^ 0x9e3779b9));
	for (const [f, leg] of jobs) transform(s, f, leg);
	return snapshot(s);
}

describe('the compiler is deterministic', () => {
	test('two cold compiles of one app agree', () => {
		fc.assert(
			fc.property(app_shape, (shape) => {
				const files = app_files(shape);
				expect(cold(files, null)).toEqual(cold(files, null));
			}),
			{ numRuns: 60 }
		);
	});

	test('directory order and transform order change nothing', () => {
		fc.assert(
			fc.property(app_shape, fc.nat(), (shape, seed) => {
				const files = app_files(shape);
				expect(cold(files, seed)).toEqual(cold(files, null));
			}),
			{ numRuns: 100 }
		);
	});
});
