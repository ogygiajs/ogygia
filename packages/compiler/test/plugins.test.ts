/**
 * The plugin API v2 (internal/notes/packages.md): config-time checks, realms named by the plugin, the
 * generated `ogygia:server/server-plugins`, shared hooks, facts, route config, and the test starter.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	check_plugins,
	client_hook_names,
	definePlugin,
	find_plugins,
	PLUGIN,
	resolve_plugins,
	type BuildContext,
	type PluginDefinition
} from '../src/vite/plugin-api.ts';
import { EVERY_BARREL } from '../src/exports/index.ts';
import { server_plugins_module, route_config_module } from '../src/link/caps.ts';
import { route_reader } from '../src/kit.ts';
import { node_fs } from '../src/fs.ts';
import { defineServer } from '../../core/src/plugin/index.ts';
import { facts_of, note_per_visitor } from '../../core/src/plugin/facts.ts';
import { ask, notify, register_hooks } from '../../core/src/plugin/hooks.ts';
import {
	clear_route_config,
	register_route_config,
	route_config,
	set_page_route_config
} from '../../core/src/plugin/routes.ts';

const R = route_reader(node_fs);
import { startPlugin } from '../../core/src/plugin/testing.ts';
import { dedent } from '@ogygia/core/plugin/utils';

/** An app of the repo's (the federation demo's dash): it depends on `@ogygia/flags`. */
const APP = path.resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../../examples/mfe/dash'
);
/** a real server realm module */
const FLAGS_SERVER = path.resolve(
	fileURLToPath(new URL('.', import.meta.url)),
	'../../flags/src/server.ts'
);

/** a definition as `resolve_plugins` takes it */
const def = <Options = undefined>(d: PluginDefinition<Options>): PluginDefinition<Options> => d;

describe('a plugin is a Vite plugin, found beside ogygia()', () => {
	it('definePlugin returns a Vite plugin carrying its definition', () => {
		const plugin = definePlugin({ name: '@ogygia/flags', options: { x: 1 } });
		expect(plugin.name).toBe('@ogygia/flags');
		expect(plugin[PLUGIN]).toEqual({ name: '@ogygia/flags', options: { x: 1 } });
		// a registered symbol: another copy of ogygia reads the same key; never an enumerable field
		expect(PLUGIN).toBe(Symbol.for('ogygia.plugin'));
		expect(Object.keys(plugin)).not.toContain('api');
	});
	it('finds definitions in the Vite list: nested arrays, promises, other plugins skipped, in order', async () => {
		const a = definePlugin({ name: 'a' });
		const b = definePlugin({ name: 'b' });
		const found = await find_plugins([
			{ name: 'ogygia' },
			[a, false, { name: 'other' }],
			Promise.resolve([b]),
			null
		]);
		expect(found.map((p) => p.name)).toEqual(['a', 'b']);
		expect(await find_plugins(undefined)).toEqual([]);
	});
	it('ogygia() and its plugins come before sveltekit()', async () => {
		const kit = [
			{ name: 'vite-plugin-sveltekit-setup' },
			{ name: 'vite-plugin-sveltekit-compile' }
		];
		const flags = definePlugin({ name: '@ogygia/flags' });
		await expect(find_plugins([{ name: 'ogygia' }, flags, kit])).resolves.toHaveLength(1);
		await expect(find_plugins([{ name: 'ogygia' }, kit, flags])).rejects.toThrow(
			/`@ogygia\/flags` is listed after `sveltekit\(\)`/
		);
		await expect(find_plugins([kit, [{ name: 'ogygia' }], flags])).rejects.toThrow(
			/`ogygia\(\)` is listed after `sveltekit\(\)`/
		);
	});
	it('names the uncalled factory', async () => {
		const flags = () => definePlugin({ name: '@ogygia/flags' });
		await expect(find_plugins([flags])).rejects.toThrow(/`flags\(\)`, not `flags`/);
	});
	it('refuses a plugin listed twice, a nameless one, and non-JSON options', async () => {
		await expect(
			find_plugins([definePlugin({ name: 'a' }), definePlugin({ name: 'a' })])
		).rejects.toThrow(/listed twice/);
		expect(() => check_plugins([{}])).toThrow(/needs a `name`/);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => check_plugins([def({ name: 'a', options: cyclic })])).toThrow(/plain JSON/);
	});
	it('a plugin that needs another fails the build while the app does not list it, naming the line to add', async () => {
		const needs = [{ name: 'b', call: 'bee()', from: 'b-pkg' }];
		const a = definePlugin({ name: 'a', needs } as PluginDefinition);
		const b = definePlugin({ name: 'b' });
		await expect(find_plugins([a])).rejects.toMatchObject({ code: 'plugin_needs_plugin' });
		await expect(find_plugins([a])).rejects.toThrow(/`a` needs `bee\(\)`.*`b-pkg`/);
		expect((await find_plugins([a, b])).map((p) => p.name)).toEqual(['a', 'b']);
		expect((await find_plugins([b, a])).map((p) => p.name)).toEqual(['b', 'a']);
	});
	it('listed without ogygia(), it fails the build saying what to add', () => {
		const plugin = definePlugin({ name: '@ogygia/flags' });
		const resolved = (names: string[]) => ({ plugins: names.map((name) => ({ name })) }) as never;
		const hook = plugin.configResolved as (config: never) => void;
		expect(() => hook(resolved(['@ogygia/flags', 'vite:svelte']))).toThrow(/`ogygia\(\)` is not/);
		expect(() => hook(resolved(['ogygia', '@ogygia/flags']))).not.toThrow();
	});
});

