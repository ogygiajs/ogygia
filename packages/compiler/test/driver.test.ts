import { describe, test, expect, vi, afterEach } from 'vitest';
import { Compiler, app_shim_for } from '../src/driver.ts';
import { Program } from '../src/program.ts';
import { CompileCtx, type CompileCtxInit } from '../src/ctx.ts';
import { normalize_import_keys } from '../src/region/transform.ts';
import { memory_fs, type Fs } from '../src/fs.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const ROOT = '/driver-app';
const CSR_FALSE = `export const csr = false;\n`;

function counting(files: Record<string, string>): { fs: Fs; reads: Map<string, number> } {
	const inner = memory_fs(files);
	const reads = new Map<string, number>();
	return {
		reads,
		fs: {
			read(abs) {
				reads.set(abs, (reads.get(abs) ?? 0) + 1);
				return inner.read(abs);
			},
			list: (dir) => inner.list(dir),
			stat: (abs) => inner.stat(abs)
		}
	};
}

function make_compiler(fs: Fs, init: Partial<CompileCtxInit> = {}) {
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
				fs,
				...init
			})
		)
	);
	return { compiler, program };
}

describe('the transform cache', () => {
	test('the server and client transforms of one module are cached apart: their output differs', () => {
		const { compiler } = make_compiler(counting({}).fs);
		const src = dedent`
			<script>
			import Lake from '$lib/Lake.svelte' with { wake: 'none' };
			</script>
			<Lake />
		`;
		const id = `${ROOT}/src/routes/+layout.svelte`;
		const server = compiler.transform(src, id, { ssr: true, linkVirtual: true }) as {
			code: string;
		};
		const client = compiler.transform(src, id, { ssr: false, linkVirtual: true }) as {
			code: string;
		};
		expect(server.code).not.toContain('ogygia:region/fouc-css/');
		expect(client.code).toContain('ogygia:region/fouc-css/');
	});

	test('registering a transform keeps it cached: the same source again is not transformed again', () => {
		const { compiler, program } = make_compiler(counting({}).fs);
		const src = dedent`
			<script>
			import X from './X.svelte' with { wake: 'load' };
			</script>
			<X />
		`;
		const id = `${ROOT}/src/routes/+page.svelte`;
		const first = compiler.transform(src, id);
		program.register(first as never, id);
		expect(compiler.transform(src, id)).toBe(first);
	});
});

describe('a generated entry lowers against its real source file', () => {
	test('an entry minted from another entry resolves its marked imports from the outermost host', () => {
		const { compiler, program } = make_compiler(counting({}).fs);
		const page = `${ROOT}/src/routes/+page.svelte`;
		const outer = 'ogygia:region/entry/outer.svelte';
		const inner = 'ogygia:region/entry/inner.svelte';
		const rows = program.registry as unknown as Map<string, { hostPath: string }>;
		rows.set(outer, { hostPath: page });
		rows.set(inner, { hostPath: outer });
		const src = dedent`
			<script>
			import X from './X.svelte' with { wake: 'load' };
			</script>
			<X />
		`;
		const result = compiler.transform(src, inner) as {
			islands: { componentPath: string; hostPath: string }[];
		};
		expect(result.islands[0].componentPath).toBe(`${ROOT}/src/routes/X.svelte`);
		expect(result.islands[0].hostPath).toBe(page);
	});

	test('a registry whose hosts loop back still lowers', () => {
		const { compiler, program } = make_compiler(counting({}).fs);
		const a = 'ogygia:region/entry/a.svelte';
		const b = 'ogygia:region/entry/b.svelte';
		const rows = program.registry as unknown as Map<string, { hostPath: string }>;
		rows.set(a, { hostPath: b });
		rows.set(b, { hostPath: a });
		const src = `<script>import X from 'some-pkg/X.svelte' with { wake: 'load' };</script><X />`;
		expect(compiler.transform(src, a)).not.toBeNull();
	});
});

