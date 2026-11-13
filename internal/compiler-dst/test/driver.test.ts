// The driver (packages/compiler/src/compiler/driver.ts) through the in-memory compile: what the
// prescan learns from the files, how a transform records each leg, the ids the client leg of a build
// resolves a csr=false page's region registry to, the virtual modules it emits per leg, and what a
// deleted component takes with it.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { memory_fs } from '../../../packages/compiler/src/compiler/fs.ts';
import { LIB, ROOT, ROUTES } from '../src/app.ts';
import { session, transform_module, type Leg, type Session } from '../src/session.ts';
import { page_reads } from '../../../packages/data-shake/src/index.ts';

const PAGE = `${ROUTES}/+page.svelte`;

/** The app: `Counter`, a page importing it with `attrs`, under a csr=false layout. */
const files = (extra: Record<string, string> = {}, attrs = `wake: 'visible'`) => ({
	[`${LIB}/Counter.svelte`]: '<button>+</button>\n',
	[`${ROUTES}/+layout.ts`]: 'export const csr = false;\n',
	[PAGE]: dedent`
		<script>
			import Counter from '$lib/Counter.svelte' with { ${attrs} };
		</script>
		<Counter />
	`,
	...extra
});

const build = (f: Record<string, string>) => {
	const s = session(memory_fs(f));
	s.compiler.prescan();
	return s;
};
const dev = (f: Record<string, string>) => {
	const s = session(memory_fs(f), { dev: true });
	s.compiler.prescan();
	return s;
};

/** Vite's resolver over the app's files: `$lib`, relative and absolute paths. */
const vite_resolve =
	(f: Record<string, string>) =>
	async (spec: string, importer?: string): Promise<{ id: string } | null> => {
		let p = spec.split('?')[0]!;
		if (p.startsWith('$lib/')) p = `${LIB}/${p.slice(5)}`;
		else if (p.startsWith('.') && importer) p = path.resolve(path.dirname(importer), p);
		return f[p] !== undefined ? { id: p } : null;
	};

async function resolved(
	s: Session,
	f: Record<string, string>,
	spec: string,
	importer: string,
	leg: Leg
): Promise<string | null> {
	const r = await s.compiler.resolve_id(spec, importer, {
		ssr: leg === 'ssr',
		resolve: vite_resolve(f)
	});
	return r === null ? null : typeof r === 'string' ? r : r.id;
}

const counter_rows = (s: Session) =>
	[...s.program.registry].filter(([, e]) => e.componentPath?.endsWith('/Counter.svelte'));

