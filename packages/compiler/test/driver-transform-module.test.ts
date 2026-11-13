import { describe, test, expect } from 'vitest';
import { Compiler } from '../src/compiler/driver.ts';
import { Program } from '../src/compiler/program.ts';
import { CompileCtx, type CompileCtxInit } from '../src/compiler/ctx.ts';
import { normalize_import_keys } from '../src/compiler/region/transform.ts';
import { memory_fs } from '../src/compiler/fs.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/tm-app';
const CSR_FALSE = `export const csr = false;\n`;
const MARKED = dedent`
	<script>
	import A from './A.svelte' with { wake: 'load' };
	</script>
	<A />
`;

function make(files: Record<string, string> = {}, init: Partial<CompileCtxInit> = {}) {
	const program = new Program({ forms: true, router: true });
	const compiler = new Compiler(
		program,
		{
			prof: {
				transformMs: 0,
				transformN: 0,
				transformHit: 0,
				prescanMs: 0,
				macroMs: 0,
				macroN: 0,
				resolveMs: 0,
				loadMs: 0
			},
			P: false,
			outHash: new Map<string, number>()
		},
		new CompileCtx(
			partial_ctx_init({
				root: ROOT,
				base: '/',
				app_dir: '_app',
				runtime_hash: '0123456789ab',
				libDir: `${ROOT}/src/lib`,
				is_dev: false,
				is_build: true,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				app_shims: {},
				fs: memory_fs({ [`${ROOT}/src/routes/+layout.ts`]: CSR_FALSE, ...files }),
				...init
			})
		)
	);
	const emitted: string[] = [];
	compiler.start_leg('ssr', true);
	compiler.start_leg('client', false);
	const run = (code: string, id: string, server: boolean) => {
		return compiler.transform_module(code, id, {
			leg: compiler.leg({ name: server ? 'ssr' : 'client', server }),
			emitFile: (chunk) => {
				emitted.push(chunk.id);
				return `ref-${emitted.length}`;
			}
		});
	};
	const rows = program.registry as unknown as Map<string, Record<string, unknown>>;
	return { compiler, program, run, emitted, rows };
}

const components = (program: Program) =>
	[...program.registry.values()].map((e) => e.componentPath).filter(Boolean);

describe('transform_module: which modules the region transform reads', () => {
	test("a component's CSS sub-request is not its script: no region is lowered from it", async () => {
		const { program, run } = make();
		const out = await run(MARKED, `${ROOT}/src/lib/H.svelte?svelte&type=style&lang.css`, true);
		expect(out).toBe(null);
		expect(components(program)).toEqual([]);
	});

	test('a portable snippet entry is authored markup: its marked imports become regions', async () => {
		const entry = 'ogygia:region/entry/snip.svelte';
		for (const id of [entry, `/@id/${entry}`]) {
			const { program, run, rows } = make();
			rows.set(entry, { role: 'entry', portable: true, hostPath: `${ROOT}/src/lib/H.svelte` });
			const out = await run(MARKED, id, true);
			expect(out, id).not.toBe(null);
			expect(components(program)).toContain(`${ROOT}/src/lib/A.svelte`);
		}
	});

	test('generated glue is never lowered, in its dev `/@id/` form too', async () => {
		for (const id of ['ogygia:region/wrapper/w.svelte', '/@id/ogygia:region/wrapper/w.svelte']) {
			const { program, run } = make();
			await run(MARKED, id, true);
			expect(components(program), id).toEqual([]);
		}
	});

	test('an installed `.svelte` is lowered when its package declares it, or when it carries a mark', async () => {
		const pkg = '/dep/node_modules/kit-ui';
		const declared = make(
			{},
			{ pkg_scan: [{ name: 'kit-ui', root: pkg, dirs: [pkg], files: [] }] }
		);
		const wire = `static [Symbol.for('ogygia.wire')] = { encode: (c) => c.v, decode: (v) => new C(v) };`;
		const lib = dedent`
			<script module>
				export class Cart { ${wire} }
			</script>
			<p>x</p>
		`;
		const out = await declared.run(lib, `${pkg}/Cart.svelte`, true);
		expect(out?.code).toContain('__OGT(');
		const hinted = make();
		await hinted.run(MARKED, '/dep/node_modules/other/H.svelte', true);
		expect(components(hinted.program)).toContain('/dep/node_modules/other/A.svelte');
	});

	test("a component's `<script module>` wire class is registered like a `.svelte.ts` one", async () => {
		const { run } = make();
		const wire = `static [Symbol.for('ogygia.wire')] = { encode: (c) => c.v, decode: (v) => new C(v) };`;
		const out = await run(
			dedent`
				<script module>
					export class Cart { ${wire} }
				</script>
				<p>x</p>
			`,
			`${ROOT}/src/lib/Cart.svelte`,
			true
		);
		expect(out?.code).toContain('__OGT("src/lib/Cart.svelte#Cart", Cart);');
	});

	test('a client build emits the entry of a hydrate region only a library host declares', async () => {
		const { run, emitted } = make();
		await run(MARKED, '/dep/node_modules/other/H.svelte', false);
		expect(emitted.some((id) => id.startsWith('ogygia:region/entry/'))).toBe(true);
	});

	test("a registry's client-leg variant is left exactly as emitted", async () => {
		const { run, program } = make();
		const reg = dedent`
			import A from './A.svelte' with { wake: 'load' };
			export const blocks = { A };
		`;
		expect(await run(reg, `${ROOT}/src/lib/registry.ts?og-registry-client`, false)).toBe(null);
		expect(components(program)).toEqual([]);
	});

	test("the server leg of a build records each module it transforms (the client leg's emit gate)", async () => {
		const { compiler, run } = make();
		await run(`<p>x</p>\n`, `${ROOT}/src/lib/P.svelte?v=1`, true);
		await run(`<p>y</p>\n`, `${ROOT}/src/lib/Q.svelte`, false);
		expect(compiler.ssr_transformed_hosts()).toEqual([`${ROOT}/src/lib/P.svelte`]);
	});
});

