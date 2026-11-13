/**
 * The plugin's own hooks, called the way Vite calls them, on a small app in a temp dir: no Vite
 * server, no bundler. Each test pins what a hook RETURNS or WRITES (the config it hands Vite, the
 * id it resolves, the module it loads, the file it leaves on disk, the message it sends the
 * browser), never the plugin's inner maps, so the per-leg rework of vite/index.ts keeps them.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STUB_PATHS, STUB_STATE } from '@ogygia/core/contract';
import { dedent } from '@ogygia/core/contract';
import { ogygia } from '../src/vite/index.ts';
import { definePlugin } from '../src/vite/plugin-api.ts';
import { keep_client_dir } from '../src/compiler/kit.ts';
import { ssr_hosts_handoff_path } from '../src/compiler/link/emit-gate.ts';
import {
	foucCssVirtualId,
	foucScopedVirtualId,
	FOUC_CSS_PREFIX
} from '../src/compiler/fouc-css.ts';
import type { OgygiaOptions } from '../src/vite/options.ts';

type Command = 'build' | 'serve';
type Leg = 'ssr' | 'client';
// (the hooks and configs are typed as Vite's; a test calls and reads them as plain data)
// oxlint-disable-next-line typescript/no-explicit-any
type Loose = Record<string, any>;
type Hooks = Loose;

let root = '';
let saved_secret: string | undefined;
let saved_rules: string | undefined;
beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-hooks-')));
	saved_secret = process.env.OGYGIA_SECRET;
	saved_rules = process.env.OGYGIA_RULES;
	delete process.env.OGYGIA_SECRET;
	delete process.env.OGYGIA_RULES;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (saved_secret === undefined) delete process.env.OGYGIA_SECRET;
	else process.env.OGYGIA_SECRET = saved_secret;
	if (saved_rules === undefined) delete process.env.OGYGIA_RULES;
	else process.env.OGYGIA_RULES = saved_rules;
});

const write = (rel: string, text: string) => {
	const abs = path.join(root, rel);
	mkdirSync(path.dirname(abs), { recursive: true });
	writeFileSync(abs, text);
	return abs;
};

/** An app with one island (`Counter`, a `visible` wake) on a page; `csr` is the page's option. */
function app({ csr = false }: { csr?: boolean } = {}): void {
	write('src/lib/Counter.svelte', '<button>+</button>\n');
	write(
		'src/routes/+page.svelte',
		dedent`
			<script>
				import Counter from '$lib/Counter.svelte' with { wake: 'visible' };
			</script>
			<Counter />
		`
	);
	write('src/routes/+layout.ts', `export const csr = ${csr};\n`);
}

/** What a hook's `this` carries: its environment (the leg), and the bundler calls it makes. */
function hook_this(leg: Leg) {
	const emitted: Array<Record<string, unknown>> = [];
	return {
		environment: { name: leg, config: { consumer: leg === 'ssr' ? 'server' : 'client' } },
		emitted,
		emitFile(chunk: Record<string, unknown>) {
			emitted.push(chunk);
			return `ref${emitted.length}`;
		},
		// (the app's own resolver: `$lib` and relative paths)
		resolve: async (spec: string, importer?: string) =>
			spec.startsWith('$lib/')
				? { id: path.join(root, 'src/lib', spec.slice(5)) }
				: spec.startsWith('.') && importer
					? { id: path.resolve(path.dirname(importer), spec) }
					: null,
		getFileName: (ref: string) => `_app/immutable/${ref}.js`,
		getModuleInfo: () => null,
		getModuleIds: () => [][Symbol.iterator](),
		error(e: unknown): never {
			throw e;
		}
	};
}

interface Setup {
	p: Hooks;
	/** what the `config` hook handed Vite */
	given: Loose;
	/** the resolved config `configResolved` saw (and may have written into) */
	resolved: Loose;
}