describe('realms, named by the plugin', () => {
	it('a plugin naming its `server` gets that module wired, options carried', () => {
		const posix = FLAGS_SERVER.split(path.sep).join('/');
		const plugin = def({
			name: '@ogygia/flags',
			server: pathToFileURL(FLAGS_SERVER).href,
			client: FLAGS_SERVER,
			options: { x: 1 }
		});
		const out = resolve_plugins([plugin], APP, true);
		expect(out.servers).toEqual([{ name: '@ogygia/flags', module: posix, options: { x: 1 } }]);
		expect(out.clients).toEqual([{ name: '@ogygia/flags', module: posix }]);
	});
	it('the runtime hooks a client realm subscribes to are read from its file, and nothing else passes', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-client-hooks-'));
		const file = (name: string, code: string) => {
			const f = path.join(dir, name);
			fs.writeFileSync(f, code);
			return f;
		};
		const plain = file(
			'plain.ts',
			`${dedent`
				import { defineClient } from 'ogygia/plugin/client';
				export default defineClient({ boot() {}, hooks: { regionHydrated(e) {}, 'navigated': () => {} } });
			`}\n`
		);
		const held = file(
			'held.ts',
			`${dedent`
				const client: ClientPlugin = defineClient({ hooks: { holeFailed() {} } });
				export default client;
			`}\n`
		);
		const none = file('none.ts', `export default defineClient({ boot() {} });\n`);
		const spread = file('spread.ts', `export default defineClient({ hooks: { ...more } });\n`);
		const unknown = file(
			'unknown.ts',
			`export default defineClient({ hooks: { regionHydratd() {} } });\n`
		);
		expect(client_hook_names('p', plain)).toEqual(['regionHydrated', 'navigated']);
		expect(client_hook_names('p', held)).toEqual(['holeFailed']);
		expect(client_hook_names('p', none)).toEqual([]);
		expect(() => client_hook_names('p', spread)).toThrow(/plugin_client_hooks_unread|cannot read/);
		expect(() => client_hook_names('p', unknown)).toThrow(/regionHydratd/);
	});
	it('a built client realm (`export { client as default }`, as the bundler writes it) has its hooks read', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-client-hooks-'));
		const built = path.join(dir, 'client.js');
		fs.writeFileSync(
			built,
			`${dedent`
				const client = defineClient({ hooks: { regionHydrated() {}, navigated() {} } });
				export { client as default };
			`}\n`
		);
		expect(client_hook_names('p', built)).toEqual(['regionHydrated', 'navigated']);
	});
	it('a client realm whose plugin object, or its hooks, sit in a named const has its hooks read', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-client-hooks-'));
		const file = (name: string, code: string) => {
			const f = path.join(dir, name);
			fs.writeFileSync(f, code);
			return f;
		};
		const named_plugin = file(
			'plugin.ts',
			`${dedent`
				const plugin: ClientPlugin = { boot() {}, hooks: { regionMount() {}, warning() {} } };
				const client = defineClient(plugin);
				export default client;
			`}\n`
		);
		const named_hooks = file(
			'hooks.ts',
			`${dedent`
				const hooks = { holeFailed() {} };
				export default defineClient({ boot() {}, hooks });
			`}\n`
		);
		const let_hooks = file(
			'let.ts',
			`${dedent`
				let hooks = { holeFailed() {} };
				export default defineClient({ hooks });
			`}\n`
		);
		expect(client_hook_names('p', named_plugin)).toEqual(['regionMount', 'warning']);
		expect(client_hook_names('p', named_hooks)).toEqual(['holeFailed']);
		// (a `let` can be reassigned: what it holds at run time is not what the file says)
		expect(() => client_hook_names('p', let_hooks)).toThrow(
			/plugin_client_hooks_unread|cannot read/
		);
	});
	it('a client realm is read through casts and parentheses; a const that names itself is no answer', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-client-hooks-'));
		const file = (name: string, code: string) => {
			const f = path.join(dir, name);
			fs.writeFileSync(f, `${code}\n`);
			return f;
		};
		const as = file('as.ts', `export default ({ hooks: { navigated() {} } } as ClientPlugin);`);
		const sat = file(
			'sat.ts',
			`export default defineClient({ hooks: ({ holeFailed() {} }) satisfies Hooks });`
		);
		const cycle = file('cycle.ts', `const a = a;\nexport default defineClient(a);`);
		expect(client_hook_names('p', as)).toEqual(['navigated']);
		expect(client_hook_names('p', sat)).toEqual(['holeFailed']);
		expect(() => client_hook_names('p', cycle)).toThrow(/plugin_client_hooks_unread|cannot read/);
	});
	it('a macro or a route config key two plugins both claim is refused, naming the first', () => {
		const both = (build: (b: BuildContext) => void) => () =>
			resolve_plugins(
				[def({ name: '@ogygia/flags', build }), def({ name: '@ogygia/barrels', build })],
				APP,
				true
			);
		expect(both((b) => b.macro('shared', (c: string) => c))).toThrow(/plugin_macro_claimed/);
		expect(both((b) => b.routeConfig('shared'))).toThrow(/route_config_key_claimed/);
	});
	it('without ogygia() a plugin reading the region table is told so', () => {
		for (const read of [
			(b: BuildContext) => b.regions.names(),
			(b: BuildContext) => b.regions.hosts(),
			(b: BuildContext) => b.regions.barrelWhy('x', [])
		])
			expect(() =>
				resolve_plugins([def({ name: '@ogygia/flags', build: (b) => void read(b) })], APP, true)
			).toThrow(/no region table without ogygia\(\)/);
	});
	it('a client realm that does not parse, or whose defineClient spreads, cannot be read', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-client-unread-'));
		const broken = path.join(dir, 'broken.ts');
		fs.writeFileSync(broken, `export default defineClient({ hooks: {\n`);
		const spread = path.join(dir, 'spread.ts');
		fs.writeFileSync(spread, `export default defineClient({ ...base, hooks: {} });\n`);
		expect(() => client_hook_names('p', broken)).toThrow(/plugin_client_hooks_unread|cannot read/);
		expect(() => client_hook_names('p', spread)).toThrow(/plugin_client_hooks_unread|cannot read/);
	});
	it('a plugin may not name a macro core defines (`wire`, `$`, `source`, `store`)', () => {
		for (const name of ['wire', '$', 'source', 'store'])
			expect(() =>
				resolve_plugins(
					[def({ name: '@ogygia/flags', build: (b) => b.macro(name, (c: string) => c) })],
					APP,
					true
				)
			).toThrow(/plugin_macro_name_invalid/);
	});
	it('events: one plugin measuring from boot outranks another asking only from the launcher', () => {
		const events = (...lazy: boolean[]) =>
			resolve_plugins(
				lazy.map((l, i) =>
					def({
						name: ['@ogygia/flags', '@ogygia/barrels', '@ogygia/devtools'][i],
						build: (b) => b.events({ lazy: l })
					})
				),
				APP,
				true
			).events;
		expect(events(true)).toEqual({ lazy: true });
		expect(events(true, false)).toEqual({ lazy: false });
		expect(events(false, true)).toEqual({ lazy: false });
	});
	it('macros run in plugin order, a `last` one after every other, whatever its place', () => {
		const h = (code: string) => code;
		const out = resolve_plugins(
			[
				def({
					name: '@ogygia/flags',
					build(b) {
						b.macro('late', h, { last: true });
						b.macro('one', h);
					}
				}),
				def({
					name: '@ogygia/barrels',
					build(b) {
						b.macro('two', h);
					}
				})
			],
			APP,
			true
		);
		expect(out.macros.map((m) => m.name)).toEqual(['one', 'two', 'late']);
	});
	it('no realm named, none wired: a package export called `./server` means nothing', () => {
		const out = resolve_plugins([def({ name: '@ogygia/flags' })], APP, true);
		expect(out.servers).toEqual([]);
		expect(out.clients).toEqual([]);
	});
	it('seed shaping is off without a plugin, one plugin answers it, and a second claim fails loudly', () => {
		expect(resolve_plugins([def({ name: '@ogygia/flags' })], APP, true).page_reads).toBeNull();
		const reads = {
			module() {},
			settle: async () => {},
			keys: () => null,
			why: () => null,
			dev: async () => ({ keys: null, why: [] })
		};
		const claim = (name: string) =>
			def({
				name,
				build(b) {
					b.pageReads(reads);
				}
			});
		expect(resolve_plugins([claim('@ogygia/flags')], APP, true).page_reads).toBe(reads);
		expect(() =>
			resolve_plugins([claim('@ogygia/flags'), claim('@ogygia/barrels')], APP, true)
		).toThrow(/claimed by both `@ogygia\/flags` and `@ogygia\/barrels`/);
	});
	it('a realm that is not a file, or not a location, fails loudly', () => {
		expect(() =>
			resolve_plugins([def({ name: '@ogygia/flags', server: './server.ts' })], APP, true)
		).toThrow(/is not a file/);
		expect(() =>
			resolve_plugins([def({ name: '@ogygia/flags', server: `${FLAGS_SERVER}.nope` })], APP, true)
		).toThrow(/is not a file/);
		expect(() => check_plugins([{ name: 'a', server: 1 }])).toThrow(/module location/);
	});
	it('a name that is not a package the app resolves fails loudly', () => {
		expect(() => resolve_plugins([def({ name: '@ogygia/nope' })], APP, true)).toThrow(
			/no package by that name/
		);
	});
	it('`enforce` orders plugins: pre, the rest, post', () => {
		const seen: string[] = [];
		const p = (name: string, enforce?: 'pre' | 'post') =>
			def({ name: '@ogygia/flags', enforce, build: () => void seen.push(name) });
		// (one real package, three manifests: only the order of the build hooks is under test)
		resolve_plugins([p('mid'), p('last', 'post'), p('first', 'pre')], APP, true);
		expect(seen).toEqual(['first', 'mid', 'last']);
	});
	it('`b.transform` collects stage transforms in plugin order; outside ogygia() the seams fail loudly', async () => {
		const noop = () => {};
		const seams: { exports?: BuildContext['exports']; pinned?: BuildContext['pinnedImports'] } = {};
		const out = resolve_plugins(
			[
				def({
					name: '@ogygia/flags',
					build: (b) => {
						b.transform({ stage: 'post', transform: noop });
						b.transform({ stage: 'source', transform: noop });
						seams.exports = b.exports;
						seams.pinned = b.pinnedImports;
					}
				})
			],
			APP,
			true
		);
		expect(out.transforms.map((t) => t.stage)).toEqual(['post', 'source']);
		await expect(seams.exports!.map('/x.ts', 'x', EVERY_BARREL, {} as never)).rejects.toThrow(
			/no export index without ogygia\(\)/
		);
		expect(() => seams.pinned!('')).toThrow(/no pinned imports without ogygia\(\)/);
	});
	it('`b.routeConfig` collects keys, once each; a key that is not an identifier is refused', () => {
		const out = resolve_plugins(
			[
				def({
					name: '@ogygia/flags',
					build: (b) => {
						b.routeConfig('postrender');
						b.routeConfig('postrender');
					}
				})
			],
			APP,
			true
		);
		expect(out.route_config).toEqual(['postrender']);
		expect(() =>
			resolve_plugins(
				[def({ name: '@ogygia/flags', build: (b) => b.routeConfig('post-render') })],
				APP,
				true
			)
		).toThrow(/camelCase identifier/);
	});
	it('`b.pageModules` collects importer specifiers and absolute files, once each', () => {
		const file = path.join(APP, 'src/pages.ts');
		const out = resolve_plugins(
			[
				def({
					name: '@ogygia/flags',
					build: (b) => {
						b.pageModules({ importers: ['@ogygia/router'] });
						b.pageModules({ importers: ['@ogygia/router'], files: [file] });
					}
				})
			],
			APP,
			true
		);
		expect(out.page_modules).toEqual({ importers: ['@ogygia/router'], files: [file] });
		expect(() =>
			resolve_plugins(
				[def({ name: '@ogygia/flags', build: (b) => b.pageModules({ files: ['src/pages.ts'] }) })],
				APP,
				true
			)
		).toThrow(/absolute paths/);
	});
});