describe('the prescan', () => {
	it('names each region by its component', () => {
		const s = build(files());
		const names = Object.values(s.compiler.region_names());
		expect(names).toEqual(['Counter']);
	});

	it('a page with only server islands has no hydrate region; a wake one has', () => {
		expect(build(files({}, `render: 'deferred'`)).compiler.has_hydrate_regions()).toBe(false);
		expect(build(files()).compiler.has_hydrate_regions()).toBe(true);
	});

	it('the CSS roots of server islands only, sorted by id', () => {
		const f = files({
			[`${LIB}/Other.svelte`]: '<p>o</p>\n',
			[`${ROUTES}/a/+page.svelte`]: dedent`
				<script>
					import Other from '$lib/Other.svelte' with { render: 'deferred' };
					import Counter from '$lib/Counter.svelte' with { render: 'deferred' };
					import Late from '$lib/Other.svelte' with { wake: 'idle' };
				</script>
				<Other /><Counter /><Late />
			`
		});
		const roots = build(f).compiler.server_island_css_roots();
		expect(roots.map((r) => path.basename(r.abs)).sort()).toEqual([
			'Counter.svelte',
			'Other.svelte'
		]);
		expect(roots.map((r) => r.iid)).toEqual(roots.map((r) => r.iid).sort());
	});

	it('a remote function marks the wire and remote seeds; a plain module neither', () => {
		const plain = build(files({ [`${LIB}/data.ts`]: 'export const n = 1;\n' }));
		expect(plain.program.crosses_wire).toBe(false);
		expect(plain.program.runtime_marks.remoteSeeds).toBe(false);
		for (const remote of ['data.remote.ts', 'data.remote.js']) {
			const s = build(files({ [`${LIB}/${remote}`]: 'export const n = 1;\n' }));
			expect(s.program.crosses_wire, remote).toBe(true);
			expect(s.program.runtime_marks.remoteSeeds, remote).toBe(true);
		}
	});

	it("ogygia's context marks the runtime, from a component or a module", () => {
		const ctx = dedent`
			import { setContext } from 'ogygia';
			setContext('theme', 'dark');
		`;
		expect(build(files()).program.runtime_marks.context ?? false).toBe(false);
		const svelte = build(
			files({ [`${LIB}/Theme.svelte`]: ['<script>', ctx, '</script>'].join('\n') })
		);
		expect(svelte.program.runtime_marks.context).toBe(true);
		const ts = build(files({ [`${LIB}/theme.ts`]: ctx }));
		expect(ts.program.runtime_marks.context).toBe(true);
	});

	it('never walks node_modules, and a .d.ts is no module', () => {
		const s = build(
			files({
				[`${ROOT}/src/node_modules/x/Bad.svelte`]: dedent`
					<script>
						import Counter from '$lib/Counter.svelte' with { wake: 'idle' };
					</script>
				`,
				[`${LIB}/types.d.ts`]: `import Counter from './Counter.svelte' with { wake: 'idle' };\n`
			})
		);
		expect(s.program.region_kinds.size).toBe(1);
	});

	it('a module region mint is registered before any transform', () => {
		const s = build(
			files({
				[`${LIB}/regions.ts`]: dedent`
					import Counter from './Counter.svelte' with { region: 'raw' };
					export const r = Counter;
				`
			})
		);
		expect(s.compiler.is_registered_host(`${LIB}/regions.ts`)).toBe(true);
	});
});