describe('transform_module: the island graph is whole before the first module lowers', () => {
	test('an island component transformed before its host still gets the `$app` shim', async () => {
		const island = `<script>import { page } from '$app/state';</script>{page.url}\n`;
		const { run } = make(
			{
				[`${ROOT}/src/routes/+page.svelte`]: MARKED.replace('./A.svelte', '../lib/A.svelte'),
				[`${ROOT}/src/lib/A.svelte`]: island
			},
			{ app_shims: { '$app/state': '/shim/state.js' } }
		);
		const out = await run(island, `${ROOT}/src/lib/A.svelte`, false);
		expect(out?.code).toContain('"/shim/state.js"');
	});
});

describe('transform_module: seed shaping', () => {
	const reads = (helper: boolean) => dedent`
		<script>
			import { page } from '$app/state';
			${helper ? `import h from './h';\nh(page);` : ''}
			const x = page.data.user;
		</script>
	`;

	test('each module goes to the seed-shaping plugin by its query-less id, in the source form the transform got', async () => {
		const seen: Array<[string, string]> = [];
		const page_reads = {
			module: (id: string, code: string) => void seen.push([id, code]),
			keys: () => null
		};
		const { run } = make({}, { page_reads });
		const id = `${ROOT}/src/lib/R.svelte`;
		await run(reads(true), `${id}?v=1`, true);
		await run(reads(false), `${id}?v=2`, true);
		expect(seen).toEqual([
			[id, reads(true)],
			[id, reads(false)]
		]);
	});

	test('without the plugin a page-store reader compiles as before', async () => {
		const { run } = make();
		const out = await run(reads(false), `${ROOT}/src/lib/R.svelte`, true);
		expect(out === null || typeof out.code === 'string').toBe(true);
	});
});

describe('transform_module: ownership stamps', () => {
	const widget = `<x-widget>{@html markup}</x-widget>\n`;
	const stamped = (out: { code: string } | null) => out?.code.includes('data-og-opaque') ?? false;

	test("the server leg stamps an app component's opaque elements", async () => {
		const { run } = make();
		expect(stamped(await run(widget, `${ROOT}/src/lib/W.svelte`, true))).toBe(true);
		expect(stamped(await run(widget, `${ROOT}/src/lib/C.svelte`, false))).toBe(false);
	});

	test('never a sub-request, generated glue, or an undeclared package', async () => {
		const { run } = make();
		expect(stamped(await run(widget, `${ROOT}/src/lib/W.svelte?svelte&type=style`, true))).toBe(
			false
		);
		expect(stamped(await run(widget, `${ROOT}/src/lib/.ogygia/W.svelte`, true))).toBe(false);
		expect(stamped(await run(widget, '/dep/node_modules/x/W.svelte', true))).toBe(false);
	});
});

describe('the driver, elsewhere', () => {
	test('has_hydrate_regions: a lake alone is none, a hydrate island is one', async () => {
		const lake = make();
		await lake.run(
			MARKED.replace(`wake: 'load'`, `wake: 'none'`),
			`${ROOT}/src/routes/+page.svelte`,
			true
		);
		expect(lake.compiler.has_hydrate_regions()).toBe(false);
		const hydrate = make();
		await hydrate.run(MARKED, `${ROOT}/src/routes/+page.svelte`, true);
		expect(hydrate.compiler.has_hydrate_regions()).toBe(true);
	});

	test("dev: a host's edit drops its rows, so nothing serves a region it no longer declares", async () => {
		const { compiler, program, run } = make({}, { is_dev: true, is_build: false });
		const host = `${ROOT}/src/routes/+page.svelte`;
		await run(MARKED, host, true);
		expect(compiler.is_registered_host(host)).toBe(true);
		const dropped: string[] = [];
		expect(compiler.invalidate_for_file(host, { invalidate: (id) => dropped.push(id) })).toBe(true);
		expect(compiler.is_registered_host(host)).toBe(false);
		expect(components(program)).toEqual([]);
	});
});