describe('ogygia:server/server-plugins', () => {
	it('imports each server realm statically, with its name and options (server only)', () => {
		const code = server_plugins_module(true, [
			{ name: '@ogygia/flags', module: '@ogygia/flags/server', options: { a: 1 } }
		]);
		expect(code).toContain('import p0 from "@ogygia/flags/server";');
		expect(code).toContain('{ name: "@ogygia/flags", options: {"a":1}, server: p0 }');
	});
	it('is an empty list on the client and for an app without server realms', () => {
		expect(server_plugins_module(false, [{ name: 'x', module: 'x/server', options: {} }])).toBe(
			'export const plugins = [];'
		);
		expect(server_plugins_module(true, [])).toBe('export const plugins = [];');
	});
});

describe('shared hooks — notify / ask', () => {
	it('notify runs every implementation; ask takes the first answer', async () => {
		const seen: string[][] = [];
		const leave_a = register_hooks({ invalidate: (tags: string[]) => void seen.push(tags) });
		const leave_b = register_hooks({
			invalidate: (tags: string[]) => void seen.push(tags.map((t) => `${t}!`)),
			lastBuild: () => 'v1'
		});
		const leave_c = register_hooks({ lastBuild: () => 'v2' });
		try {
			await notify.invalidate(['p:/a']);
			expect(seen).toEqual([['p:/a'], ['p:/a!']]);
			expect(await ask.lastBuild('v3')).toBe('v1');
		} finally {
			leave_a();
			leave_b();
			leave_c();
		}
	});
	it('nobody implementing: notify does nothing, ask answers undefined', async () => {
		await expect(notify.invalidated('all')).resolves.toBeUndefined();
		expect(await ask.lastBuild('v')).toBeUndefined();
	});
	it('ask: one that throws is skipped when another answers, and thrown when none does (#198)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const down = new Error('store unreachable');
		const leave_a = register_hooks({
			lastBuild: () => {
				throw down;
			}
		});
		try {
			// the only one that knows could not say: not the same as nobody knowing
			await expect(ask.lastBuild('v')).rejects.toBe(down);
			const leave_b = register_hooks({ lastBuild: () => 'v1' });
			try {
				expect(await ask.lastBuild('v')).toBe('v1');
			} finally {
				leave_b();
			}
		} finally {
			leave_a();
			warn.mockRestore();
		}
	});
});

