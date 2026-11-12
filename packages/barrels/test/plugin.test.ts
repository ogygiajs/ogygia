/**
 * The plugin beside `ogygia()` inside a REAL Vite: a production build (the barrel leaves the module
 * graph, the leaves stay) and a dev server (`transformRequest` shows leaf imports; editing a barrel
 * re-transforms the importer through its watch list), with the Svelte plugin next to it and a fake
 * dependency with an `exports` map opted in through `packages`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
	build,
	createServer,
	type InlineConfig,
	type Logger,
	type Plugin,
	type PluginOption,
	type Rollup
} from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ogygia } from '@ogygia/compiler/vite';
import { is_script_request } from '@ogygia/compiler';
import { fixture, type Fixture } from './_fixture.ts';
import { barrels, type BarrelsOptions } from '../src/index.ts';
import { format_report } from '../src/report.ts';
import { dedent } from '@ogygia/core/plugin/utils';

let f: Fixture;
afterEach(() => f?.dispose());

const app = (): Record<string, string> => ({
	'package.json': JSON.stringify({ name: 'app', type: 'module' }),
	'index.html': `<script type="module" src="/src/main.ts"></script>`,
	'src/main.ts': dedent`
		import { Button, util } from '$lib';
		import { pkgLeaf } from '@scope/ui';
		import App from './App.svelte';
		console.log(Button, util, pkgLeaf, App);
	`,
	'src/App.svelte': dedent`
		<script lang="ts">
			import { Card } from '$lib';
		</script>
		<Card />
	`,
	'lib/Button.svelte': '<button>b</button>',
	'lib/Card.svelte': '<div>c</div>',
	'lib/Unused.svelte': '<div>never imported: must not be in the graph</div>',
	'lib/util.ts': 'export function util() { return "util-marker"; }',
	'lib/index.ts': dedent`
		export { default as Button } from './Button.svelte';
		export { default as Card } from './Card.svelte';
		export { default as Unused } from './Unused.svelte';
		export { util } from './util';
	`,
	'node_modules/@scope/ui/package.json': JSON.stringify({
		name: '@scope/ui',
		type: 'module',
		exports: { '.': './index.js' }
	}),
	'node_modules/@scope/ui/leaf.js':
		'export const pkgLeaf = "leaf"; globalThis.__pkg_leaf_loaded = true;',
	'node_modules/@scope/ui/heavy.js':
		'export const heavy = "heavy"; globalThis.__heavy_loaded = true;',
	'node_modules/@scope/ui/index.js': `export { pkgLeaf } from './leaf.js';\nexport { heavy } from './heavy.js';`
});

const config = (f: Fixture, extra: BarrelsOptions | true = {}, packages = ['@scope/ui']) => ({
	root: f.root,
	logLevel: 'silent' as const,
	configFile: false as const,
	resolve: { alias: { $lib: f.id('lib') } },
	optimizeDeps: { noDiscovery: true, include: [] },
	plugins: [
		ogygia(),
		barrels({ packages, ...(extra === true ? {} : extra) }),
		svelte({ configFile: false, compilerOptions: { css: 'injected' } })
	] as PluginOption[]
});

const module_ids = (out: Rollup.RollupOutput) =>
	out.output.flatMap((c) => (c.type === 'chunk' ? Object.keys(c.modules) : []));

const build_ids = async (cfg: InlineConfig) => {
	const out = (await build({
		...cfg,
		build: { write: false, minify: false }
	})) as Rollup.RollupOutput;
	return { out, ids: module_ids(out).map((m) => m.split('?')[0]) };
};

describe('which ids are importers', () => {
	it('the script only: a style sub-module or a raw/url/worker request is not the component', async () => {
		expect(is_script_request('/x/Foo.svelte')).toBe(true);
		expect(is_script_request('/x/Foo.svelte?v=123')).toBe(true); // a cache query on the real module
		expect(is_script_request('/x/Foo.svelte?og-region=1')).toBe(true);
		expect(is_script_request('/x/Foo.svelte?svelte&type=script&lang.ts')).toBe(true);
		expect(is_script_request('/x/Foo.svelte?svelte&type=style&lang.css')).toBe(false);
		expect(is_script_request('/x/Foo.svelte?svelte&type=style&lang.scss')).toBe(false);
		expect(is_script_request('/x/a.ts?raw')).toBe(false);
		expect(is_script_request('/x/a.ts?url')).toBe(false);
		expect(is_script_request('/x/a.ts?worker&inline')).toBe(false);
	});

	it('a build with extracted component CSS warns about nothing and still rewrites the component', async () => {
		// vite-plugin-svelte serves each component's CSS as `Foo.svelte?svelte&type=style&lang.css`:
		// counted as a Svelte importer, the parser ran over plain CSS and every component with a
		// <style> was reported "skipped" (3,233 false warnings in one production build)
		f = fixture({
			...app(),
			'src/App.svelte': dedent`
				<script lang="ts">
					import { Card } from '$lib';
				</script>
				<Card />
				<p class="x">x</p>
				<style>
					.x { color: red }
				</style>
			`
		});
		const cfg = config(f);
		cfg.plugins = [cfg.plugins[0], cfg.plugins[1], svelte({ configFile: false, emitCss: true })];
		const warns: string[] = [];
		const orig = console.warn;
		console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(' '));
		try {
			const { ids } = await build_ids(cfg);
			expect(ids, 'the component was still rewritten: the unused leaf is gone').not.toContain(
				f.id('lib/Unused.svelte')
			);
			expect(ids).toContain(f.id('lib/Card.svelte'));
		} finally {
			console.warn = orig;
		}
		expect(warns.filter((w) => w.includes('barrels: skipped'))).toEqual([]);
	});
});

describe('vite build', () => {
	it('the barrel and its unused leaves are not in the bundle; the used leaves are; the package barrel is bypassed too', async () => {
		f = fixture(app());
		const { out, ids } = await build_ids(config(f));
		expect(ids).toContain(f.id('lib/Button.svelte'));
		expect(ids).toContain(f.id('lib/Card.svelte'));
		expect(ids).toContain(f.id('lib/util.ts'));
		expect(ids).toContain(f.id('src/App.svelte'));
		expect(ids, 'the barrel module itself is gone').not.toContain(f.id('lib/index.ts'));
		expect(ids, 'a leaf nobody imported is gone').not.toContain(f.id('lib/Unused.svelte'));
		expect(ids).toContain(f.id('node_modules/@scope/ui/leaf.js'));
		expect(ids, 'the package barrel is gone').not.toContain(
			f.id('node_modules/@scope/ui/index.js')
		);
		expect(ids, 'the package sibling nobody asked for is gone').not.toContain(
			f.id('node_modules/@scope/ui/heavy.js')
		);
		const code = out.output.map((c) => (c.type === 'chunk' ? c.code : '')).join('\n');
		expect(code).not.toContain('__heavy_loaded');
		expect(code).toContain('__pkg_leaf_loaded');
	});

	it('without the plugin the barrel and every leaf are in the graph (the baseline the pass beats)', async () => {
		f = fixture(app());
		const cfg = config(f);
		cfg.plugins = [cfg.plugins[0], cfg.plugins[2]];
		const { ids } = await build_ids(cfg);
		expect(ids).toContain(f.id('lib/index.ts'));
		expect(
			ids,
			'a Svelte component is not sideEffects-free to the bundler, so the unused one survives'
		).toContain(f.id('lib/Unused.svelte'));
	});

	it('a `keep` matcher leaves that barrel alone even though it is pure', async () => {
		f = fixture(app());
		const { ids } = await build_ids(config(f, { keep: ['$lib'] }));
		expect(ids).toContain(f.id('lib/index.ts'));
		expect(ids, 'the package barrel is still bypassed').not.toContain(
			f.id('node_modules/@scope/ui/index.js')
		);
	});

	it('a package NOT opted in is left alone (dev pre-bundling safety)', async () => {
		f = fixture(app());
		const { ids } = await build_ids(config(f, true, []));
		expect(ids).not.toContain(f.id('lib/index.ts'));
		expect(ids).toContain(f.id('node_modules/@scope/ui/index.js'));
	});

	it('the build report names the totals, the time, and the top barrels with their importer counts; `debug` narrates each rewrite', async () => {
		f = fixture(app());
		const lines: string[] = [];
		const logger: Logger = {
			info: (m: string) => lines.push(m),
			warn() {},
			warnOnce() {},
			error() {},
			clearScreen() {},
			hasErrorLogged: () => false,
			hasWarned: false
		};
		const cfg = {
			...config(f, { debug: true }),
			customLogger: logger,
			logLevel: 'info' as const
		};
		await build_ids(cfg);
		const report = lines.find((l) => /^\[ogygia\] barrels: \d/.test(l))!;
		expect(report).toMatch(
			/^\[ogygia\] barrels: 2 of \d+ files rewritten — 3 barrel imports → leaves \(4 names\), 2 barrels bypassed, \d+\.\d\d s first to last transform\n/
		);
		expect(report).toContain('names  lib/index.ts  ← 2 importers');
		expect(report).toContain('names  node_modules/@scope/ui/index.js  ← 1 importer');
		expect(lines.filter((l) => l.startsWith('[ogygia] barrels: src/main.ts:'))).toHaveLength(2);
		expect(lines).toContainEqual(
			expect.stringContaining(
				'[ogygia] barrels: src/App.svelte: Card ← lib/index.ts → lib/Card.svelte'
			)
		);
		expect(report, 'two barrels fit under the default cut, so no "more" line').not.toContain(
			'more barrel'
		);
		// `report: false` silences the block
		lines.length = 0;
		await build_ids({
			...config(f, { report: false }),
			customLogger: logger,
			logLevel: 'info' as const
		});
		expect(lines.some((l) => /^\[ogygia\] barrels: \d/.test(l))).toBe(false);
	});

	it('the default report shows the eight biggest barrels and counts the rest; `report: "all"` lists every one', async () => {
		const files = app();
		// twelve more tiny barrels, each used by one file
		for (let i = 0; i < 12; i++) {
			files[`lib/b${i}/leaf.ts`] = `export const v${i} = ${i};`;
			files[`lib/b${i}/index.ts`] = `export { v${i} } from './leaf';`;
			files['src/main.ts'] = dedent`
					${files['src/main.ts']}
					import { v${i} } from '$lib/b${i}';
					console.log(v${i});
				`;
		}
		f = fixture(files);
		const lines: string[] = [];
		const logger: Logger = {
			info: (m: string) => lines.push(m),
			warn() {},
			warnOnce() {},
			error() {},
			clearScreen() {},
			hasErrorLogged: () => false,
			hasWarned: false
		};
		await build_ids({ ...config(f), customLogger: logger, logLevel: 'info' as const });
		const short = lines.find((l) => /^\[ogygia\] barrels: \d/.test(l))!;
		expect(short).toContain('14 barrels bypassed');
		expect(short.split('\n').filter((l) => / names  /.test(l))).toHaveLength(8);
		expect(short).toContain("… and 6 more barrels (`barrels({ report: 'all' })` lists every one)");
		lines.length = 0;
		await build_ids({
			...config(f, { report: 'all' }),
			customLogger: logger,
			logLevel: 'info' as const
		});
		const full = lines.find((l) => /^\[ogygia\] barrels: \d/.test(l))!;
		expect(full.split('\n').filter((l) => / names  /.test(l))).toHaveLength(14);
		expect(full).not.toContain('more barrel');
	});
});

describe('vite dev', { timeout: 30_000 }, () => {
	it('transformRequest returns leaf imports for a TS module and a Svelte component', async () => {
		f = fixture(app());
		const server = await createServer({
			...config(f),
			server: { middlewareMode: true, hmr: false, fs: { allow: [f.root] } }
		});
		try {
			const main = (await server.transformRequest('/src/main.ts'))!;
			expect(main.code).toContain(`/lib/Button.svelte`);
			expect(main.code).not.toMatch(/from\s+['"]\$lib['"]/);
			expect(main.code).not.toMatch(/from\s+['"]@scope\/ui['"]/);
			const comp = (await server.transformRequest('/src/App.svelte'))!;
			expect(comp.code).toContain('/lib/Card.svelte');
			expect(comp.code).not.toContain('/lib/index.ts');
		} finally {
			await server.close();
		}
	});

	describe('a leaf the client and the server resolve to different files (#252)', () => {
		// `#where` is one specifier with a browser target and a server target (the app's `imports`
		// conditions); the barrel re-exports it, so its map's leaf for `where` depends on who resolves
		const per_environment = () => {
			const files = app();
			files['package.json'] = JSON.stringify({
				name: 'app',
				type: 'module',
				imports: {
					'#where': { browser: './lib/where.browser.ts', default: './lib/where.server.ts' }
				}
			});
			files['lib/where.browser.ts'] = 'export const where = "browser";';
			files['lib/where.server.ts'] = 'export const where = "server";';
			files['lib/places/index.ts'] =
				`export { where } from '#where';\nexport { util } from '../util';`;
			files['src/where.ts'] =
				`import { where, util } from '$lib/places';\nconsole.log(where, util);`;
			return files;
		};
		const leaf = (code: string) =>
			code.includes('where.browser.ts') && !code.includes('where.server.ts')
				? 'browser'
				: code.includes('where.server.ts') && !code.includes('where.browser.ts')
					? 'server'
					: code;

		it('client and SSR transforms at the same time: each gets its own leaf', async () => {
			f = fixture(per_environment());
			const server = await createServer({
				...config(f),
				server: { middlewareMode: true, hmr: false, fs: { allow: [f.root] } }
			});
			try {
				const [client, ssr] = await Promise.all([
					server.environments.client.transformRequest('/src/where.ts'),
					server.environments.ssr.transformRequest('/src/where.ts')
				]);
				expect(leaf(client!.code)).toBe('browser');
				expect(leaf(ssr!.code)).toBe('server');
			} finally {
				await server.close();
			}
		});

		it('the client first, then SSR (and the other way): the cached barrel map is not handed across', async () => {
			for (const order of [
				['client', 'ssr'],
				['ssr', 'client']
			] as const) {
				f?.dispose();
				f = fixture(per_environment());
				const server = await createServer({
					...config(f),
					server: { middlewareMode: true, hmr: false, fs: { allow: [f.root] } }
				});
				try {
					const got: Record<string, string> = {};
					for (const env of order)
						got[env] = leaf(
							(await server.environments[env].transformRequest('/src/where.ts'))!.code
						);
					expect(got, order.join(' then ')).toEqual({ client: 'browser', ssr: 'server' });
				} finally {
					await server.close();
				}
			}
		});
	});

	it('editing a barrel re-points the importer on the next transform (watch + invalidate)', async () => {
		f = fixture(app());
		const server = await createServer({
			...config(f),
			server: { middlewareMode: true, hmr: false, fs: { allow: [f.root] } }
		});
		try {
			const before = (await server.transformRequest('/src/main.ts'))!;
			expect(before.code).toContain('/lib/util.ts');
			// the barrel changes: `util` now comes from a different leaf
			f.write('lib/util2.ts', 'export function util() { return "util2"; }');
			f.write(
				'lib/index.ts',
				f
					.read('lib/index.ts')
					.replace(`export { util } from './util';`, `export { util } from './util2';`)
			);
			// what Vite's watcher does on a change to a watched file
			server.watcher.emit('change', f.id('lib/index.ts'));
			server.moduleGraph.invalidateAll();
			await new Promise((r) => setTimeout(r, 200));
			const after = (await server.transformRequest('/src/main.ts'))!;
			expect(after.code).toContain('/lib/util2.ts');
			expect(after.code).not.toContain('/lib/util.ts');
		} finally {
			await server.close();
		}
	});
});

describe('beside ogygia()', { timeout: 30_000 }, () => {
	const source_stage = (cfg: InlineConfig, rel: string) => f.source_stage(cfg, rel);

	it("leaves imports carrying the app's region-mark keys (custom importKeys too) as written, rewrites the rest", async () => {
		f = fixture({
			'lib/Button.svelte': '<button/>',
			'lib/util.ts': 'export function util() { return "util-marker"; }',
			'lib/index.ts': `export { default as Button } from './Button.svelte';\nexport { util } from './util';`,
			'src/app.ts': `import { Button } from '$lib' with { hydrate: 'visible' };\nimport { util } from '$lib';`
		});
		const cfg = config(f, true);
		cfg.plugins[0] = ogygia({ importKeys: { wake: 'hydrate' } });
		expect(await source_stage(cfg, 'src/app.ts')).toBe(
			`import { Button } from '$lib' with { hydrate: 'visible' };\nimport { util } from '${f.id('lib/util.ts')}';`
		);
	});

	it('listed without ogygia(), it fails the build saying what to add', async () => {
		f = fixture(app());
		const cfg = config(f);
		cfg.plugins = cfg.plugins.slice(1);
		await expect(build_ids(cfg)).rejects.toThrow(/`ogygia\(\)` is not/);
	});

	it('a specifier Vite cannot resolve (it THROWS from `this.resolve`) leaves that import alone and the rest still moves', async () => {
		f = fixture({
			'lib/util.ts': 'export const util = 1;',
			'lib/index.ts': `export { util } from './util';`,
			'src/app.ts': dedent`
				import { Action } from 'svelte/action';
				import { util } from '$lib';
				import { deep } from '@vendor/pkg/src/types';
			`
		});
		const cfg = config(f, true);
		const throws: Plugin = {
			name: 'throws',
			enforce: 'pre',
			resolveId(spec) {
				if (spec.startsWith('@vendor/') || spec.startsWith('svelte/'))
					throw new Error(`Errored while resolving "${spec}" in \`this.resolve\`.`);
			}
		};
		cfg.plugins.push(throws);
		expect(await source_stage(cfg, 'src/app.ts')).toBe(
			dedent`
				import { Action } from 'svelte/action';
				import { util } from '${f.id('lib/util.ts')}';
				import { deep } from '@vendor/pkg/src/types';
			`
		);
	});
});

describe('the report names the components it had to skip', () => {
	it('skipped components are counted and listed, with or without rewrites', async () => {
		const base = {
			files: 10,
			importers: 0,
			imports: 0,
			names: 0,
			first_ms: 0,
			last_ms: 100,
			barrels: new Map(),
			skipped: new Set(['/app/src/A.svelte', '/app/src/B.svelte'])
		};
		const none = format_report(base, '/app', 8);
		expect(none).toContain(
			'2 components skipped (could not be parsed; their imports stay on their barrels): src/A.svelte, src/B.svelte'
		);
		const some = format_report(
			{
				...base,
				importers: 1,
				imports: 1,
				names: 1,
				barrels: new Map([
					['/app/src/lib/index.ts', { names: 1, importers: new Set(['/app/src/C.svelte']) }]
				])
			},
			'/app',
			1
		);
		expect(some).toContain('src/A.svelte and 1 more');
		expect(format_report({ ...base, skipped: new Set() }, '/app', 8)).not.toContain('skipped');
	});
});
