import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/plugin/utils';
import { island_subgraph_bytes, type ByteGraphModule } from '../src/build/region-bytes.ts';

/** Build a mock Vite dev-graph node. `code` sets `transformResult.code`; `imports` the downward edges. */
function mod(
	url: string,
	code: string | null,
	imports: ByteGraphModule[] = [],
	file?: string
): ByteGraphModule {
	return {
		url,
		file: file ?? null,
		transformResult: code == null ? null : { code },
		importedModules: imports
	};
}

describe('island_subgraph_bytes', () => {
	it('sums the component + its child app modules, not the entry glue', () => {
		const child = mod('/src/lib/Child.svelte', 'x'.repeat(100));
		const comp = mod('/src/lib/Counter.svelte', 'y'.repeat(200), [child]);
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [comp]);
		const out = island_subgraph_bytes([entry]);
		expect(out.abc123).toMatchObject({ bytes: 300, modules: 2 }); // component + child, NOT the entry glue
		// its heaviest modules, heaviest first (the served paths)
		expect(out.abc123.top).toEqual([
			{ file: 'src/lib/Counter.svelte', bytes: 200 },
			{ file: 'src/lib/Child.svelte', bytes: 100 }
		]);
		expect(out.abc123.barrels).toBeUndefined();
	});

	it('a barrel the island still imports whole: little code, many app modules behind it', () => {
		const leaves = Array.from({ length: 8 }, (_, i) =>
			mod(`/src/lib/ui/Part${i}.svelte`, 'p'.repeat(300))
		);
		const barrel = mod('/src/lib/ui/index.ts', 'e'.repeat(8 * 60), leaves);
		// a module with many imports AND real code of its own is a component, not a barrel
		const busy = mod('/src/lib/Busy.svelte', 'b'.repeat(8 * 400), leaves.slice(0, 8));
		const comp = mod('/src/lib/Toolbar.svelte', 'y'.repeat(200), [barrel, busy]);
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [comp]);
		const out = island_subgraph_bytes([entry]);
		expect(out.abc123.barrels).toEqual([{ file: 'src/lib/ui/index.ts', fanout: 8 }]);
		expect(out.abc123.top?.[0].file).toBe('src/lib/Busy.svelte');
	});

	it('a barrel row says why the barrel pass left it, joined by the barrel file and its importers', () => {
		const leaves = Array.from({ length: 8 }, (_, i) =>
			mod(`/src/lib/ui/Part${i}.svelte`, 'p'.repeat(300))
		);
		const barrel = mod(
			'/src/lib/ui/index.ts',
			'e'.repeat(8 * 60),
			leaves,
			'/app/src/lib/ui/index.ts'
		);
		const comp = mod(
			'/src/lib/Toolbar.svelte',
			'y'.repeat(200),
			[barrel],
			'/app/src/lib/Toolbar.svelte'
		);
		barrel.importers = [comp];
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [comp]);
		const asked: [string, string[]][] = [];
		const out = island_subgraph_bytes([entry], undefined, (file, importers) => {
			asked.push([file, [...importers]]);
			return file === '/app/src/lib/ui/index.ts' ? ['impure'] : [];
		});
		expect(out.abc123.barrels).toEqual([
			{ file: 'src/lib/ui/index.ts', fanout: 8, why: ['impure'] }
		]);
		expect(asked).toEqual([['/app/src/lib/ui/index.ts', ['/app/src/lib/Toolbar.svelte']]]);
	});

	it("its components' lines that draw differently in the browser, read from their sources on disk", () => {
		const clock = {
			...mod('/src/lib/Clock.svelte', 'compiled'),
			file: '/app/src/lib/Clock.svelte'
		};
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [clock]);
		const src: Record<string, string> = {
			'/app/src/lib/Clock.svelte': dedent`
					<script>
						const where = typeof window === 'undefined' ? 'server' : 'browser';
					</script>
					<p>{where}</p>
				`
		};
		expect(island_subgraph_bytes([entry], (f) => src[f]).abc123.hazards).toEqual([
			{
				file: 'src/lib/Clock.svelte',
				line: 2,
				code: "const where = typeof window === 'undefined' ? 'server' : 'browser';",
				kind: 'browser',
				reads: 'typeof window'
			}
		]);
		// no reader: no reading
		expect(island_subgraph_bytes([entry]).abc123.hazards).toBeUndefined();
	});

	it("a site-kit island (ogygia's content components): no app bytes, and still its lines", () => {
		const sidebar = {
			...mod('/@fs/repo/packages/ogygia/dist/content/site/components/Sidebar.svelte', 'compiled'),
			file: '/repo/packages/ogygia/dist/content/site/components/Sidebar.svelte'
		};
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [sidebar]);
		const src: Record<string, string> = {
			'/repo/packages/ogygia/dist/content/site/components/Sidebar.svelte': dedent`
					<script>
						let { site } = $props();
						const tree = await site.nav();
					</script>
				`
		};
		const out = island_subgraph_bytes([entry], (f) => src[f]).abc123;
		expect(out.bytes).toBe(0);
		expect(out.hazards).toEqual([
			{
				file: 'ogygia/content/site/components/Sidebar.svelte',
				line: 3,
				code: 'const tree = await site.nav();',
				kind: 'await'
			}
		]);
	});

	it('a small component composing many children is no barrel: it uses what it imports', () => {
		const leaves = Array.from({ length: 7 }, (_, i) =>
			mod(`/src/lib/demos/Demo${i}.svelte`, 'p'.repeat(300))
		);
		const hero = mod('/src/lib/demos/HeroDemo.svelte', 'h'.repeat(7 * 60), leaves);
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [hero]);
		expect(island_subgraph_bytes([entry]).abc123.barrels).toBeUndefined();
	});

	it('prunes the framework (svelte / ogygia runtime) — shared once per page, not per island', () => {
		const svelte = mod('/node_modules/svelte/src/internal.js', 'z'.repeat(9999));
		const runtime = mod('/@fs/repo/packages/ogygia/dist/runtime/core.js', 'r'.repeat(9999));
		const comp = mod('/src/lib/Counter.svelte', 'y'.repeat(200), [svelte, runtime]);
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [comp]);
		const out = island_subgraph_bytes([entry]);
		expect(out.abc123.bytes).toBe(200); // only Counter.svelte
	});

	it('prunes the shared transportables registry (would otherwise drag in the whole app)', () => {
		// The real bug: the island entry imports `ogygia:region/transportables`, which imports every
		// transportable-defining module app-wide (an 80 KB snippets file, …).
		const snippets = mod('/src/lib/code/snippets.ts', 'B'.repeat(80000));
		const registry = mod('/@id/ogygia:region/transportables', 'reg', [snippets]);
		const comp = mod('/src/lib/Counter.svelte', 'y'.repeat(200));
		const entry = mod('/@id/ogygia:region/entry/abc123.js', 'glue', [comp, registry]);
		const out = island_subgraph_bytes([entry]);
		expect(out.abc123.bytes).toBe(200); // snippets stays out
	});

	it('ignores non-island modules and cold (untransformed) modules', () => {
		const cold = mod('/src/lib/Cold.svelte', null); // never transformed → no bytes
		const entry = mod('/@id/ogygia:region/entry/cold01.js', 'glue', [cold]);
		const page = mod('/src/routes/+page.svelte', 'p'.repeat(500)); // not an island entry
		const out = island_subgraph_bytes([entry, page]);
		expect(out.cold01).toBeUndefined(); // nothing countable → island omitted
		expect(Object.keys(out)).toHaveLength(0);
	});

	it('keeps the larger subgraph when two graph nodes share one island id (?v= variants)', () => {
		const small = mod('/@id/ogygia:region/entry/dad123.js', 'g', [
			mod('/src/A.svelte', 'a'.repeat(10))
		]);
		const big = mod('/@id/ogygia:region/entry/dad123.js?v=2', 'g', [
			mod('/src/A.svelte', 'a'.repeat(50))
		]);
		const out = island_subgraph_bytes([small, big]);
		expect(out.dad123.bytes).toBe(50);
	});
});