describe('app_shim_for', () => {
	const shims = { '$app/state': '/shim/state.js', '$app/navigation': '/shim/navigation.js' };
	test('an `$app` import the alias already sent into Kit finds its shim by where it went', () => {
		const kit = '/app/node_modules/@sveltejs/kit/src/runtime/app';
		expect(app_shim_for('$app/state', shims)).toBe('/shim/state.js');
		expect(app_shim_for(`${kit}/state`, shims)).toBe('/shim/state.js');
		expect(app_shim_for(`${kit}/state/index.js`, shims)).toBe('/shim/state.js');
		expect(app_shim_for(`${kit}/navigation.js`, shims)).toBe('/shim/navigation.js');
		expect(app_shim_for(`${kit}/forms.js`, shims)).toBe(null);
		expect(app_shim_for('/app/src/lib/state.ts', shims)).toBe(null);
	});
});

describe('the prescan', () => {
	test('a plugin reader gets each module by its identity: package-relative in a declared package', () => {
		const pkg = '/store/pkg@1';
		const seen: string[] = [];
		const { compiler } = make_compiler(
			counting({
				[`${ROOT}/src/lib/a.ts`]: `import 'probe';\n`,
				[`${pkg}/src/b.ts`]: `import 'probe';\n`
			}).fs,
			{
				pkg_scan: [{ name: 'pkg', root: pkg, dirs: [`${pkg}/src`], files: [] }],
				prescans: [{ imports: ['probe'], module: (m) => seen.push(m.rel) }]
			}
		);
		compiler.prescan();
		expect(seen.sort()).toEqual(['pkg/src/b.ts', 'src/lib/a.ts']);
	});

	test('a declared package file is scanned like app source', () => {
		const pkg = '/store/pkg@1';
		const seen: string[] = [];
		const { compiler } = make_compiler(counting({ [`${pkg}/one.ts`]: `import 'probe';\n` }).fs, {
			pkg_scan: [{ name: 'pkg', root: pkg, dirs: [], files: [`${pkg}/one.ts`] }],
			prescans: [{ imports: ['probe'], module: (m) => seen.push(m.rel) }]
		});
		compiler.prescan();
		expect(seen).toEqual(['pkg/one.ts']);
	});

	test('a page module the walks never reached still roots its imports', () => {
		const page = '/elsewhere/pages.ts';
		const { compiler, program } = make_compiler(
			counting({ [page]: `import { a } from './a.ts';\n` }).fs,
			{ page_files: [page] }
		);
		compiler.prescan();
		expect(program.router_modules.has(page)).toBe(true);
		expect(program.module_specs.get(page)).toEqual(['./a.ts']);
	});

	test('a page module the walk did reach keeps what the walk read of it', () => {
		const page = `${ROOT}/src/lib/pages.ts`;
		const { compiler, program } = make_compiler(
			counting({
				[page]: dedent`
					export class Cart { static wire = import.meta.og.wire(x); }
					const y = <div />;
				`
			}).fs,
			{ page_files: [page] }
		);
		compiler.prescan();
		expect(program.router_modules.has(page)).toBe(true);
		expect(program.transportable_modules.has(page)).toBe(true);
	});

	test('the feature hash names the runtime features the app uses', () => {
		const hash = (island: string) => {
			const { compiler } = make_compiler(
				counting({
					[`${ROOT}/src/routes/+layout.ts`]: CSR_FALSE,
					[`${ROOT}/src/routes/+page.svelte`]: dedent`
						<script>
						import A from '../lib/A.svelte' with { ${island} };
						</script>
						<A />
					`,
					[`${ROOT}/src/lib/A.svelte`]: `<p>a</p>\n`
				}).fs
			);
			return compiler.prescan().feature_hash;
		};
		expect(hash(`wake: 'load'`)).toBe(hash(`wake: 'load'`));
		expect(hash(`wake: 'load'`)).not.toBe(hash(`render: 'deferred'`));
	});
});

