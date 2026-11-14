// DETERMINISM: the same app compiled twice, cold, gives the same decisions and the same bytes,
// whatever order the directories list in and the modules are transformed in. A failure prints the
// shrunk app shape and the seed; it becomes a seeded test named for what differed.
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { memory_fs } from '../../../packages/compiler/src/index.ts';
import { app_files, app_shape } from '../src/app.ts';
import { modules, session, snapshot, transform, type Leg, type Session } from '../src/session.ts';
import { permute, rng } from '../src/order.ts';
import { shuffled } from '../src/order.ts';

const LEGS: readonly Leg[] = ['ssr', 'client'];
/** CI's count, or `DST_RUNS` for a long local search. */
const RUNS = (ci: number) => Number(process.env.DST_RUNS) || ci;

/** A cold compile: prescan, then every module for both legs, in `order`. */
async function cold(files: Record<string, string>, order_seed: number | null): Promise<unknown> {
	const disk = memory_fs(files);
	const fs = order_seed === null ? disk : shuffled(disk, order_seed);
	const s = session(fs);
	s.compiler.prescan();
	let jobs = modules(disk).flatMap((f) => LEGS.map((leg) => [f, leg] as const));
	if (order_seed !== null) jobs = permute(jobs, rng(order_seed ^ 0x9e3779b9));
	for (const [f, leg] of jobs) await transform(s, f, leg);
	return { compile: snapshot(s), entries: LEGS.map((leg) => entries(s, leg)) };
}

/** The leg's entry locations as the handoff writes them, in their order (bytes, not a set). */
function entries(s: Session, name: Leg): string | null {
	const leg = s.compiler.find_leg(name);
	if (leg === undefined) return null;
	const e = s.compiler.entry_locations(leg, (ref) => ref);
	return JSON.stringify({ islands: [...e.islands], locations: e.locations });
}

describe('the compiler is deterministic', () => {
	test('two cold compiles of one app agree', async () => {
		await fc.assert(
			fc.asyncProperty(app_shape, async (shape) => {
				const files = app_files(shape);
				expect(await cold(files, null)).toEqual(await cold(files, null));
			}),
			{ numRuns: RUNS(60) }
		);
	});

	test('directory order and transform order change nothing', async () => {
		await fc.assert(
			fc.asyncProperty(app_shape, fc.nat(), async (shape, seed) => {
				const files = app_files(shape);
				expect(await cold(files, seed)).toEqual(await cold(files, null));
			}),
			{ numRuns: RUNS(100) }
		);
	});
});