describe('facts', () => {
	it('are per request, made on first touch; the first per-visitor reason sticks', () => {
		const a = new Request('http://x/a');
		const facts = facts_of(a);
		expect(facts).toBe(facts_of(a));
		expect(facts_of(new Request('http://x/b'))).not.toBe(facts);
		note_per_visitor(a, 'flag:hero');
		note_per_visitor(a, 'cookie:x');
		expect(facts.reads.perVisitor).toBe('flag:hero');
	});
});

describe('route config', () => {
	afterEach(() => clear_route_config());
	it('a programmatic router that claims the path wins; then the Kit page; else undefined', () => {
		set_page_route_config({ '/docs': { postrender: false }, '/plain': {} });
		register_route_config('t', (pathname) =>
			pathname === '/app' ? { postrender: true } : pathname === '/bare' ? {} : undefined
		);
		expect(route_config('postrender', null, '/app')).toBe(true);
		expect(route_config('postrender', '/(site)/docs', '/docs')).toBe(false);
		expect(route_config('postrender', '/plain', '/plain')).toBeUndefined();
		expect(route_config('postrender', null, '/nowhere')).toBeUndefined();
		// a claimed path whose config lacks the key never falls through to the file world
		set_page_route_config({ '/bare': { postrender: true } });
		expect(route_config('postrender', '/bare', '/bare')).toBeUndefined();
	});
	it('the virtual module is server-only and empty without claimed keys', () => {
		expect(route_config_module(false, R, '/r', ['postrender'])).toBe(
			'export const route_config = {};'
		);
		expect(route_config_module(true, R, '/r', [])).toBe('export const route_config = {};');
	});
});