/** The plugin, through `config` and `configResolved`, as Vite runs them for `command`. */
async function setup(
	command: Command,
	{
		options = {},
		plugins = [],
		resolved = {}
	}: { options?: OgygiaOptions; plugins?: unknown[]; resolved?: Record<string, unknown> } = {}
): Promise<Setup> {
	const p = ogygia(options).find((x) => x.name === 'ogygia') as Hooks;
	const mode = command === 'serve' ? 'development' : 'production';
	const t = hook_this('ssr');
	const given = await p.config.handler.call(t, { root, plugins }, { command, mode });
	const config: Loose = {
		root,
		base: '/',
		command,
		mode,
		plugins: [],
		define: {},
		// (Kit's own alias)
		resolve: { alias: [{ find: '$lib', replacement: path.join(root, 'src/lib') }] },
		build: {},
		logger: { warn: () => {} },
		optimizeDeps: {},
		...resolved
	};
	p.configResolved.call(t, config);
	return { p, given, resolved: config };
}

async function resolve(p: Hooks, spec: string, leg: Leg, importer?: string): Promise<unknown> {
	return p.resolveId.call(hook_this(leg), spec, importer, { ssr: leg === 'ssr' });
}

/** A virtual module's text, resolved then loaded as the bundler would. */
async function load(p: Hooks, spec: string, leg: Leg): Promise<string | null> {
	const host = path.join(root, 'src/routes/+page.svelte');
	const r = (await resolve(p, spec, leg, host)) as string | { id: string } | null;
	const id = r === null ? null : typeof r === 'string' ? r : r.id;
	if (!id) throw new Error(`${spec} did not resolve`);
	const out = await p.load.call(hook_this(leg), id, { ssr: leg === 'ssr' });
	return out === null ? null : typeof out === 'string' ? out : out.code;
}

describe('the config hook', () => {
	it('dev pre-declares the deps every island imports; a build declares none', async () => {
		app();
		const dev = (await setup('serve')).given;
		expect(dev.optimizeDeps.include).toEqual([
			'svelte',
			'svelte/internal/client',
			'svelte/server',
			'ogygia > @ogygia/core > devalue'
		]);
		expect((await setup('build')).given.optimizeDeps.include).toEqual([]);
	});

	it('the rules fold in only under OGYGIA_RULES=1', async () => {
		app();
		expect((await setup('serve')).given.define.__OGYGIA_RULES__).toBe('false');
		process.env.OGYGIA_RULES = '1';
		expect((await setup('serve')).given.define.__OGYGIA_RULES__).toBe('true');
	});

	it('no client plugin, no client plugin code', async () => {
		app();
		expect((await setup('serve')).given.define.__OGYGIA_CLIENT_PLUGINS__).toBe('false');
	});

	it("core's events compile in when a plugin asks, lazily when it asks for lazy", async () => {
		app();
		const off = (await setup('serve')).given.define;
		expect([off.__OGYGIA_DEVTOOLS__, off.__OGYGIA_DEVTOOLS_LAZY__]).toEqual(['false', 'false']);
		// (a plugin's name is its package's)
		write('node_modules/x-tool/package.json', JSON.stringify({ name: 'x-tool' }));
		const eager = definePlugin({ name: 'x-tool', build: (b) => b.events() });
		const on = (await setup('serve', { plugins: [eager] })).given.define;
		expect([on.__OGYGIA_DEVTOOLS__, on.__OGYGIA_DEVTOOLS_LAZY__]).toEqual(['true', 'false']);
		const lazy = definePlugin({ name: 'x-tool', build: (b) => b.events({ lazy: true }) });
		const late = (await setup('serve', { plugins: [lazy] })).given.define;
		expect([late.__OGYGIA_DEVTOOLS__, late.__OGYGIA_DEVTOOLS_LAZY__]).toEqual(['true', 'true']);
	});

	it('a dependency that declares ogygia files is SSR-inlined and kept out of the optimizer, once', async () => {
		app();
		write('package.json', JSON.stringify({ dependencies: { 'x-widget': '1.0.0' } }));
		write(
			'node_modules/x-widget/package.json',
			JSON.stringify({ name: 'x-widget', ogygia: { files: ['./src'] } })
		);
		write('node_modules/x-widget/src/Widget.svelte', '<p>widget</p>\n');
		const { p, given } = await setup('serve');
		expect(given.ssr.noExternal).toContain('x-widget');
		expect(given.optimizeDeps.exclude).toContain('x-widget');
		// (Kit runs the config hook more than once)
		const again = await p.config.handler.call(
			hook_this('ssr'),
			{ root, plugins: [] },
			{ command: 'serve', mode: 'development' }
		);
		expect(again.ssr.noExternal.filter((n: string) => n === 'x-widget')).toHaveLength(1);
	});

	it("a build of an all-csr=false app injects Kit's keep-client route", async () => {
		app();
		await setup('build');
		expect(existsSync(path.join(keep_client_dir(root), '+layout.ts'))).toBe(true);
	});

	it('a build of an app Kit hydrates sweeps a stale keep-client route', async () => {
		app({ csr: true });
		write(path.relative(root, path.join(keep_client_dir(root), '+layout.ts')), '// stale\n');
		await setup('build');
		expect(existsSync(keep_client_dir(root))).toBe(false);
	});

	it('the dev server and a standalone build never inject it', async () => {
		app();
		await setup('serve');
		expect(existsSync(keep_client_dir(root))).toBe(false);
		await setup('build', { options: { standalone: true } });
		expect(existsSync(keep_client_dir(root))).toBe(false);
	});
});