describe('a transform', () => {
	it("records the server leg's hosts in a build only", async () => {
		const b = build(files());
		await transform_module(b, PAGE, 'client');
		expect(b.compiler.ssr_transformed_hosts()).toEqual([]);
		await transform_module(b, PAGE, 'ssr');
		expect(b.compiler.ssr_transformed_hosts()).toEqual([PAGE]);
		const d = dev(files());
		await transform_module(d, PAGE, 'ssr');
		expect(d.compiler.ssr_transformed_hosts()).toEqual([]);
	});

	it("records a module's page.data keys in a build only", async () => {
		const reader = `${LIB}/Reader.svelte`;
		const src = dedent`
			<script>
				import { page } from '$app/state';
			</script>
			<p>{page.data.title}</p>
		`;
		const f: Record<string, string> = files({ [reader]: src });
		const with_plugin = (dev: boolean) => {
			const reads = page_reads((file) => f[file] ?? null);
			const s = session(memory_fs(f), { dev, page_reads: reads });
			s.compiler.prescan();
			return { s, reads };
		};
		const b = with_plugin(false);
		await transform_module(b.s, reader, 'client');
		expect(b.reads.keys(reader)).toEqual(new Set(['title']));
		const d = with_plugin(true);
		await transform_module(d.s, reader, 'client');
		expect(d.reads.keys(reader)).toBe(null);
	});

	it('reads past a byte-order mark', async () => {
		const s = build(files());
		const src = `﻿${s.ctx.read_file(PAGE)}`;
		const out = await transform_module(s, PAGE, 'ssr', src);
		expect(typeof out).toBe('string');
		expect(out).not.toContain('﻿');
		expect(out).toContain('ogygia:region/');
	});

	it('prescans first when the transform comes first', async () => {
		const s = session(memory_fs(files({ [`${ROUTES}/b/+page.svelte`]: files()[PAGE]! })));
		await transform_module(s, PAGE, 'ssr');
		// (the other page was never transformed: the prescan found it)
		expect(s.compiler.is_registered_host(`${ROUTES}/b/+page.svelte`)).toBe(true);
	});

	it("a build's client leg emits the island entry it found; its server leg and dev do not", async () => {
		const b = build(files());
		await transform_module(b, PAGE, 'ssr');
		expect(b.emitted).toEqual([]);
		await transform_module(b, PAGE, 'client');
		expect(b.emitted).toHaveLength(1);
		await transform_module(b, PAGE, 'client');
		expect(b.emitted).toHaveLength(1);
		const d = dev(files());
		await transform_module(d, PAGE, 'client');
		expect(d.emitted).toEqual([]);
	});

	it('a server island gets no client entry', async () => {
		const b = build(files({}, `render: 'deferred'`));
		await transform_module(b, PAGE, 'client');
		expect(b.emitted).toEqual([]);
	});

	it("a component's style request is not a host", async () => {
		const s = build(files());
		const out = await transform_module(s, `${PAGE}?svelte&type=style&lang.css`, 'ssr', 'p {}');
		expect(out).toBe(null);
	});

	it('an undeclared package component is a host only when it marks an import', async () => {
		const s = build(files());
		const dep = `${ROOT}/node_modules/x/Shell.svelte`;
		const shell = (attrs: string) => dedent`
			<script>
				import A from './A.svelte'${attrs};
			</script>
			<A />
		`;
		const plain = shell('');
		expect(await transform_module(s, dep, 'ssr', plain)).toBe(null);
		const marked = shell(` with { wake: 'load' }`);
		expect(await transform_module(s, dep, 'ssr', marked)).toContain('ogygia:region/');
	});

	it('a module region mint rewrites the import, and an undeclared package module is left alone', async () => {
		const s = build(files());
		const mod = dedent`
			import Counter from './Counter.svelte' with { region: 'raw' };
			export const r = Counter;
		`;
		const out = await transform_module(s, `${LIB}/regions.ts`, 'ssr', mod);
		expect(out).not.toContain('with {');
		expect(await transform_module(s, `${ROOT}/node_modules/x/regions.ts`, 'ssr', mod)).toBe(null);
	});

	it('a transportable class in a component module script is registered', async () => {
		const s = build(files());
		const comp = `${LIB}/Point.svelte`;
		const src = dedent`
			<script module>
				export class Point {
					static [import.meta.og.wire] = { encode: (p) => p.x, decode: (x) => new Point(x) };
					constructor(x) { this.x = x; }
				}
			</script>
		`;
		const out = (await transform_module(s, comp, 'ssr', src)) as string;
		expect(out).not.toBe(src);
		expect(out).not.toContain('import.meta.og.wire');
	});
});