describe("a plugin's warnings", () => {
	it('are said once each, and 10,000 distinct ones keep at most 1024 (#438)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const { app } = startPlugin(defineServer({}), { name: 'warns' });
			app.warn('the store is down');
			app.warn('the store is down');
			expect(warn).toHaveBeenCalledTimes(1);
			for (let i = 0; i < 10_000; i++) app.warn(`no page at /p/${i}`);
			expect(warn).toHaveBeenCalledTimes(10_001);
			// the oldest was let go: said again
			app.warn('no page at /p/0');
			expect(warn).toHaveBeenCalledTimes(10_002);
		} finally {
			warn.mockRestore();
		}
	});
});

describe('startPlugin — a server realm without a server', () => {
	it('runs setup, registers shared hooks, and hands out request contexts', async () => {
		const calls: string[] = [];
		const server = defineServer<{ greeting: string }, { n: number }>({
			setup(app) {
				calls.push(`setup:${app.name}:${app.options.greeting}`);
			},
			state: () => ({ n: 1 }),
			request(ctx) {
				calls.push(`request:${ctx.path}:${ctx.state.n}`);
				ctx.perVisitor('test');
			},
			lastBuild: () => 'from-test'
		});
		const { app, ctx } = startPlugin(server, { name: 'test', options: { greeting: 'hi' } });
		const request = new Request('http://x/page');
		await server.request?.(ctx(request));
		expect(calls).toEqual(['setup:test:hi', 'request:/page:1']);
		expect(app.facts(request).reads.perVisitor).toBe('test');
		expect(await ask.lastBuild('v')).toBe('from-test');
	});
});