describe('configResolved', () => {
	it('the dev server sweeps a keep-client route a crashed build left', async () => {
		app();
		write(path.relative(root, path.join(keep_client_dir(root), '+layout.ts')), '// stale\n');
		await setup('serve');
		expect(existsSync(keep_client_dir(root))).toBe(false);
	});

	it("dev hands Vite's scanner each island file as an entry, after the app's own, once", async () => {
		app();
		const own = '/elsewhere/entry.ts';
		const page = path.join(root, 'src/routes/+page.svelte');
		const { resolved } = await setup('serve', {
			resolved: { optimizeDeps: { entries: own } }
		});
		expect(resolved.optimizeDeps.entries[0]).toBe(own);
		expect(resolved.optimizeDeps.entries).toContain(path.join(root, 'src/lib/Counter.svelte'));
		expect(resolved.optimizeDeps.entries).toContain(page);
		const listed = await setup('serve', { resolved: { optimizeDeps: { entries: [page] } } });
		expect(listed.resolved.optimizeDeps.entries.filter((e: string) => e === page)).toHaveLength(1);
	});

	it('a build leaves the scan entries alone', async () => {
		app();
		const { resolved } = await setup('build', {
			resolved: { optimizeDeps: { entries: ['a.ts'] } }
		});
		expect(resolved.optimizeDeps.entries).toEqual(['a.ts']);
	});

	it("the runtime is named under Kit's appDir; a define that is not a name keeps _app", async () => {
		app();
		const url = async (define: Record<string, unknown>) =>
			load((await setup('build', { resolved: { define } })).p, 'ogygia:server/runtime-url', 'ssr');
		expect(await url({ __SVELTEKIT_APP_DIR__: JSON.stringify('custom') })).toMatch(/"\/?custom\//);
		for (const define of [
			{},
			{ __SVELTEKIT_APP_DIR__: 'not json' },
			{ __SVELTEKIT_APP_DIR__: JSON.stringify('') },
			{ __SVELTEKIT_APP_DIR__: JSON.stringify(7) },
			{ __SVELTEKIT_APP_DIR__: 7 }
		])
			expect(await url(define), JSON.stringify(define)).toMatch(/"\/?_app\//);
	});
});

describe('the signing secret', () => {
	const STRONG = 'a-secret-of-thirty-two-bytes-ok!';
	const had_secret = async (p: Hooks) =>
		/build_had_secret\W+true/.test((await load(p, 'ogygia:server/secret', 'ssr')) ?? '');

	it('a build refuses a short OGYGIA_SECRET; the dev server takes it', async () => {
		app();
		process.env.OGYGIA_SECRET = 'short';
		await expect(setup('build')).rejects.toMatchObject({ code: 'secret_too_short' });
		await expect(setup('serve')).resolves.toBeDefined();
	});

	it('a strong secret salts the build; none leaves it unsalted', async () => {
		app();
		expect(await had_secret((await setup('build')).p)).toBe(false);
		process.env.OGYGIA_SECRET = STRONG;
		expect(await had_secret((await setup('build')).p)).toBe(true);
	});

	it("is read from the app's .env, in its envDir, unless envDir is off", async () => {
		app();
		write('.env', `OGYGIA_SECRET=${STRONG}\n`);
		expect(await had_secret((await setup('build', { resolved: { envDir: false } })).p)).toBe(false);
		expect(process.env.OGYGIA_SECRET).toBeUndefined();
		expect(await had_secret((await setup('build', { resolved: { envDir: 'nowhere' } })).p)).toBe(
			false
		);
		expect(await had_secret((await setup('build')).p)).toBe(true);
		expect(process.env.OGYGIA_SECRET).toBe(STRONG);
	});

	it('a secret already in the environment wins over the .env file', async () => {
		app();
		write('.env', 'OGYGIA_SECRET=short\n');
		process.env.OGYGIA_SECRET = STRONG;
		await expect(setup('build')).resolves.toBeDefined();
		expect(process.env.OGYGIA_SECRET).toBe(STRONG);
	});
});

describe('resolveId', () => {
	it("the browser's Kit remote runtime is Kit's own remote functions; the server's is Kit's", async () => {
		app();
		const { p } = await setup('serve');
		expect(await resolve(p, '__sveltekit/remote', 'client')).toMatch(/remote-functions/);
		expect(await resolve(p, '__sveltekit/remote', 'ssr')).toBe(null);
	});

	it("Kit's remote functions get stub paths and state in the browser, from their own dir only", async () => {
		app();
		const { p } = await setup('serve');
		const kit = '/n/@sveltejs/kit/src/runtime/client/remote-functions/query.js';
		expect(await resolve(p, '#app/paths', 'client', kit)).toBe(STUB_PATHS);
		expect(await resolve(p, '#app/state/client', 'client', kit)).toBe(STUB_STATE);
		expect(await resolve(p, '../state.svelte.js', 'client', kit)).toBe(STUB_STATE);
		expect(await resolve(p, '#app/paths', 'ssr', kit)).not.toBe(STUB_PATHS);
		expect(await resolve(p, '#app/paths', 'client', '/n/app/src/x.ts')).not.toBe(STUB_PATHS);
		expect(await resolve(p, '#app/state/client', 'client', undefined)).not.toBe(STUB_STATE);
	});

	it("Kit's client paths module is stubbed in the browser only", async () => {
		app();
		const { p } = await setup('serve');
		expect(await resolve(p, '$app/paths/internal/client', 'client')).toBe(STUB_PATHS);
		expect(await resolve(p, '$app/paths/internal/client', 'ssr')).not.toBe(STUB_PATHS);
	});
});

describe('load', () => {
	it("a page's CSS module carries side effects; one with no path is empty and has none", async () => {
		app();
		write('src/lib/a.css', '.a { color: red; }\n');
		const { p } = await setup('serve');
		const t = hook_this('client');
		const css = await p.load.call(t, foucCssVirtualId('src/lib/a.css'), { ssr: false });
		expect(css.moduleSideEffects).toBe(true);
		const none = await p.load.call(t, `${FOUC_CSS_PREFIX}..%2Fx.js`, { ssr: false });
		expect(none).toEqual({ code: 'export {}', moduleSideEffects: false });
	});

	it("a lake's scoped CSS stays scoped when its template reads its script", async () => {
		app();
		write(
			'src/lib/Lake.svelte',
			dedent`
				<script>
					let label = 'x';
				</script>
				<p class="lake">{label}</p>
				<style>
					.lake { color: red; }
				</style>
			`
		);
		const { p } = await setup('serve');
		const out = await p.load.call(hook_this('client'), foucScopedVirtualId('src/lib/Lake.svelte'), {
			ssr: false
		});
		expect(out.moduleType).toBe('css');
		expect(out.code).toMatch(/\.lake\.svelte-[a-z0-9]+/);
		const gone = await p.load.call(
			hook_this('client'),
			foucScopedVirtualId('src/lib/Gone.svelte'),
			{
				ssr: false
			}
		);
		expect(gone).toEqual({ code: '', moduleType: 'css' });
	});
});

describe('transform', () => {
	const KIT_APP = '/x/.svelte-kit/generated/client-optimized/app.js';

	it("Kit's client app entry publishes Kit's page and the version, in the browser only", async () => {
		app();
		const { p } = await setup('build');
		const client = await p.transform.call(hook_this('client'), 'export {};\n', KIT_APP, {
			ssr: false
		});
		expect(client.code).toContain("Symbol.for('ogygia.kit-page')");
		expect(client.code).toContain('__ogygia');
		expect(client.map).toBe(null);
		expect(await p.transform.call(hook_this('ssr'), 'export {};\n', KIT_APP, { ssr: true })).toBe(
			null
		);
	});

	it('a host is compiled for the leg asked', async () => {
		app();
		const { p } = await setup('serve');
		const host = path.join(root, 'src/routes/+page.svelte');
		const src = readFileSync(host, 'utf8');
		const ssr = await p.transform.call(hook_this('ssr'), src, host, { ssr: true });
		const client = await p.transform.call(hook_this('client'), src, host, { ssr: false });
		expect(ssr.code).not.toBe(client.code);
	});

	it("a build's browser leg emits the island's entry as it compiles the host; the server leg does not", async () => {
		app();
		const { p } = await setup('build');
		const host = path.join(root, 'src/routes/+page.svelte');
		const src = readFileSync(host, 'utf8');
		const ssr = hook_this('ssr');
		await p.buildStart.call(ssr);
		await p.transform.call(ssr, src, host, { ssr: true });
		expect(ssr.emitted).toEqual([]);
		const client = hook_this('client');
		await p.transform.call(client, src, host, { ssr: false });
		expect(client.emitted.map((c) => c.type)).toEqual(['chunk']);
	});
});

describe('the build legs', () => {
	const handoff = () => ssr_hosts_handoff_path(path.join(root, '.svelte-kit'));

	it("the server leg drops an earlier build's handoff, then writes its own", async () => {
		app();
		write(path.relative(root, handoff()), '["stale"]');
		const { p } = await setup('build');
		const t = hook_this('ssr');
		await p.buildStart.call(t);
		expect(existsSync(handoff())).toBe(false);
		p.buildEnd.call(t);
		expect(JSON.parse(readFileSync(handoff(), 'utf8'))).toEqual([]);
	});

	it('the client leg neither drops nor writes it', async () => {
		app();
		write(path.relative(root, handoff()), '["kept"]');
		const { p } = await setup('build');
		const t = hook_this('client');
		await p.buildStart.call(t);
		p.buildEnd.call(t);
		expect(readFileSync(handoff(), 'utf8')).toBe('["kept"]');
	});

	it('a standalone build writes no handoff', async () => {
		app();
		const { p } = await setup('build', { options: { standalone: true } });
		const t = hook_this('ssr');
		await p.buildStart.call(t);
		p.buildEnd.call(t);
		expect(existsSync(handoff())).toBe(false);
	});

	it("the client leg emits the runtime and each island's entry", async () => {
		app();
		const { p } = await setup('build');
		const t = hook_this('client');
		await p.buildStart.call(t);
		expect(t.emitted.map((c) => c.type)).toContain('chunk');
	});

	it("the client leg names our entries and keeps the app's own naming for the rest", async () => {
		app();
		const { p } = await setup('build');
		const client = hook_this('client');
		await p.buildStart.call(client);
		const out = p.outputOptions.call(client, {
			chunkFileNames: (i: { name?: string }) => `c/${i.name}`
		});
		expect(out.chunkFileNames({ name: 'mine' })).toBe('c/mine');
		expect(out.entryFileNames({ name: 'mine' })).toBe('[name].js');
		expect(p.outputOptions.call(hook_this('ssr'), {})).toBe(null);
		expect((await setup('serve')).p.outputOptions.call(client, {})).toBe(null);
	});

	const region_deps = () => path.join(root, '.svelte-kit/output/server/og-region-deps.json');

	it('the browser leg hands the server its region deps; the server leg does not', async () => {
		app();
		const { p } = await setup('build');
		await p.writeBundle.call(hook_this('ssr'), {}, {});
		expect(existsSync(region_deps())).toBe(false);
		const client = hook_this('client');
		await p.buildStart.call(client);
		await p.writeBundle.call(client, {}, {});
		const deps = JSON.parse(readFileSync(region_deps(), 'utf8'));
		expect(deps).toHaveProperty('entries');
		// (what only a profiler reads stays out of the handoff without one)
		expect(deps).not.toHaveProperty('barrels');
		expect(deps.dupes).toEqual([]);
	});

	it('with a profiler, the barrels each chunk still holds: by fanout, the three widest', async () => {
		app();
		write('node_modules/x-tool/package.json', JSON.stringify({ name: 'x-tool' }));
		const measuring = definePlugin({ name: 'x-tool', build: (b) => b.measure() });
		const { p } = await setup('build', { plugins: [measuring] });
		const deps = (n: number) => Array.from({ length: n }, (_, i) => `/r/src/lib/d${i}.ts`);
		// module → [what it imports, its own code length]
		const modules: Record<string, [string[], number]> = {
			'/r/src/lib/six.ts': [deps(6), 960],
			'/r/src/lib/seven.ts': [deps(7), 10],
			'/r/src/lib/eight.ts': [deps(8), 10],
			'/r/src/lib/nine.ts': [deps(9), 10],
			'/r/src/lib/five.ts': [deps(5), 10],
			'/r/src/lib/heavy.ts': [deps(6), 961],
			'/r/src/lib/virtual.ts': [[...deps(5), '\0v'], 10],
			'/r/src/lib/Comp.svelte': [deps(9), 10],
			'/r/src/lib/Comp.svelte?x': [deps(9), 10]
		};
		const client = hook_this('client');
		await p.buildStart.call(client);
		const t = {
			...client,
			getModuleInfo: (id: string) =>
				modules[id]
					? { importedIds: modules[id][0], importers: [], code: 'x'.repeat(modules[id][1]) }
					: null
		};
		await p.writeBundle.call(
			t,
			{},
			{
				'a.js': { type: 'chunk', fileName: 'a.js', moduleIds: ['\0x', ...Object.keys(modules)] },
				'b.js': {
					type: 'chunk',
					fileName: '',
					moduleIds: ['/r/src/lib/six.ts', '/r/src/lib/none.ts']
				},
				'c.css': { type: 'asset', fileName: 'c.css', moduleIds: ['/r/src/lib/nine.ts'] }
			}
		);
		const { barrels } = JSON.parse(readFileSync(region_deps(), 'utf8'));
		const fanouts = (k: string) => barrels[k].map((b: { fanout: number }) => b.fanout);
		expect(Object.keys(barrels).sort()).toEqual(['/a.js', '/b.js']);
		expect(fanouts('/a.js')).toEqual([9, 8, 7]);
		expect(fanouts('/b.js')).toEqual([6]);
	});

	it('a server module in the browser bundle fails the build', async () => {
		app();
		const { p } = await setup('build');
		const id = (await resolve(p, 'ogygia:server/secret', 'ssr')) as string | { id: string };
		const bundle = {
			'a.js': { type: 'chunk', fileName: 'a.js', moduleIds: [typeof id === 'string' ? id : id.id] },
			'b.css': { type: 'asset', fileName: 'b.css', moduleIds: [] }
		};
		await expect(p.writeBundle.call(hook_this('client'), {}, bundle)).rejects.toMatchObject({
			code: 'virtual_wrong_realm'
		});
	});
});

describe('the dev server', () => {
	/** A dev server's surface the hooks touch: its module graph and its socket. */
	function server() {
		const sent: unknown[] = [];
		const invalidated: string[] = [];
		return {
			sent,
			invalidated,
			ws: { send: (m: unknown) => void sent.push(m) },
			moduleGraph: {
				getModuleById: (id: string) => ({ id }),
				invalidateModule: (m: { id: string }) => void invalidated.push(m.id)
			}
		};
	}

	it('an edit to a route, an island or a deleted file reloads the page; a plain module does not', async () => {
		app();
		write('src/lib/util.ts', 'export const n = 1;\n');
		const { p } = await setup('serve');
		// (the page was served: its island is registered)
		const host = path.join(root, 'src/routes/+page.svelte');
		await p.transform.call(hook_this('ssr'), readFileSync(host, 'utf8'), host, { ssr: true });
		const reloads = (file: string) => {
			const s = server();
			const r = p.handleHotUpdate({ file, server: s });
			return { r, sent: s.sent };
		};
		expect(reloads(path.join(root, 'src/lib/util.ts'))).toEqual({ r: undefined, sent: [] });
		// (the island first: a host edit drops its islands until the host is served again)
		for (const file of ['src/lib/Counter.svelte', 'src/routes/+page.svelte', 'src/lib/gone.ts'])
			expect(reloads(path.join(root, file)), file).toEqual({
				r: [],
				sent: [{ type: 'full-reload', path: '*' }]
			});
	});

	it("a stylesheet no page joined yet goes out as a scoped join; a package's is Vite's", async () => {
		app();
		const css = write('src/lib/a.css', '.a {}\n');
		const dep = write('node_modules/x/a.css', '.x {}\n');
		const { p } = await setup('serve');
		const s = server();
		expect(p.handleHotUpdate({ file: css, server: s })).toEqual([]);
		expect(s.sent).toMatchObject([
			{ type: 'custom', event: 'ogygia:css', data: { path: '/src/lib/a.css' } }
		]);
		const s2 = server();
		p.handleHotUpdate({ file: dep, server: s2 });
		expect(s2.sent.filter((m) => (m as { type?: string }).type === 'custom')).toEqual([]);
	});

	it("a host's edit drops its islands' modules; the server it came from then hears of a deleted entry", async () => {
		app();
		const { p } = await setup('serve');
		const host = path.join(root, 'src/routes/+page.svelte');
		await p.transform.call(hook_this('ssr'), readFileSync(host, 'utf8'), host, { ssr: true });
		const s = server();
		p.handleHotUpdate({ file: host, server: s });
		expect(s.invalidated.some((id) => id.includes('ogygia:region/'))).toBe(true);
		// (no configureServer: the hot update's server is the one a watch event reloads)
		await p.transform.call(hook_this('ssr'), readFileSync(host, 'utf8'), host, { ssr: true });
		s.sent.length = 0;
		p.watchChange(path.join(root, 'src/lib/Counter.svelte'), { event: 'delete' });
		expect(s.sent).toEqual([{ type: 'full-reload', path: '*' }]);
	});

	it('a build never answers a hot update', async () => {
		app();
		const { p } = await setup('build');
		const s = server();
		expect(p.handleHotUpdate({ file: path.join(root, 'src/lib/gone.ts'), server: s })).toBe(
			undefined
		);
		expect(s.sent).toEqual([]);
	});

	it('a deleted island entry reloads the page; an edit or a build does not', async () => {
		app();
		const { p } = await setup('serve');
		const s = server();
		p.configureServer(s);
		const entry = path.join(root, 'src/lib/Counter.svelte');
		p.watchChange(entry, { event: 'update' });
		expect(s.sent).toEqual([]);
		p.watchChange(entry, { event: 'delete' });
		expect(s.sent).toEqual([{ type: 'full-reload', path: '*' }]);
		const b = await setup('build');
		const s2 = server();
		b.p.configureServer(s2);
		b.p.watchChange(entry, { event: 'delete' });
		expect(s2.sent).toEqual([]);
	});

	it('a csr flip in dev is seen by the next route-csr load', async () => {
		app();
		const { p } = await setup('serve');
		const before = await load(p, 'ogygia:server/route-csr', 'ssr');
		const option = write('src/routes/+layout.ts', 'export const csr = true;\n');
		p.watchChange(option, { event: 'update' });
		expect(await load(p, 'ogygia:server/route-csr', 'ssr')).not.toBe(before);
	});
});