describe('island_scan_entries', () => {
	test('a component the dep scanner cannot parse is no entry; its host still is', () => {
		const host = `${ROOT}/src/routes/+page.svelte`;
		const { compiler } = make_compiler(
			counting({
				[`${ROOT}/src/routes/+layout.ts`]: CSR_FALSE,
				[host]: dedent`
					<script>
					import Doc from '../lib/Doc.md' with { wake: 'load' };
					</script>
					<Doc />
				`,
				[`${ROOT}/src/lib/Doc.md`]: `# doc\n`
			}).fs
		);
		compiler.prescan();
		expect(compiler.island_scan_entries()).toEqual([host]);
	});
});

describe('the server-router CSS roots', () => {
	const pages = dedent`
		import { page } from 'probe-router';
		import V from './V.svelte';
	`;
	const view = `${ROOT}/src/lib/V.svelte`;

	test('a build reads them once, after the scan', () => {
		const { compiler } = make_compiler(
			counting({ [`${ROOT}/src/lib/pages.ts`]: pages, [view]: `<p>v</p>\n` }).fs,
			{ page_importers: ['probe-router'] }
		);
		compiler.prescan();
		const first = compiler.router_css_roots();
		expect(first).toContain(view);
		expect(compiler.router_css_roots()).toBe(first);
	});

	test('dev reads them again on each call: a page module joins while the server runs', async () => {
		const { compiler } = make_compiler(counting({ [view]: `<p>v</p>\n` }).fs, {
			page_importers: ['probe-router'],
			is_dev: true,
			is_build: false
		});
		compiler.prescan();
		expect(compiler.router_css_roots()).toEqual([]);
		const leg = compiler.leg({ name: 'ssr', server: true });
		await compiler.transform_module(pages, `${ROOT}/src/lib/pages.ts`, {
			leg,
			emitFile: () => 'ref'
		});
		expect(compiler.router_css_roots()).toContain(view);
	});
});

describe('the context-boundary warning', () => {
	const said = () => {
		const out: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
			out.push(a.map(String).join(' '));
		});
		return out;
	};
	afterEach(() => vi.restoreAllMocks());
	const app = (island: string, extra: Record<string, string> = {}) =>
		counting({
			[`${ROOT}/src/routes/+layout.ts`]: CSR_FALSE,
			[`${ROOT}/src/routes/+page.svelte`]: dedent`
				<script>
				import A from '../lib/A.svelte' with { wake: 'load' };
				</script>
				<A />
			`,
			[`${ROOT}/src/lib/A.svelte`]: island,
			...extra
		}).fs;
	const reads_theme = `<script>import { getContext } from 'svelte'; const t = getContext('theme');</script>{t}\n`;

	test('an island that reads a context key nothing in it sets is warned about', () => {
		const out = said();
		make_compiler(app(reads_theme)).compiler.prescan();
		expect(out.filter((s) => s.includes('island_context_unprovided'))).toHaveLength(1);
	});

	test('a script module in the island reads context too', () => {
		const out = said();
		make_compiler(
			app(`<script>import { t } from './theme.ts';</script>{t}\n`, {
				[`${ROOT}/src/lib/theme.ts`]: dedent`
					import { getContext } from 'svelte';
					export const t = getContext('theme');
				`
			})
		).compiler.prescan();
		expect(out.filter((s) => s.includes('island_context_unprovided'))).toHaveLength(1);
	});

	test('a key the island sets itself, within one root, is not', () => {
		const out = said();
		make_compiler(
			app(
				`<script>import { getContext, setContext } from 'svelte'; setContext('theme', 1); const t = getContext('theme');</script>{t}\n`
			)
		).compiler.prescan();
		expect(out.filter((s) => s.includes('island_context_unprovided'))).toEqual([]);
	});

	test('an app that bridges context with ogygia is not warned', () => {
		const out = said();
		make_compiler(
			app(reads_theme, {
				[`${ROOT}/src/lib/provide.ts`]: dedent`
					import { setContext } from 'ogygia';
					setContext('theme', 1);
				`
			})
		).compiler.prescan();
		expect(out.filter((s) => s.includes('island_context_unprovided'))).toEqual([]);
	});

	test('a first-party package imported without its plugin is said once a process, not once a leg', () => {
		const out = said();
		const fs = counting({ [`${ROOT}/src/lib/f.ts`]: `import { flag } from '@ogygia/flags';\n` }).fs;
		make_compiler(fs).compiler.prescan();
		make_compiler(fs).compiler.prescan();
		const lines = out.filter((s) => s.includes('plugin_not_listed'));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('flags()');
	});

	test('a dependency with marks but no `ogygia.files` is said once per module', async () => {
		const out = said();
		const { compiler } = make_compiler(counting({}).fs, {
			pkg_root: '/dep/node_modules/ogygia'
		});
		compiler.start_leg('ssr', true);
		const leg = compiler.leg({ name: 'ssr', server: true });
		const marked = dedent`
			import A from './A.svelte' with { wake: 'load' };
			export { A };
		`;
		const run = (code: string, id: string) =>
			compiler.transform_module(code, id, { leg, emitFile: () => 'ref' });
		await run(marked, '/dep/node_modules/x/a.ts');
		await run(marked, '/dep/node_modules/x/a.ts');
		await run(`// import A from './A.svelte' with { wake: 'load' };\n`, '/dep/node_modules/x/b.ts');
		await run(marked, '/dep/node_modules/ogygia/c.ts');
		expect(out.filter((s) => s.includes('package_marks_undeclared'))).toHaveLength(1);
	});

	test('a one-off Symbol() key handed to ogygia is said at prescan', () => {
		const out = said();
		make_compiler(
			app(`<p>a</p>\n`, {
				[`${ROOT}/src/lib/provide.ts`]: dedent`
					import { setContext } from 'ogygia';
					setContext(Symbol(), 1);
				`
			})
		).compiler.prescan();
		expect(out.filter((s) => s.includes('region_context_key_one_off'))).toHaveLength(1);
	});
});