describe("a csr=false page's region registry on a build's client leg", () => {
	const REG = `${LIB}/blocks.ts`;
	/** A module importing `specs` for their effects, exporting `name`. */
	const importing = (specs: string[], name: string) =>
		[...specs.map((s) => `import '${s}';`), `export const ${name} = 1;`, ''].join('\n');
	const reg_files = (extra: Record<string, string> = {}) =>
		files({
			[REG]: dedent`
				import Counter from './Counter.svelte' with { wake: 'load' };
				export const blocks = { Counter };
			`,
			[`${LIB}/helper.ts`]: `export { blocks } from './blocks.ts';\n`,
			[`${LIB}/plain.ts`]: 'export const n = 1;\n',
			[`${LIB}/a.ts`]: importing(['./b.ts'], 'a'),
			[`${LIB}/b.ts`]: importing(['./a.ts', './helper.ts'], 'b'),
			[`${LIB}/c.ts`]: importing(['./d.ts'], 'c'),
			[`${LIB}/d.ts`]: importing(['./c.ts', './plain.ts'], 'd'),
			...extra
		});

	it('resolves to its marks-blanked variant, directly or through a helper or a cycle', async () => {
		const f = reg_files();
		const s = build(f);
		for (const spec of ['$lib/blocks.ts', '$lib/helper.ts', '$lib/a.ts', '$lib/b.ts'])
			expect(await resolved(s, f, spec, PAGE, 'client'), spec).toMatch(/\?/);
	});

	it('a module that reaches no registry stays itself, cycle or not', async () => {
		const f = reg_files();
		const s = build(f);
		for (const spec of ['$lib/plain.ts', '$lib/c.ts', '$lib/d.ts', '$lib/c.ts'])
			expect(await resolved(s, f, spec, PAGE, 'client'), spec).toBe(null);
	});

	it('never on the server leg, in dev, or from a module that is no csr=false host', async () => {
		const f = reg_files({ [`${ROUTES}/x/+page.ts`]: 'export const csr = true;\n' });
		const s = build(f);
		expect(await resolved(s, f, '$lib/blocks.ts', PAGE, 'ssr')).toBe(null);
		expect(await resolved(s, f, '$lib/blocks.ts', `${LIB}/plain.ts`, 'client')).toBe(null);
		expect(await resolved(s, f, '$lib/blocks.ts', `${ROOT}/src/other.svelte`, 'client')).toBe(null);
		const d = dev(f);
		expect(await resolved(d, f, '$lib/blocks.ts', PAGE, 'client')).toBe(null);
	});

	it("the page's option file is its host too", async () => {
		const f = reg_files({ [`${ROUTES}/+page.ts`]: `import { blocks } from '$lib/blocks.ts';\n` });
		const s = build(f);
		expect(await resolved(s, f, '$lib/blocks.ts', `${ROUTES}/+page.ts`, 'client')).toMatch(/\?/);
	});

	it('a remote function or a server module is never forked', async () => {
		const f = reg_files({
			[`${LIB}/data.remote.ts`]: importing(['./blocks.ts'], 'q'),
			[`${LIB}/server/db.ts`]: importing(['../blocks.ts'], 'q')
		});
		const s = build(f);
		expect(await resolved(s, f, '$lib/data.remote.ts', PAGE, 'client')).toBe(null);
		expect(await resolved(s, f, '$lib/server/db.ts', PAGE, 'client')).toBe(null);
	});

	it('the variant blanks the marks and keeps the plain imports', async () => {
		const f = reg_files();
		const s = build(f);
		const id = (await resolved(s, f, '$lib/blocks.ts', PAGE, 'client'))!;
		const out = await s.compiler.emit(id, { ssr: false, universalHooks: null });
		const code = typeof out === 'string' ? out : out?.code;
		expect(code).not.toContain('wake');
	});
});

describe('emit', () => {
	const load = async (s: Session, id: string, leg: Leg) => {
		const out = await s.compiler.emit(id, { ssr: leg === 'ssr', universalHooks: null });
		return out;
	};

	it("a region binding is the server's signer on the server, metadata in the browser", async () => {
		const s = build(files());
		const [binding] = counter_rows(s).filter(([, e]) => e.role === 'region');
		const [id] = binding!;
		expect(await load(s, id, 'ssr')).toBe(binding![1].ssrSource);
		expect(await load(s, id, 'client')).toBe(binding![1].clientSource);
	});

	it("a wake island's wrapper reaches its component through the lazy module in the browser", async () => {
		const s = build(files());
		const [[id, wrapper]] = counter_rows(s).filter(([, e]) => e.role === 'wrapper');
		expect(await load(s, id, 'ssr')).toBe(wrapper.source);
		expect(await load(s, id, 'client')).toBe(wrapper.clientSource);
	});

	it("an entry's foreign-hydrate exports are cut unless a plugin asks", async () => {
		const s = build(files());
		const [[id]] = counter_rows(s).filter(([, e]) => e.role === 'entry');
		for (const leg of ['ssr', 'client'] as const)
			expect(String(await load(s, id, leg))).not.toMatch(/foreign/i);
	});

	it('a module of definitions only is side-effect free', async () => {
		const s = build(files());
		const r = await s.compiler.resolve_id('ogygia:server/route-csr', PAGE, {
			ssr: true,
			resolve: async () => null
		});
		const id = typeof r === 'string' ? r : r!.id;
		const out = await load(s, id, 'ssr');
		expect(typeof out === 'object' && out !== null ? out.moduleSideEffects : 'string').toBe(false);
	});

	it('an id nobody registered is not ours', async () => {
		expect(await load(build(files()), `${LIB}/Counter.svelte`, 'ssr')).toBe(null);
	});
});

