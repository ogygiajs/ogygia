// DEV MATCHES A COLD START: a dev server that saw a run of edits (files added, changed, deleted, one
// at a time as an editor saves them) serves what a fresh dev server on the final files serves, and
// knows the same registry, marks and route worlds. A failure prints the shrunk shapes and the seed.
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { app_files, app_shape } from '../src/app.ts';
import { snapshot } from '../src/session.ts';
import { cold_server, dev_server, edit, grow_only_missing, type Server } from '../src/dev.ts';
import { permute, rng } from '../src/order.ts';

const RUNS = (ci: number) => Number(process.env.DST_RUNS) || ci;

const seen = (server: Server) => snapshot(server.s, server.served());

/** The edits from `from` to `to`, one per file that differs, in a seeded order. */
function edits(
	from: Record<string, string>,
	to: Record<string, string>,
	seed: number
): [string, string | null][] {
	const out: [string, string | null][] = [];
	for (const f of new Set([...Object.keys(from), ...Object.keys(to)]))
		if (from[f] !== to[f]) out.push([f, to[f] ?? null]);
	return permute(
		out.sort(([a], [b]) => (a < b ? -1 : 1)),
		rng(seed)
	);
}

describe('dev matches a cold start', () => {
	test('after any run of edits', async () => {
		await fc.assert(
			fc.asyncProperty(
				app_shape,
				fc.array(app_shape, { minLength: 1, maxLength: 3 }),
				fc.nat(),
				async (first, next, seed) => {
					let files = app_files(first);
					const dev = dev_server(files);
					await dev.serve();
					for (const [i, shape] of next.entries()) {
						const to = app_files(shape);
						for (const [f, text] of edits(files, to, seed + i)) edit(dev, f, text);
						files = to;
						await dev.serve();
						const cold = await cold_server(files, { dev: true });
						expect(grow_only_missing(dev.s, cold.s)).toEqual([]);
						expect(seen(dev)).toEqual(seen(await cold_server(files, { dev: true, widen: dev.s })));
					}
				}
			),
			{ numRuns: RUNS(40) }
		);
	});
});