describe('the island-closure walk', () => {
	test('dev: an island a later transform registers hands its new closure to the next drain', async () => {
		const helper = `${ROOT}/src/lib/helper.ts`;
		const host = dedent`
			<script>
			import A from '../lib/A.svelte' with { wake: 'load' };
			</script>
			<A />
		`;
		const { compiler } = make_compiler(
			counting({
				[`${ROOT}/src/routes/+layout.ts`]: CSR_FALSE,
				[`${ROOT}/src/lib/A.svelte`]: `<script>import { x } from './helper.ts';</script>{x}\n`,
				[helper]: `export const x = 1;\n`
			}).fs,
			{ is_dev: true, is_build: false }
		);
		compiler.prescan();
		expect(compiler.drain_closure_marks()).toEqual([]);
		const leg = compiler.leg({ name: 'ssr', server: true });
		await compiler.transform_module(host, `${ROOT}/src/routes/+page.svelte`, {
			leg,
			emitFile: () => 'ref'
		});
		expect(compiler.drain_closure_marks()).toContain(helper);
		expect(compiler.drain_closure_marks()).toEqual([]);
	});

	test('a closure the prescan marked is never read again when a later island shares it', () => {
		const shared = `${ROOT}/src/lib/shared.ts`;
		const { fs, reads } = counting({
			[`${ROOT}/src/routes/+layout.ts`]: CSR_FALSE,
			[`${ROOT}/src/routes/+page.svelte`]: dedent`
				<script>
				import A from '../lib/A.svelte' with { wake: 'load' };
				</script>
				<A />
			`,
			[`${ROOT}/src/lib/A.svelte`]: `<script>import { x } from './shared.ts';</script>{x}\n`,
			[`${ROOT}/src/lib/B.svelte`]: `<script>import { x } from './shared.ts';</script>{x}\n`,
			[shared]: `export const x = 1;\n`
		});
		const { compiler } = make_compiler(fs);
		compiler.prescan();
		expect(compiler.program.island_graph.has(shared)).toBe(true);
		const before = reads.get(shared) ?? 0;
		compiler.mark_island_closure(`${ROOT}/src/lib/B.svelte`);
		expect(reads.get(shared)).toBe(before);
	});
});