describe('resolve_id in the island graph', () => {
	it('a virtual island id resolves, with a query too, and joins the island graph', async () => {
		const f = files();
		const s = build(f);
		const [[id]] = counter_rows(s).filter(([, e]) => e.role === 'entry');
		s.program.island_graph.delete(id);
		expect(await resolved(s, f, `${id}?v=1`, PAGE, 'client')).toBe(id);
		expect(s.program.island_graph.has(id)).toBe(true);
	});

	it("an island module's relative import resolves against its host and joins the island graph", async () => {
		const f = files({ [`${ROUTES}/helper.ts`]: 'export const n = 1;\n' });
		const s = build(f);
		const [[id]] = counter_rows(s).filter(([, e]) => e.role === 'entry');
		expect(await resolved(s, f, './helper.ts', id, 'client')).toBe(`${ROUTES}/helper.ts`);
		expect(s.program.island_graph.has(`${ROUTES}/helper.ts`)).toBe(true);
	});

	it('a bare import an island module cannot resolve fails there, by name', async () => {
		const f = files();
		const s = build(f);
		const [[id]] = counter_rows(s).filter(([, e]) => e.role === 'entry');
		await expect(resolved(s, f, 'no-such-package', id, 'client')).rejects.toMatchObject({
			code: 'island_import_unresolved'
		});
	});

	it('a module in the island graph pulls its own imports in, in the browser only', async () => {
		const f = files({ [`${LIB}/util.ts`]: 'export const n = 1;\n' });
		const s = build(f);
		const comp = `${LIB}/Counter.svelte`;
		expect(s.program.island_graph.has(comp)).toBe(true);
		await resolved(s, f, './util.ts', comp, 'ssr');
		expect(s.program.island_graph.has(`${LIB}/util.ts`)).toBe(false);
		expect(await resolved(s, f, './util.ts', comp, 'client')).toBe(`${LIB}/util.ts`);
		expect(s.program.island_graph.has(`${LIB}/util.ts`)).toBe(true);
	});
});

describe('a deleted component', () => {
	it('takes its regions, and names what to drop', () => {
		const s = dev(files());
		const dropped: string[] = [];
		const changed = s.compiler.invalidate_for_file(`${LIB}/Counter.svelte`, {
			deleted: true,
			invalidate: (id) => void dropped.push(id)
		});
		expect(changed).toBe(true);
		expect(counter_rows(s)).toEqual([]);
		expect(s.program.region_kinds.size).toBe(0);
		expect(dropped.some((id) => id.includes('ogygia:region/'))).toBe(true);
	});

	it('an edit to a file nothing registered changes nothing', () => {
		const s = dev(files());
		const dropped: string[] = [];
		expect(
			s.compiler.invalidate_for_file(`${LIB}/Nothing.svelte`, {
				invalidate: (id) => void dropped.push(id)
			})
		).toBe(false);
		expect(dropped).toEqual([]);
		expect(counter_rows(s)).not.toEqual([]);
	});

	it('an edit to a component (not a delete) keeps its regions', () => {
		const s = dev(files());
		expect(s.compiler.invalidate_for_file(`${LIB}/Counter.svelte`, { invalidate: () => {} })).toBe(
			false
		);
		expect(counter_rows(s)).not.toEqual([]);
	});
});
