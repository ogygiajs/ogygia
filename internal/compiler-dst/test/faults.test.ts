// THE DISK AND THE WATCHER FAIL, AND DEV STILL MATCHES A COLD START: a dev server whose compiler read
// files through disk faults (a read that fails, a file gone between its stat and its read, a
// half-written file) while a faulty watcher lost, doubled and reordered the saves of a run of edits,
// once the disk settles and each file it saw wrong is saved again, serves what a fresh dev server on
// the final files serves. A failure prints the shrunk shapes, the seed and the faults taken.
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { app_files, app_shape } from '../src/app.ts';
import { snapshot } from '../src/session.ts';
import { cold_server, dev_server, edit, grow_only_missing, type Server } from '../src/dev.ts';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { permute, rng } from '../src/order.ts';
import { faulty_fs, owed, WATCH_FAULTS, watched, type FaultyFs } from '../src/faults.ts';
import { memory_fs } from '../../../packages/compiler/src/index.ts';

const RUNS = (ci: number) => Number(process.env.DST_RUNS) || ci;

const seen = (server: Server) => snapshot(server.s, server.served());

function saves(
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

describe('the fault layer', () => {
	test('takes each disk fault on a file that is there, and none once calm', () => {
		const disk = memory_fs({ '/a/x.svelte': '<p>hello</p>' });
		const fs = faulty_fs(disk, () => 0, { rate: 1, faults: ['half-written'] });
		const half = fs.read('/a/x.svelte')!;
		expect(half.length).toBeLessThan('<p>hello</p>'.length);
		expect('<p>hello</p>'.startsWith(half)).toBe(true);
		expect(fs.read('/a/missing.svelte')).toBeNull();
		const gone = faulty_fs(disk, () => 0, { rate: 1, faults: ['gone-after-stat'] });
		expect(gone.stat('/a/x.svelte')).toBe('file');
		expect(gone.read('/a/x.svelte')).toBeNull();
		expect(gone.read('/a/x.svelte')).toBe('<p>hello</p>');
		fs.calm();
		expect(fs.read('/a/x.svelte')).toBe('<p>hello</p>');
		expect([...fs.touched]).toEqual(['/a/x.svelte']);
	});

	test('a watcher loses only a change to a file that was there, never a create or a delete', () => {
		const run: [string, string | null][] = [
			['/a/x', 'one'],
			['/a/y', null],
			['/a/new', 'two']
		];
		const { deliveries } = watched(run, () => 0, {
			rate: 1,
			faults: ['lost'],
			there: (f) => f !== '/a/new'
		});
		expect(deliveries.map((d) => [d.file, d.heard])).toEqual([
			['/a/x', false],
			['/a/y', true],
			['/a/new', true]
		]);
	});
});

describe('a lost watcher event, then the file saved again', () => {
	test("a lake's wrapper served null while no host held it is served once a later save registers it (#1706)", async () => {
		const A = '/dst-app/src';
		const C0 = `${A}/lib/C0.svelte`;
		const C1 = `${A}/lib/C1.svelte`;
		const PAGE = `${A}/routes/+page.svelte`;
		const lake_of = (from: string) =>
			`${dedent`
			<script>
			import C1 from '${from}' with { wake: 'none' };
			</script>
			<C1 />
		`}\n`;
		const dev = dev_server({
			[C0]: lake_of('./C1.svelte'),
			[C1]: '<p>C1</p>\n',
			[PAGE]: '<h1>page</h1>\n'
		});
		await dev.serve();
		dev.fs.set(C0, '<p>C0</p>\n');
		edit(dev, C1, null);
		await dev.serve();
		edit(dev, C1, '<p>C1</p>\n');
		dev.fs.set(PAGE, lake_of('$lib/C1.svelte'));
		await dev.serve();
		for (const f of [C0, PAGE]) edit(dev, f, dev.fs.read(f));
		await dev.serve();
		const files = Object.fromEntries([C0, C1, PAGE].map((f) => [f, dev.fs.read(f)!]));
		expect(seen(dev)).toEqual(seen(await cold_server(files, { dev: true, widen: dev.s })));
	});
});

describe('dev matches a cold start through disk and watcher faults', () => {
	test('after any run of edits, once each file seen wrong is saved again', async () => {
		await fc.assert(
			fc.asyncProperty(
				app_shape,
				fc.array(app_shape, { minLength: 1, maxLength: 2 }),
				fc.nat(),
				fc.constantFrom(0.05, 0.2),
				async (first, next, seed, rate) => {
					let files = app_files(first);
					const draws = rng(seed ^ 0x5eed);
					let faulty: FaultyFs | null = null;
					const dev = dev_server(files, (disk) => (faulty = faulty_fs(disk, draws, { rate })));
					const fs = faulty!;
					await dev.serve();
					const all: ReturnType<typeof watched>['deliveries'] = [];
					const wlog: string[] = [];
					for (const [i, shape] of next.entries()) {
						const to = app_files(shape);
						const before = files;
						const { deliveries, log } = watched(saves(files, to, seed + i), draws, {
							rate,
							faults: WATCH_FAULTS,
							there: (f) => before[f] !== undefined
						});
						all.push(...deliveries);
						wlog.push(...log);
						for (const d of deliveries)
							if (d.heard) edit(dev, d.file, d.text);
							else dev.fs.set(d.file, d.text);
						files = to;
						await dev.serve();
					}
					fs.calm();
					for (const f of owed(fs, all, dev.fs)) edit(dev, f, dev.fs.read(f));
					await dev.serve();
					const taken = [...fs.log, ...wlog].join('; ');
					const cold = await cold_server(files, { dev: true });
					expect(grow_only_missing(dev.s, cold.s), taken).toEqual([]);
					expect(seen(dev), taken).toEqual(
						seen(await cold_server(files, { dev: true, widen: dev.s }))
					);
				}
			),
			{ numRuns: RUNS(40) }
		);
	});
});
