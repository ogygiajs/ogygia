// DETERMINISM: the same app compiled twice, cold, gives the same decisions and the same bytes,
// whatever order the directories list in, the modules are transformed in, and the bundle lists its
// modules and their imports in at the end of a leg. A failure prints the shrunk app shape and the
// seed; it becomes a seeded test named for what differed.
import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { memory_fs } from '../../../packages/compiler/src/index.ts';
import { app_files, app_shape, LIB } from '../src/app.ts';
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

	test("the bundle's module and import order changes no relocation, and each hole reads what its tree reads", async () => {
		await fc.assert(
			fc.asyncProperty(
				app_shape,
				fc.array(fc.boolean(), { maxLength: 4 }),
				fc.nat(),
				async (shape, reading, seed) => {
					const files = app_files(shape);
					const readers = new Set(reading.flatMap((r, i) => (r ? [`${LIB}/C${i}.svelte`] : [])));
					const s = await compiled(files, readers);
					const graph = bundle_graph(files);
					const sorted = page_data_reads(s, graph, null);
					expect(page_data_reads(s, graph, seed)).toEqual(sorted);
					expect(sorted).toEqual(holes_reading(s, graph, readers));
				}
			),
			{ numRuns: RUNS(100) }
		);
	});

	test('#2111: a hole whose child reads the page looks it up, its style sub-module listed after it', async () => {
		const files = app_files({
			components: [
				{ uses: [], state: false },
				{ uses: [{ component: 2, mark: 'plain' }], state: false },
				{ uses: [], state: false }
			],
			routes: [
				{
					dir: '',
					page: true,
					layout: false,
					page_csr: 'unset',
					layout_csr: 'unset',
					uses: [{ component: 1, mark: 'deferred' }]
				}
			],
			pages: []
		});
		const readers = new Set([`${LIB}/C2.svelte`]);
		const s = await compiled(files, readers);
		const answers = page_data_reads(s, bundle_graph(files), null);
		expect(Object.values(answers as Record<string, boolean>)).toEqual([true]);
	});
});

/** A cold compile in sorted order, kept to link against, with a seed-shaping plugin that answers
 *  `readers` read the page's `a`. */
async function compiled(
	files: Record<string, string>,
	readers: ReadonlySet<string>
): Promise<Session> {
	const disk = memory_fs(files);
	const s = session(disk, {
		page_reads: { module() {}, keys: (id) => (readers.has(id) ? new Set(['a']) : null) }
	});
	s.compiler.prescan();
	for (const f of modules(disk)) for (const leg of LEGS) await transform(s, f, leg);
	return s;
}

type Graph = Record<string, { importedIds: string[]; dynamicallyImportedIds: string[] }>;

const STYLE = '?svelte&type=style&lang.css';
const IMPORT_RE = /from '(?:\.\/|\$lib\/)(C\d+\.svelte)'/g;

/** The server bundle's graph as Vite hands it over: each app file with the files it imports, and
 *  each component's style sub-module under the same path (`?svelte&type=style`). */
function bundle_graph(files: Record<string, string>): Graph {
	const graph: Graph = {};
	for (const [file, code] of Object.entries(files)) {
		const imports = [...code.matchAll(IMPORT_RE)].map((m) => `${LIB}/${m[1]}`);
		if (file.endsWith('.svelte')) {
			imports.push(file + STYLE);
			graph[file + STYLE] = { importedIds: [], dynamicallyImportedIds: [] };
		}
		graph[file] = { importedIds: imports, dynamicallyImportedIds: [] };
	}
	return graph;
}

const PLACEHOLDER =
	'(() => { try { return JSON.parse("__OGYGIA_PAGE_DATA_READS__"); } catch { return null; } })()';

/** The server manifest's page-data answers, the bundle listing its modules and each module's
 *  imports in a seeded order (`null`: sorted). */
function page_data_reads(s: Session, graph: Graph, order_seed: number | null): unknown {
	const next = order_seed === null ? null : rng(order_seed);
	const order = (xs: readonly string[]) => (next ? permute(xs, next) : [...xs].sort());
	const listed: Graph = {};
	for (const id of order(Object.keys(graph)))
		listed[id] = {
			importedIds: order(graph[id].importedIds),
			dynamicallyImportedIds: order(graph[id].dynamicallyImportedIds)
		};
	const out = s.compiler.relocate(PLACEHOLDER, s.compiler.find_leg('ssr')!, {
		graph: (id) => listed[id] ?? null,
		module_ids: () => Object.keys(listed),
		chunk_file: 'manifest.js',
		file_name: String,
		facade_file: () => undefined
	});
	if (out === null) return null;
	const literal = out.code.slice(out.code.indexOf('JSON.parse(') + 'JSON.parse('.length);
	return JSON.parse(JSON.parse(literal.slice(0, literal.indexOf('); }'))));
}

/** The oracle: a hole reads the page when any file its component reaches is a reader. */
function holes_reading(
	s: Session,
	graph: Graph,
	readers: ReadonlySet<string>
): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const [iid, virtual_path] of s.program.by_id) {
		const reg = s.program.registry.get(virtual_path);
		if (!reg?.server) continue;
		const seen = new Set<string>([reg.componentPath!]);
		for (const id of seen) for (const next of graph[id]?.importedIds ?? []) seen.add(next);
		out[iid] = [...seen].some((id) => readers.has(id));
	}
	return out;
}
